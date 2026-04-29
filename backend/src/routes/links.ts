/**
 * Link API Routes
 *
 * POST /api/v1/links/analyze     — Check a single URL
 * GET  /api/v1/links/:id         — Fetch cached result by ID
 * POST /api/v1/links/analyze/stream — SSE streaming analysis
 *
 * Design: API is async — returns jobId immediately,
 * client polls or subscribes to SSE for results.
 * This keeps p50 latency <100ms while actual analysis runs in background.
 */

import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { linkAnalysisQueue } from '../workers'
import { prisma } from '../plugins/prisma'
import { safeGet, safeSetex } from '../utils/redis-safe'
import { linkAnalyzer } from '../services/link-analyzer'
import { archiveFetcher } from '../services/archive-fetcher'
import { alternativeFinder } from '../services/alternative-finder'
import { aiExplainer } from '../services/ai-explainer'
import { logger } from '../config/logger'

const analyzeBodySchema = z.object({
  url: z.string().url('Must be a valid URL').max(2048),
  instant: z.boolean().default(false),  // If true, run synchronously (slower but immediate)
})

const analyzeSchema = {
  body: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string', maxLength: 2048 },
      instant: { type: 'boolean', default: false },
    },
  },
}

export const linkRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/v1/links/analyze
   * Enqueue a link for analysis. Returns jobId + any cached results.
   */
  app.post('/analyze', { schema: analyzeSchema }, async (request, reply) => {
    const { url, instant } = analyzeBodySchema.parse(request.body)

    // Check for very recent result in cache (< 5 min)
    const quickCacheKey = `quick:${url}`
    const quickCached = await safeGet(quickCacheKey)
    if (quickCached) {
      return reply.send({ cached: true, ...JSON.parse(quickCached) })
    }

    if (instant) {
      const result = await runInstantAnalysis(url)
      await safeSetex(quickCacheKey, 300, JSON.stringify(result))
      return reply.send(result)
    }

    // Async mode — enqueue if Redis available, else run instantly
    try {
      const job = await linkAnalysisQueue.add('analyze', { url, requestedBy: 'api' })
      return reply.status(202).send({
        jobId: job.id,
        message: 'Analysis queued',
        pollUrl: `/api/v1/links/jobs/${job.id}`,
      })
    } catch {
      // Redis unavailable — fall back to instant analysis
      logger.warn({ url }, 'Queue unavailable, running instant analysis')
      const result = await runInstantAnalysis(url)
      return reply.send({ ...result, queued: false })
    }
  })

  /**
   * GET /api/v1/links/jobs/:jobId
   * Poll for job status and results.
   */
  app.get<{ Params: { jobId: string } }>('/jobs/:jobId', async (request, reply) => {
    const job = await linkAnalysisQueue.getJob(request.params.jobId)
    if (!job) {
      return reply.status(404).send({ error: 'Job not found' })
    }

    const state = await job.getState()
    const progress = job.progress

    if (state !== 'completed') {
      return reply.send({ state, progress })
    }

    // Job complete — fetch full result from DB
    const result = job.returnvalue as { linkId: string }
    if (!result?.linkId) {
      return reply.send({ state: 'completed', data: null })
    }

    const linkData = await fetchLinkWithRelations(result.linkId)
    return reply.send({ state: 'completed', data: linkData })
  })

  /**
   * GET /api/v1/links/:id
   * Fetch a previously analyzed link by its DB ID.
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const link = await fetchLinkWithRelations(request.params.id)
    if (!link) {
      return reply.status(404).send({ error: 'Link not found' })
    }
    return reply.send(link)
  })

  /**
   * GET /api/v1/links/analyze/stream?url=...
   * Server-Sent Events — streams AI explanation as it generates
   */
  app.get<{ Querystring: { url: string } }>('/analyze/stream', async (request, reply) => {
    const { url } = request.query
    if (!url || !isValidUrl(url)) {
      return reply.status(400).send({ error: 'Valid url query parameter required' })
    }

    // Get origin for CORS
    const origin = request.headers.origin || ''
    const isAllowed =
      origin.match(/https:\/\/linkrevivor.*\.vercel\.app$/) ||
      origin.match(/^http:\/\/localhost:\d+$/) ||
      (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).includes(origin)

    // Set SSE headers with CORS
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': isAllowed ? origin : '',
      'Access-Control-Allow-Credentials': 'true',
    })

    try {
      // Run link analysis first
      const analysis = await linkAnalyzer.analyze(url)
      reply.raw.write(`data: ${JSON.stringify({ type: 'analysis', data: analysis })}\n\n`)

      if (analysis.isAlive) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
        reply.raw.end()
        return
      }

      // Run archive and alternatives in parallel for speed
      const [archive, alternatives] = await Promise.all([
        archiveFetcher.fetch(url).catch(err => {
          logger.warn({ url, err }, 'Archive fetch failed')
          return { hasArchive: false, latestSnapshot: null, snapshotCount: 0, timeline: [], oldestSnapshot: null }
        }),
        alternativeFinder.find(url, null, analysis.linkType).catch(err => {
          logger.warn({ url, err }, 'Alternatives fetch failed')
          return []
        }),
      ])

      reply.raw.write(`data: ${JSON.stringify({ type: 'archive', data: archive })}\n\n`)
      reply.raw.write(`data: ${JSON.stringify({ type: 'alternatives', data: alternatives })}\n\n`)

      // Stream AI explanation chunk by chunk
      try {
        for await (const chunk of aiExplainer.explainStream(url, null, alternatives)) {
          reply.raw.write(`data: ${JSON.stringify({ type: 'ai', data: chunk })}\n\n`)
          if (chunk.type === 'done') break
        }
      } catch (aiErr) {
        logger.warn({ url, aiErr }, 'AI stream failed')
        reply.raw.write(`data: ${JSON.stringify({ type: 'ai', data: { type: 'done', content: '' } })}\n\n`)
      }

      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    } catch (err) {
      logger.error({ url, err }, 'SSE stream error')
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Analysis failed' })}\n\n`)
    } finally {
      reply.raw.end()
    }
  })
}

async function runInstantAnalysis(url: string) {
  const [analysis, archive] = await Promise.all([
    linkAnalyzer.analyze(url),
    linkAnalyzer.analyze(url).then(a => a.isAlive ? null : archiveFetcher.fetch(url)),
  ])

  if (analysis.isAlive) {
    return { analysis, archive: null, alternatives: [], explanation: null }
  }

  const alternatives = await alternativeFinder.find(url, null, analysis.linkType)
  const explanation = await aiExplainer.explain(url, null, alternatives)

  return { analysis, archive, alternatives, explanation }
}

async function fetchLinkWithRelations(linkId: string) {
  return prisma.link.findUnique({
    where: { id: linkId },
    include: {
      checks: {
        orderBy: { checkedAt: 'desc' },
        take: 1,
      },
      alternatives: {
        orderBy: { relevanceScore: 'desc' },
        take: 10,
      },
    },
  })
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Queue Workers — BullMQ-based async processing
 *
 * Two queues:
 * 1. `link-analysis` — Process a single URL (triggered by API or extension)
 * 2. `bulk-scan` — Crawl a page and process all its links
 *
 * Worker concurrency is tuned per queue:
 * - link-analysis: 10 concurrent (mostly I/O bound — DNS + HTTP fetches)
 * - bulk-scan: 3 concurrent (CPU + memory: HTML parsing + many sub-jobs)
 *
 * Retry strategy: exponential backoff for transient failures,
 * no retry for permanent failures (DNS failure, 410 Gone)
 */

import { Worker, Queue, type Job } from 'bullmq'
import { prisma } from '../plugins/prisma'
import { linkAnalyzer } from '../services/link-analyzer'
import { archiveFetcher } from '../services/archive-fetcher'
import { alternativeFinder } from '../services/alternative-finder'
import { aiExplainer } from '../services/ai-explainer'
import { pageCrawler } from '../services/page-crawler'
import { logger } from '../config/logger'
import { AlternativeSource, Prisma } from '@prisma/client'
import { env } from '../config/env'
import crypto from 'crypto'

// BullMQ connection config — parsed directly from REDIS_URL
// This avoids depending on the redis singleton which is set up later by Fastify
function getBullMQConnection() {
  const url = new URL(env.REDIS_URL)
  const isTLS = env.REDIS_URL.startsWith('rediss://')
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    tls: isTLS ? { rejectUnauthorized: false } : undefined,
  }
}

const connection = getBullMQConnection()

// Queue definitions — shared between API (producer) and workers (consumer)
export const linkAnalysisQueue = new Queue('link-analysis', {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
})

export const bulkScanQueue = new Queue('bulk-scan', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
})

export interface LinkAnalysisJobData {
  url: string
  skipCache?: boolean
  requestedBy?: string  // Extension ID or 'web'
}

export interface BulkScanJobData {
  pageUrl: string
  bulkScanId: string
}

/**
 * Link Analysis Worker
 * Full pipeline: check → archive → alternatives → AI explanation
 */
const linkAnalysisWorker = new Worker<LinkAnalysisJobData>(
  'link-analysis',
  async (job: Job<LinkAnalysisJobData>) => {
    const { url, skipCache } = job.data
    logger.info({ url, jobId: job.id }, 'Processing link analysis job')

    // Check if we have a recent result cached in DB (within 1 hour)
    // This avoids redundant work when the same URL is requested multiple times
    if (!skipCache) {
      const existing = await prisma.link.findUnique({
        where: { url },
        include: {
          checks: { orderBy: { checkedAt: 'desc' }, take: 1 },
          alternatives: { orderBy: { relevanceScore: 'desc' }, take: 10 },
        },
      })

      if (existing?.checks[0]) {
        const checkedAgo = Date.now() - existing.checks[0].checkedAt.getTime()
        const oneHour = 60 * 60 * 1000

        if (checkedAgo < oneHour) {
          logger.debug({ url }, 'Skipping analysis — recent result in DB')
          return { linkId: existing.id, cached: true }
        }
      }
    }

    // Step 1: HTTP health check
    await job.updateProgress(10)
    const analysis = await linkAnalyzer.analyze(url)

    // Upsert Link record
    const urlHash = crypto.createHash('md5').update(url).digest('hex')
    const link = await prisma.link.upsert({
      where: { url },
      create: {
        url,
        urlHash,
        domain: new URL(url).hostname,
        linkType: analysis.linkType,
        title: analysis.title,
        lastStatus: analysis.statusCode,
        lastCheckedAt: new Date(),
        isAlive: analysis.isAlive,
      },
      update: {
        lastStatus: analysis.statusCode,
        lastCheckedAt: new Date(),
        isAlive: analysis.isAlive,
        linkType: analysis.linkType,
        title: analysis.title || undefined,
      },
    })

    await job.updateProgress(25)

    // Create LinkCheck record
    const check = await prisma.linkCheck.create({
      data: {
        linkId: link.id,
        statusCode: analysis.statusCode,
        errorType: analysis.errorType,
        errorDetail: analysis.errorDetail,
        responseMs: analysis.responseMs,
      },
    })

    // If link is alive, we're done — no need for archive/alternatives
    if (analysis.isAlive) {
      logger.info({ url }, 'Link is alive — skipping archive/alternatives')
      return { linkId: link.id, checkId: check.id, isAlive: true }
    }

    // Step 2: Fetch archive
    await job.updateProgress(40)
    const archiveResult = await archiveFetcher.fetch(url)

    await prisma.linkCheck.update({
      where: { id: check.id },
      data: {
        hasArchive: archiveResult.hasArchive,
        archiveUrl: archiveResult.latestSnapshot?.playbackUrl,
        archiveTimestamp: archiveResult.latestSnapshot
          ? archiveFetcher.constructor
              // @ts-ignore — static method access
              .parseTimestamp?.(archiveResult.latestSnapshot.timestamp) || null
          : null,
        archiveSnapshotCount: archiveResult.snapshotCount,
      },
    })

    // Step 3: Find alternatives
    await job.updateProgress(60)
    const alternatives = await alternativeFinder.find(url, link.title, link.linkType)

    // Upsert alternatives (delete old, insert new to handle re-runs cleanly)
    await prisma.alternative.deleteMany({ where: { linkId: link.id } })
    if (alternatives.length > 0) {
      await prisma.alternative.createMany({
        data: alternatives.map((alt: { url: string; title: string; snippet: string; source: string; relevanceScore: number; metadata?: Record<string, unknown> }) => ({
          linkId: link.id,
          url: alt.url,
          title: alt.title,
          snippet: alt.snippet,
          source: alt.source as AlternativeSource,
          relevanceScore: alt.relevanceScore,
          metadata: alt.metadata ? (alt.metadata as Prisma.JsonObject) : undefined,
        })),
      })
    }

    // Step 4: AI Explanation (optional, can be slow)
    await job.updateProgress(80)
    if (env.ENABLE_AI_EXPLANATIONS && alternatives.length > 0) {
      const archiveContentForAI = archiveResult.latestSnapshot?.playbackUrl
        ? null  // We don't fetch archive HTML here — too slow in worker
        : null  // AI works from URL + alternatives for now

      const explanation = await aiExplainer.explain(url, null, alternatives)

      await prisma.linkCheck.update({
        where: { id: check.id },
        data: {
          aiSummary: explanation.summary,
          aiOutdatedScore: explanation.outdatedScore,
          aiRecommendation: explanation.recommendation,
        },
      })
    }

    await job.updateProgress(100)
    logger.info({ url, linkId: link.id }, 'Link analysis complete')

    return { linkId: link.id, checkId: check.id, isAlive: false }
  },
  {
    connection,
    concurrency: 10,  // 10 parallel link checks
  }
)

/**
 * Bulk Scan Worker
 * Crawls a page and enqueues individual link analysis jobs
 */
const bulkScanWorker = new Worker<BulkScanJobData>(
  'bulk-scan',
  async (job: Job<BulkScanJobData>) => {
    const { pageUrl, bulkScanId } = job.data
    logger.info({ pageUrl, bulkScanId }, 'Starting bulk scan')

    await prisma.bulkScan.update({
      where: { id: bulkScanId },
      data: { status: 'PROCESSING', startedAt: new Date() },
    })

    // Crawl the page
    const links = await pageCrawler.extractLinks(pageUrl)
    const uniqueLinks = [...new Set(links.map((l: { url: string }) => l.url))]

    await prisma.bulkScan.update({
      where: { id: bulkScanId },
      data: { totalLinks: uniqueLinks.length },
    })

    // Enqueue individual analysis jobs for each link
    // Rate: max 100 links per scan to prevent abuse
    const linksBatch = uniqueLinks.slice(0, env.MAX_BULK_LINKS)

    for (const linkUrl of linksBatch) {
      await linkAnalysisQueue.add(
        'analyze',
        { url: linkUrl, requestedBy: `bulk:${bulkScanId}` },
        { priority: 5 }  // Lower priority than direct API requests
      )
    }

    // Watch for completion via a polling job
    await bulkScanQueue.add(
      'poll-completion',
      { pageUrl, bulkScanId },
      { delay: 30_000 }  // Check back in 30s
    )

    return { bulkScanId, totalLinks: linksBatch.length }
  },
  {
    connection,
    concurrency: 3,
  }
)

// Worker event handlers
linkAnalysisWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, url: job?.data?.url, err }, 'Link analysis job failed')
})

bulkScanWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Bulk scan job failed')
})

export { linkAnalysisWorker, bulkScanWorker }

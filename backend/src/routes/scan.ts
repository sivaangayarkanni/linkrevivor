import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '../plugins/prisma'
import { bulkScanQueue } from '../workers'

const startScanSchema = z.object({
  pageUrl: z.string().url().max(2048),
})

export const scanRoutes: FastifyPluginAsync = async (app) => {
  /**
   * POST /api/v1/scan
   * Start a bulk scan of a webpage's links.
   */
  app.post('/', async (request, reply) => {
    const { pageUrl } = startScanSchema.parse(request.body)

    const scan = await prisma.bulkScan.create({
      data: { pageUrl, status: 'PENDING' },
    })

    await bulkScanQueue.add('scan', {
      pageUrl,
      bulkScanId: scan.id,
    })

    return reply.status(202).send({
      scanId: scan.id,
      pollUrl: `/api/v1/scan/${scan.id}`,
    })
  })

  /**
   * GET /api/v1/scan/:id
   * Poll scan status and results.
   */
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const scan = await prisma.bulkScan.findUnique({
      where: { id: request.params.id },
      include: {
        items: {
          include: { link: true },
          where: { isBroken: true },  // Return only broken links in polling
          take: 100,
        },
      },
    })

    if (!scan) return reply.status(404).send({ error: 'Scan not found' })
    return reply.send(scan)
  })
}

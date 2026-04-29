import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { linkAnalysisQueue, bulkScanQueue } from '../workers'

const queuePluginFn: FastifyPluginAsync = async (app) => {
  app.decorate('queues', { linkAnalysis: linkAnalysisQueue, bulkScan: bulkScanQueue })

  app.addHook('onClose', async () => {
    await linkAnalysisQueue.close()
    await bulkScanQueue.close()
  })
}

export const queuePlugin = fp(queuePluginFn, { name: 'queue' })

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      linkAnalysis: typeof linkAnalysisQueue
      bulkScan: typeof bulkScanQueue
    }
  }
}

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { logger } from '../config/logger'

let linkAnalysisQueue: any
let bulkScanQueue: any

try {
  const workers = require('../workers')
  linkAnalysisQueue = workers.linkAnalysisQueue
  bulkScanQueue = workers.bulkScanQueue
} catch (err) {
  logger.warn({ err }, 'Queue initialization failed — queuing disabled')
}

const queuePluginFn: FastifyPluginAsync = async (app) => {
  app.decorate('queues', {
    linkAnalysis: linkAnalysisQueue || null,
    bulkScan: bulkScanQueue || null,
  })

  app.addHook('onClose', async () => {
    try {
      if (linkAnalysisQueue) await linkAnalysisQueue.close()
      if (bulkScanQueue) await bulkScanQueue.close()
    } catch (err) {
      logger.warn({ err }, 'Error closing queues')
    }
  })
}

export const queuePlugin = fp(queuePluginFn, { name: 'queue' })

declare module 'fastify' {
  interface FastifyInstance {
    queues: {
      linkAnalysis: any
      bulkScan: any
    }
  }
}

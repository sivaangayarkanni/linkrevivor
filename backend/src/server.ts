/**
 * LinkRevive Backend — Fastify server entry point
 *
 * Architecture decisions:
 * - Fastify over Express: 2x faster, schema-first validation, TypeScript-first
 * - Plugin-based design keeps each concern isolated and testable
 * - Graceful shutdown ensures in-flight jobs complete before process exits
 */

import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import helmet from '@fastify/helmet'
import { linkRoutes } from './routes/links'
import { scanRoutes } from './routes/scan'
import { healthRoutes } from './routes/health'
import { redisPlugin } from './plugins/redis'
import { prismaPlugin } from './plugins/prisma'
import { queuePlugin } from './plugins/queue'
import { authPlugin } from './plugins/auth'
import { env } from './config/env'
import { logger } from './config/logger'

const app = Fastify({
  logger: false, // We use our own structured logger
  trustProxy: true, // Required for accurate IP behind load balancer
  ajv: {
    customOptions: {
      removeAdditional: true,  // Strip unknown fields for security
      useDefaults: true,
      coerceTypes: true,
    },
  },
})

async function bootstrap() {
  // Security headers first — highest priority
  await app.register(helmet, {
    contentSecurityPolicy: false, // CSP managed at CDN level
  })

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(','),
    methods: ['GET', 'POST'],
    credentials: true,
  })

  // Infrastructure plugins (order matters — routes depend on these)
  await app.register(redisPlugin)
  await app.register(prismaPlugin)
  await app.register(queuePlugin)
  await app.register(authPlugin)

  // Rate limiting — use Redis if available, fall back to in-memory
  const redisStatus = await app.redis.ping().catch(() => null)
  await app.register(rateLimit, {
    redis: redisStatus ? app.redis : undefined,
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) =>
      (request.headers['x-api-key'] as string) || request.ip,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Authenticated API keys get higher limits.',
    }),
  })

  // Routes
  await app.register(healthRoutes, { prefix: '/health' })
  await app.register(linkRoutes, { prefix: '/api/v1/links' })
  await app.register(scanRoutes, { prefix: '/api/v1/scan' })

  // Global error handler — ensures consistent error shape for all clients
  app.setErrorHandler((error, request, reply) => {
    logger.error({ err: error, url: request.url }, 'Unhandled error')

    if (error.validation) {
      return reply.status(400).send({
        error: 'Validation Error',
        details: error.validation,
      })
    }

    const statusCode = error.statusCode || 500
    reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
      requestId: request.id,
    })
  })

  const port = env.PORT
  await app.listen({ port, host: '0.0.0.0' })
  logger.info(`LinkRevive API listening on port ${port}`)
}

// Graceful shutdown — let BullMQ workers drain before exit
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down gracefully...`)
  await app.close()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start server')
  process.exit(1)
})

export { app }

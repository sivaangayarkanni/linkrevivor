/**
 * Redis Fastify plugin — exposes app.redis and a standalone redis singleton
 * Used by: rate limiter, cache layer, BullMQ queue broker
 */

import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env'
import { logger } from '../config/logger'

// Singleton used by services (outside Fastify context)
export let redis: Redis

const redisPluginFn: FastifyPluginAsync = async (app) => {
  // Upstash and other TLS Redis providers use rediss:// — handle TLS automatically
  const isTLS = env.REDIS_URL.startsWith('rediss://')

  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    tls: isTLS ? { rejectUnauthorized: false } : undefined,
  })

  await client.connect()

  client.on('error', (err) => logger.error({ err }, 'Redis error'))
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'))

  // Share singleton with non-Fastify services
  redis = client

  app.decorate('redis', client)

  app.addHook('onClose', async () => {
    await client.quit()
    logger.info('Redis connection closed')
  })
}

export const redisPlugin = fp(redisPluginFn, {
  name: 'redis',
})

// Extend Fastify type to include app.redis
declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis
  }
}

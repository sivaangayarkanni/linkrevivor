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
  
  // Parse URL manually for explicit connection config
  // ioredis handles rediss:// URLs better with explicit options
  const parsedUrl = new URL(env.REDIS_URL)

  const client = new Redis({
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port) || (isTLS ? 6380 : 6379),
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
    tls: isTLS ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  })

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

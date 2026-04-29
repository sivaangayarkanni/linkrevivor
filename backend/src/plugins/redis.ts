/**
 * Redis Fastify plugin — exposes app.redis and a standalone redis singleton
 * Used by: rate limiter, cache layer, BullMQ queue broker
 *
 * Redis is treated as optional — the app starts and serves requests even if
 * Redis is unavailable. Caching and queuing are degraded but core link
 * checking still works.
 */

import fp from 'fastify-plugin'
import { Redis } from 'ioredis'
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env'
import { logger } from '../config/logger'

// Singleton used by services (outside Fastify context)
// May be null if Redis is unavailable
export let redis: Redis

function createRedisClient(): Redis {
  const isTLS = env.REDIS_URL.startsWith('rediss://')
  const parsedUrl = new URL(env.REDIS_URL)

  return new Redis({
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port) || 6379,
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    username: parsedUrl.username && parsedUrl.username !== 'default'
      ? decodeURIComponent(parsedUrl.username)
      : undefined,
    tls: isTLS ? { rejectUnauthorized: false } : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
    retryStrategy: (times) => {
      if (times > 5) return null // Stop retrying after 5 attempts
      return Math.min(times * 500, 3000)
    },
  })
}

const redisPluginFn: FastifyPluginAsync = async (app) => {
  const client = createRedisClient()

  client.on('error', (err) => logger.error({ err }, 'Redis error'))
  client.on('connect', () => logger.info('Redis connected'))
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'))

  // Try to connect — but don't crash if it fails
  try {
    await client.connect()
    logger.info('Redis connection established')
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable — caching and queuing disabled')
  }

  // Swallow all future Redis errors — never let Redis crash the process
  client.on('error', () => {}) // suppress unhandled error events after startup

  // Share singleton regardless — services check connection state before using
  redis = client

  app.decorate('redis', client)

  app.addHook('onClose', async () => {
    try {
      await client.quit()
    } catch (_) {}
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

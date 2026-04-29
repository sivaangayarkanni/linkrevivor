/**
 * Redis plugin — uses @upstash/redis HTTP client
 *
 * Replaces ioredis TCP connection with Upstash REST API over HTTPS.
 * This avoids all ECONNRESET / TLS issues with serverless environments.
 *
 * For BullMQ (which requires ioredis), we keep a separate ioredis instance
 * but make it optional — queues degrade gracefully if Redis is unavailable.
 */

import fp from 'fastify-plugin'
import { Redis as UpstashRedis } from '@upstash/redis'
import { Redis as IORedis } from 'ioredis'
import type { FastifyPluginAsync } from 'fastify'
import { env } from '../config/env'
import { logger } from '../config/logger'

// ── Upstash HTTP client — used for all caching operations ──────────────────
// This is the primary Redis client. Works over HTTPS, no TCP issues.
export const redis = new UpstashRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
})

// ── ioredis TCP client — used only by BullMQ ───────────────────────────────
// BullMQ requires ioredis. We create it but don't crash if it fails.
export let ioredis: IORedis | null = null

function createIORedisClient(): IORedis | null {
  try {
    const isTLS = env.REDIS_URL.startsWith('rediss://')
    const parsedUrl = new URL(env.REDIS_URL)
    const client = new IORedis({
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
      connectTimeout: 8000,
      retryStrategy: (times) => times > 2 ? null : times * 1000,
    })
    client.on('error', () => {}) // suppress errors — BullMQ is optional
    return client
  } catch {
    return null
  }
}

const redisPluginFn: FastifyPluginAsync = async (app) => {
  // Test Upstash HTTP connection
  try {
    await redis.ping()
    logger.info('Upstash Redis connected via HTTP ✅')
  } catch (err) {
    logger.warn({ err }, 'Upstash Redis ping failed — caching degraded')
  }

  // Create ioredis for BullMQ (optional)
  ioredis = createIORedisClient()
  if (ioredis) {
    try {
      await ioredis.connect()
      logger.info('ioredis connected for BullMQ ✅')
    } catch {
      logger.warn('ioredis unavailable — BullMQ queuing disabled')
      ioredis = null
    }
  }

  // Decorate Fastify with both clients
  app.decorate('redis', redis)
  app.decorate('ioredis', ioredis)

  app.addHook('onClose', async () => {
    try { if (ioredis) await ioredis.quit() } catch {}
  })
}

export const redisPlugin = fp(redisPluginFn, { name: 'redis' })

declare module 'fastify' {
  interface FastifyInstance {
    redis: UpstashRedis
    ioredis: IORedis | null
  }
}

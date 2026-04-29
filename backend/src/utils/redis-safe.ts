/**
 * Safe Redis helpers — uses Upstash HTTP client.
 * Returns null/void instead of throwing when Redis is unavailable.
 */

import { redis } from '../plugins/redis'
import { logger } from '../config/logger'

export async function safeGet(key: string): Promise<string | null> {
  try {
    const val = await redis.get<string>(key)
    return val ?? null
  } catch {
    return null
  }
}

export async function safeSetex(key: string, ttl: number, value: string): Promise<void> {
  try {
    await redis.setex(key, ttl, value)
  } catch (err) {
    logger.warn({ err, key }, 'Redis setex failed — skipping cache write')
  }
}

/**
 * Safe Redis helpers — gracefully handle Redis being unavailable.
 * All functions return null/void instead of throwing when Redis is down.
 */

import { redis } from '../plugins/redis'
import { logger } from '../config/logger'

export async function safeGet(key: string): Promise<string | null> {
  try {
    if (!redis || redis.status === 'end' || redis.status === 'close') return null
    return await redis.get(key)
  } catch {
    return null
  }
}

export async function safeSetex(key: string, ttl: number, value: string): Promise<void> {
  try {
    if (!redis || redis.status === 'end' || redis.status === 'close') return
    await redis.setex(key, ttl, value)
  } catch (err) {
    logger.warn({ err, key }, 'Redis setex failed — skipping cache write')
  }
}

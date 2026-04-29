/**
 * Auth Plugin — API key validation for extension and developer access
 *
 * Two access tiers:
 * - Anonymous: 100 req/min, instant=false only
 * - Authenticated (X-API-Key): 1000 req/min, instant=true allowed
 *
 * For MVP, API keys are stored as hashed values in Redis.
 * In production, move to DB-backed keys with user accounts.
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { safeGet } from '../utils/redis-safe'
import { env } from '../config/env'
import crypto from 'crypto'

const authPluginFn: FastifyPluginAsync = async (app) => {
  app.decorateRequest('isAuthenticated', false)
  app.decorateRequest('apiKeyId', null)

  app.addHook('onRequest', async (request) => {
    const apiKey = request.headers['x-api-key'] as string | undefined
    if (!apiKey) return

    // Hash the key before Redis lookup (never store raw keys)
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')
    const keyData = await safeGet(`apikey:${keyHash}`)

    if (keyData) {
      request.isAuthenticated = true
      request.apiKeyId = JSON.parse(keyData).id
    }
  })
}

export const authPlugin = fp(authPluginFn, { name: 'auth' })

declare module 'fastify' {
  interface FastifyRequest {
    isAuthenticated: boolean
    apiKeyId: string | null
  }
}

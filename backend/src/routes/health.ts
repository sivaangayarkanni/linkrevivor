import type { FastifyPluginAsync } from 'fastify'
import { aiProviderManager } from '../services/ai-providers/provider-manager'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (request, reply) => {
    // Check critical dependencies
    const [dbOk, redisOk, aiProviders] = await Promise.all([
      app.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      app.redis.ping().then(r => r === 'PONG').catch(() => false),
      aiProviderManager.getProviderStatus().catch(() => []),
    ])

    const status = dbOk && redisOk ? 200 : 503
    return reply.status(status).send({
      status: status === 200 ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
      ai: {
        providers: aiProviders,
        hasAvailable: aiProviders.some(p => p.available)
      },
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    })
  })

  // Kubernetes liveness probe — just needs a 200
  app.get('/live', async (_, reply) => reply.send({ ok: true }))

  // Kubernetes readiness probe — check deps
  app.get('/ready', async (_, reply) => {
    const redisOk = await app.redis.ping().then(r => r === 'PONG').catch(() => false)
    if (!redisOk) return reply.status(503).send({ ready: false })
    return reply.send({ ready: true })
  })

  // AI providers status endpoint
  app.get('/ai', async (_, reply) => {
    const providers = await aiProviderManager.getProviderStatus()
    return reply.send({
      providers,
      hasAvailable: providers.some(p => p.available),
      timestamp: new Date().toISOString()
    })
  })
}

import fp from 'fastify-plugin'
import { PrismaClient } from '@prisma/client'
import type { FastifyPluginAsync } from 'fastify'
import { logger } from '../config/logger'

export let prisma: PrismaClient

const prismaPluginFn: FastifyPluginAsync = async (app) => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? [{ emit: 'event', level: 'query' }]
      : [],
  })

  await client.$connect()
  prisma = client

  app.decorate('prisma', client)

  app.addHook('onClose', async () => {
    await client.$disconnect()
    logger.info('Prisma connection closed')
  })
}

export const prismaPlugin = fp(prismaPluginFn, { name: 'prisma' })

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient
  }
}

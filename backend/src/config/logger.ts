import pino from 'pino'
import { env } from './env'

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  base: { service: 'linkrevive-api' },
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
})

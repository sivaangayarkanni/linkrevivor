/**
 * Centralized environment configuration with runtime validation.
 * Fail fast at startup rather than silently using undefined values.
 */

import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),

  // Security
  API_SECRET_KEY: z.string().min(32, 'API secret must be at least 32 chars'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),

  // External APIs
  GOOGLE_CUSTOM_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_CUSTOM_SEARCH_CX: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // Local AI (Ollama)
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_MODEL: z.string().default('llama3.1:8b'),

  // Feature flags
  ENABLE_AI_EXPLANATIONS: z.coerce.boolean().default(true),
  MAX_BULK_LINKS: z.coerce.number().default(100),

  // Cache TTLs (seconds)
  CACHE_TTL_LINK_RESULT: z.coerce.number().default(3600),       // 1 hour
  CACHE_TTL_ARCHIVE: z.coerce.number().default(86400),           // 24 hours
  CACHE_TTL_ALTERNATIVES: z.coerce.number().default(43200),      // 12 hours
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('❌ Invalid environment configuration:')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = z.infer<typeof envSchema>

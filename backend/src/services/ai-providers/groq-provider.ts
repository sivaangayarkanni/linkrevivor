/**
 * Groq AI Provider
 *
 * Uses Groq's ultra-fast inference API (free tier, generous limits).
 * Model: llama-3.3-70b-versatile — best quality on Groq free tier.
 * Groq is OpenAI-compatible so the SDK is straightforward.
 */

import Groq from 'groq-sdk'
import { BaseAIProvider, AIMessage, AIResponse, AIStreamChunk, AIProviderError } from './base-provider'
import { env } from '../../config/env'
import { logger } from '../../config/logger'

export class GroqProvider extends BaseAIProvider {
  name = 'groq'
  private client: Groq
  private defaultModel = 'llama-3.3-70b-versatile'

  constructor() {
    super()
    this.client = new Groq({ apiKey: env.GROQ_API_KEY })
  }

  async isAvailable(): Promise<boolean> {
    if (!env.GROQ_API_KEY) return false
    try {
      // Lightweight check — list models
      await this.client.models.list()
      return true
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Groq provider unavailable')
      return false
    }
  }

  async generateResponse(
    messages: AIMessage[],
    options: { maxTokens?: number; temperature?: number; model?: string } = {}
  ): Promise<AIResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature ?? 0.7,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
      })

      const content = response.choices[0]?.message?.content || ''

      return {
        content,
        usage: {
          inputTokens: response.usage?.prompt_tokens || 0,
          outputTokens: response.usage?.completion_tokens || 0,
        },
      }
    } catch (error: any) {
      const isRateLimit = error.status === 429
      const retryAfter = error.headers?.['retry-after']
        ? parseInt(error.headers['retry-after'])
        : undefined
      throw new AIProviderError(
        error.message || 'Groq API error',
        this.name,
        isRateLimit,
        retryAfter
      )
    }
  }

  async *generateStream(
    messages: AIMessage[],
    options: { maxTokens?: number; temperature?: number; model?: string } = {}
  ): AsyncGenerator<AIStreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature ?? 0.7,
        messages: messages.map(m => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
        })),
        stream: true,
      })

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content
        if (delta) {
          yield { content: delta, done: false }
        }
        if (chunk.choices[0]?.finish_reason) {
          yield { content: '', done: true }
          return
        }
      }

      yield { content: '', done: true }
    } catch (error: any) {
      const isRateLimit = error.status === 429
      throw new AIProviderError(
        `Groq streaming error: ${error.message}`,
        this.name,
        isRateLimit
      )
    }
  }
}

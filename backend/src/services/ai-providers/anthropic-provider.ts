/**
 * Anthropic Claude Provider
 * 
 * Wraps the Anthropic API with error handling and rate limiting detection.
 */

import Anthropic from '@anthropic-ai/sdk'
import { BaseAIProvider, AIMessage, AIResponse, AIStreamChunk, AIProviderError } from './base-provider'
import { env } from '../../config/env'
import { logger } from '../../config/logger'

export class AnthropicProvider extends BaseAIProvider {
  name = 'anthropic'
  private client: Anthropic
  private defaultModel = 'claude-3-sonnet-20240229'

  constructor() {
    super()
    this.client = new Anthropic({ 
      apiKey: env.ANTHROPIC_API_KEY 
    })
  }

  async isAvailable(): Promise<boolean> {
    if (!env.ANTHROPIC_API_KEY) {
      return false
    }
    
    try {
      // Test with a minimal request
      await this.client.messages.create({
        model: this.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }]
      })
      return true
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Anthropic provider unavailable')
      return false
    }
  }

  async generateResponse(
    messages: AIMessage[],
    options: {
      maxTokens?: number
      temperature?: number
      model?: string
    } = {}
  ): Promise<AIResponse> {
    try {
      const systemMessage = messages.find(m => m.role === 'system')?.content
      const userMessages = messages.filter(m => m.role !== 'system')

      const response = await this.client.messages.create({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature,
        system: systemMessage,
        messages: userMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      })

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as any).text)
        .join('')

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens
        }
      }
    } catch (error: any) {
      this.handleError(error)
      throw error // Re-throw after handling
    }
  }

  async *generateStream(
    messages: AIMessage[],
    options: {
      maxTokens?: number
      temperature?: number
      model?: string
    } = {}
  ): AsyncGenerator<AIStreamChunk> {
    try {
      const systemMessage = messages.find(m => m.role === 'system')?.content
      const userMessages = messages.filter(m => m.role !== 'system')

      const stream = this.client.messages.stream({
        model: options.model || this.defaultModel,
        max_tokens: options.maxTokens || 1024,
        temperature: options.temperature,
        system: systemMessage,
        messages: userMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        }))
      })

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          yield {
            content: chunk.delta.text,
            done: false
          }
        }
      }

      yield { content: '', done: true }
    } catch (error: any) {
      this.handleError(error)
      throw error
    }
  }

  private handleError(error: any): void {
    const isRateLimit = error.status === 429 || 
                       error.message?.includes('rate limit') ||
                       error.message?.includes('quota')

    const retryAfter = error.headers?.['retry-after'] 
      ? parseInt(error.headers['retry-after']) 
      : undefined

    throw new AIProviderError(
      error.message || 'Anthropic API error',
      this.name,
      isRateLimit,
      retryAfter
    )
  }
}
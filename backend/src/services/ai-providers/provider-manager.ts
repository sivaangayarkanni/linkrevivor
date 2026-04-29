/**
 * AI Provider Manager
 * 
 * Manages multiple AI providers with automatic failover.
 * Tries providers in order: Anthropic -> OpenAI -> Ollama (local)
 */

import { BaseAIProvider, AIMessage, AIResponse, AIStreamChunk, AIProviderError } from './base-provider'
import { AnthropicProvider } from './anthropic-provider'
import { OllamaProvider } from './ollama-provider'
import { GroqProvider } from './groq-provider'
import { logger } from '../../config/logger'
import { safeGet, safeSetex } from '../../utils/redis-safe'

export class AIProviderManager {
  private providers: BaseAIProvider[]
  private circuitBreaker: Map<string, { failures: number; lastFailure: number }> = new Map()
  private readonly maxFailures = 3
  private readonly breakerTimeout = 300000 // 5 minutes

  constructor() {
    // Priority order: Groq (free, fast) → Anthropic → Ollama (local)
    this.providers = [
      new GroqProvider(),
      new AnthropicProvider(),
      new OllamaProvider(),
    ]
  }

  /**
   * Get the first available provider, respecting circuit breaker state
   */
  async getAvailableProvider(): Promise<BaseAIProvider | null> {
    for (const provider of this.providers) {
      if (this.isCircuitOpen(provider.name)) {
        logger.debug({ provider: provider.name }, 'Provider circuit breaker open, skipping')
        continue
      }

      try {
        const isAvailable = await provider.isAvailable()
        if (isAvailable) {
          // Reset circuit breaker on successful connection
          this.circuitBreaker.delete(provider.name)
          return provider
        }
      } catch (error) {
        logger.warn({ provider: provider.name, error }, 'Provider availability check failed')
        this.recordFailure(provider.name)
      }
    }

    return null
  }

  /**
   * Generate response with automatic provider failover
   */
  async generateResponse(
    messages: AIMessage[],
    options?: {
      maxTokens?: number
      temperature?: number
      model?: string
    }
  ): Promise<AIResponse> {
    const errors: Error[] = []

    for (const provider of this.providers) {
      if (this.isCircuitOpen(provider.name)) {
        continue
      }

      try {
        logger.debug({ provider: provider.name }, 'Attempting AI generation')
        const response = await provider.generateResponse(messages, options)
        
        // Reset circuit breaker on success
        this.circuitBreaker.delete(provider.name)
        
        // Cache successful response
        await this.cacheResponse(messages, response, provider.name)
        
        return response
      } catch (error) {
        logger.warn({ provider: provider.name, error }, 'AI provider failed')
        errors.push(error as Error)
        
        if (error instanceof AIProviderError) {
          this.recordFailure(provider.name, error.isRateLimit)
          
          // If rate limited, wait before trying next provider
          if (error.isRateLimit && error.retryAfter) {
            logger.info({ 
              provider: provider.name, 
              retryAfter: error.retryAfter 
            }, 'Rate limited, waiting before next provider')
            await new Promise(resolve => setTimeout(resolve, Math.min(error.retryAfter! * 1000, 5000)))
          }
        } else {
          this.recordFailure(provider.name)
        }
      }
    }

    // All providers failed, check cache
    const cached = await this.getCachedResponse(messages)
    if (cached) {
      logger.info('Returning cached AI response after all providers failed')
      return cached
    }

    // No cache available, throw the most relevant error
    const rateLimit = errors.find(e => e instanceof AIProviderError && e.isRateLimit)
    throw rateLimit || errors[0] || new Error('All AI providers unavailable')
  }

  /**
   * Generate streaming response with automatic provider failover
   */
  async *generateStream(
    messages: AIMessage[],
    options?: {
      maxTokens?: number
      temperature?: number
      model?: string
    }
  ): AsyncGenerator<AIStreamChunk> {
    for (const provider of this.providers) {
      if (this.isCircuitOpen(provider.name)) {
        continue
      }

      try {
        logger.debug({ provider: provider.name }, 'Attempting AI streaming')
        
        let fullContent = ''
        for await (const chunk of provider.generateStream(messages, options)) {
          fullContent += chunk.content
          yield chunk
          
          if (chunk.done) {
            // Cache the complete response
            await this.cacheResponse(messages, { content: fullContent }, provider.name)
            // Reset circuit breaker on success
            this.circuitBreaker.delete(provider.name)
            return
          }
        }
      } catch (error) {
        logger.warn({ provider: provider.name, error }, 'AI streaming provider failed')
        
        if (error instanceof AIProviderError) {
          this.recordFailure(provider.name, error.isRateLimit)
        } else {
          this.recordFailure(provider.name)
        }
        
        // Continue to next provider
        continue
      }
    }

    // All streaming providers failed, try to get cached response
    const cached = await this.getCachedResponse(messages)
    if (cached) {
      logger.info('Returning cached AI response as stream after all providers failed')
      // Simulate streaming from cache
      const words = cached.content.split(' ')
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(' ') + ' '
        yield { content: chunk, done: false }
        await new Promise(resolve => setTimeout(resolve, 50)) // Simulate typing
      }
      yield { content: '', done: true }
      return
    }

    throw new Error('All AI providers unavailable for streaming')
  }

  private isCircuitOpen(providerName: string): boolean {
    const breaker = this.circuitBreaker.get(providerName)
    if (!breaker) return false

    const now = Date.now()
    if (breaker.failures >= this.maxFailures) {
      if (now - breaker.lastFailure > this.breakerTimeout) {
        // Reset circuit breaker after timeout
        this.circuitBreaker.delete(providerName)
        return false
      }
      return true
    }
    return false
  }

  private recordFailure(providerName: string, isRateLimit: boolean = false): void {
    const breaker = this.circuitBreaker.get(providerName) || { failures: 0, lastFailure: 0 }
    breaker.failures += 1
    breaker.lastFailure = Date.now()
    
    // Rate limits count as more severe failures
    if (isRateLimit) {
      breaker.failures += 2
    }
    
    this.circuitBreaker.set(providerName, breaker)
    
    logger.warn({ 
      provider: providerName, 
      failures: breaker.failures,
      isRateLimit 
    }, 'Recorded AI provider failure')
  }

  private async cacheResponse(
    messages: AIMessage[], 
    response: AIResponse, 
    provider: string
  ): Promise<void> {
    try {
      const cacheKey = `ai:response:${this.hashMessages(messages)}`
      const cacheData = {
        ...response,
        provider,
        timestamp: Date.now()
      }
      await safeSetex(cacheKey, 86400, JSON.stringify(cacheData))
    } catch (error) {
      logger.warn({ error }, 'Failed to cache AI response')
    }
  }

  private async getCachedResponse(messages: AIMessage[]): Promise<AIResponse | null> {
    try {
      const cacheKey = `ai:response:${this.hashMessages(messages)}`
      const cached = await safeGet(cacheKey)
      
      if (cached) {
        const data = JSON.parse(cached)
        logger.info({ provider: data.provider }, 'Using cached AI response')
        return {
          content: data.content,
          usage: data.usage
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to retrieve cached AI response')
    }
    
    return null
  }

  private hashMessages(messages: AIMessage[]): string {
    const content = messages.map(m => `${m.role}:${m.content}`).join('|')
    // Simple hash function
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Get status of all providers
   */
  async getProviderStatus(): Promise<Array<{
    name: string
    available: boolean
    circuitOpen: boolean
    failures: number
  }>> {
    const status = []
    
    for (const provider of this.providers) {
      const breaker = this.circuitBreaker.get(provider.name)
      const circuitOpen = this.isCircuitOpen(provider.name)
      
      let available = false
      try {
        available = !circuitOpen && await provider.isAvailable()
      } catch (error) {
        available = false
      }
      
      status.push({
        name: provider.name,
        available,
        circuitOpen,
        failures: breaker?.failures || 0
      })
    }
    
    return status
  }
}

export const aiProviderManager = new AIProviderManager()
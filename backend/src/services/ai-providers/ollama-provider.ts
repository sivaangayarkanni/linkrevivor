/**
 * Ollama Local AI Provider
 * 
 * Provides local AI inference using Ollama.
 * This serves as the ultimate fallback when external APIs are unavailable.
 */

import got from 'got'
import { BaseAIProvider, AIMessage, AIResponse, AIStreamChunk, AIProviderError } from './base-provider'
import { env } from '../../config/env'
import { logger } from '../../config/logger'

export class OllamaProvider extends BaseAIProvider {
  name = 'ollama'
  private baseUrl: string
  private defaultModel: string

  constructor() {
    super()
    this.baseUrl = env.OLLAMA_BASE_URL || 'http://localhost:11434'
    this.defaultModel = env.OLLAMA_MODEL || 'llama3.1:8b'
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama server is running
      const response = await got(`${this.baseUrl}/api/tags`, {
        timeout: { request: 3000 },
        responseType: 'json'
      })
      
      const models = (response.body as any).models || []
      const hasModel = models.some((m: any) => m.name.includes(this.defaultModel.split(':')[0]))
      
      if (!hasModel) {
        logger.warn({ 
          availableModels: models.map((m: any) => m.name),
          requestedModel: this.defaultModel 
        }, 'Ollama model not found')
        return false
      }
      
      return true
    } catch (error: any) {
      logger.debug({ error: error.message }, 'Ollama not available')
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
      const prompt = this.formatMessages(messages)
      
      const response = await got.post(`${this.baseUrl}/api/generate`, {
        json: {
          model: options.model || this.defaultModel,
          prompt,
          stream: false,
          options: {
            temperature: options.temperature || 0.7,
            num_predict: options.maxTokens || 1024,
          }
        },
        timeout: { request: 60000 }, // Ollama can be slow
        responseType: 'json'
      })

      const body = response.body as any
      
      return {
        content: body.response || '',
        usage: {
          inputTokens: this.estimateTokens(prompt),
          outputTokens: this.estimateTokens(body.response || '')
        }
      }
    } catch (error: any) {
      throw new AIProviderError(
        `Ollama error: ${error.message}`,
        this.name,
        false // Ollama doesn't have rate limits
      )
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
      const prompt = this.formatMessages(messages)
      
      const response = got.stream.post(`${this.baseUrl}/api/generate`, {
        json: {
          model: options.model || this.defaultModel,
          prompt,
          stream: true,
          options: {
            temperature: options.temperature || 0.7,
            num_predict: options.maxTokens || 1024,
          }
        },
        timeout: { request: 60000 }
      })

      let buffer = ''
      
      for await (const chunk of response) {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line)
              if (data.response) {
                yield {
                  content: data.response,
                  done: false
                }
              }
              if (data.done) {
                yield {
                  content: '',
                  done: true
                }
                return
              }
            } catch (parseError) {
              // Skip malformed JSON lines
              continue
            }
          }
        }
      }
    } catch (error: any) {
      throw new AIProviderError(
        `Ollama streaming error: ${error.message}`,
        this.name,
        false
      )
    }
  }

  private formatMessages(messages: AIMessage[]): string {
    // Convert messages to a single prompt format for Ollama
    const systemMessage = messages.find(m => m.role === 'system')
    const userMessages = messages.filter(m => m.role !== 'system')
    
    let prompt = ''
    
    if (systemMessage) {
      prompt += `System: ${systemMessage.content}\n\n`
    }
    
    for (const message of userMessages) {
      if (message.role === 'user') {
        prompt += `Human: ${message.content}\n\n`
      } else if (message.role === 'assistant') {
        prompt += `Assistant: ${message.content}\n\n`
      }
    }
    
    prompt += 'Assistant: '
    
    return prompt
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }
}
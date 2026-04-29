/**
 * Base AI Provider Interface
 * 
 * Defines the contract that all AI providers must implement.
 * This allows for easy switching between Anthropic, OpenAI, Ollama, etc.
 */

export interface AIMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AIResponse {
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

export interface AIStreamChunk {
  content: string
  done: boolean
}

export abstract class BaseAIProvider {
  abstract name: string
  abstract isAvailable(): Promise<boolean>
  
  abstract generateResponse(
    messages: AIMessage[],
    options?: {
      maxTokens?: number
      temperature?: number
      model?: string
    }
  ): Promise<AIResponse>
  
  abstract generateStream(
    messages: AIMessage[],
    options?: {
      maxTokens?: number
      temperature?: number
      model?: string
    }
  ): AsyncGenerator<AIStreamChunk>
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: string,
    public isRateLimit: boolean = false,
    public retryAfter?: number
  ) {
    super(message)
    this.name = 'AIProviderError'
  }
}
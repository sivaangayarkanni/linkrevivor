/**
 * AIExplainer — Multi-provider AI content analysis and comparison
 *
 * Responsibilities:
 * 1. Summarize archived content (what did this page contain?)
 * 2. Compare archived content vs alternatives (what changed?)
 * 3. Rate how outdated content is (0.0 = current, 1.0 = completely outdated)
 * 4. Generate a recommendation (which alternative to use?)
 *
 * Provider Strategy:
 * - Primary: Anthropic Claude (best quality)
 * - Fallback: Ollama local models (always available)
 * - Automatic failover with circuit breaker pattern
 * - Intelligent caching and rate limit handling
 */

import { env } from '../config/env'
import { redis } from '../plugins/redis'
import { logger } from '../config/logger'
import { aiProviderManager } from './ai-providers/provider-manager'
import type { AIMessage } from './ai-providers/base-provider'
import type { AlternativeResult } from './alternative-finder'

export interface AIExplanation {
  summary: string            // What the archived page was about
  outdatedScore: number      // 0.0 to 1.0
  whatChanged: string        // Key differences vs alternatives
  recommendation: string     // Which alternative to use and why
  recommendedUrl: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface AIStreamChunk {
  type: 'summary' | 'comparison' | 'recommendation' | 'done'
  content: string
}

export class AIExplainer {
  private readonly MAX_INPUT_CHARS = 6000  // ~1500 tokens

  /**
   * Generate a full explanation for a dead link.
   * Non-streaming version — results are cached.
   */
  async explain(
    deadUrl: string,
    archiveContent: string | null,
    alternatives: AlternativeResult[],
  ): Promise<AIExplanation> {
    const cacheKey = `ai:explanation:${deadUrl}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as AIExplanation
    }

    if (!env.ENABLE_AI_EXPLANATIONS) {
      return this.buildFallbackExplanation(deadUrl, alternatives)
    }

    const truncatedContent = archiveContent
      ? archiveContent.slice(0, this.MAX_INPUT_CHARS)
      : null

    const messages = this.buildMessages(deadUrl, truncatedContent, alternatives)

    try {
      const response = await aiProviderManager.generateResponse(messages, {
        maxTokens: 1024,
        temperature: 0.3
      })

      const parsed = this.parseStructuredResponse(response.content, alternatives)

      // Cache for 7 days — AI analysis of a dead link won't change
      await redis.setex(cacheKey, 60 * 60 * 24 * 7, JSON.stringify(parsed))

      return parsed
    } catch (err) {
      logger.error({ err, url: deadUrl }, 'AI explanation failed')
      return this.buildFallbackExplanation(deadUrl, alternatives)
    }
  }

  /**
   * Stream an explanation — used by the frontend for a more dynamic UX.
   * Yields chunks as they arrive from the AI provider.
   */
  async *explainStream(
    deadUrl: string,
    archiveContent: string | null,
    alternatives: AlternativeResult[],
  ): AsyncGenerator<AIStreamChunk> {
    const truncated = archiveContent?.slice(0, this.MAX_INPUT_CHARS) || null
    const messages = this.buildMessages(deadUrl, truncated, alternatives)

    let buffer = ''
    let phase: AIStreamChunk['type'] = 'summary'

    try {
      for await (const chunk of aiProviderManager.generateStream(messages, {
        maxTokens: 1024,
        temperature: 0.3
      })) {
        if (chunk.done) {
          // Emit remaining buffer
          if (buffer.trim()) {
            yield { type: phase, content: buffer.trim() }
          }
          yield { type: 'done', content: '' }
          return
        }

        buffer += chunk.content

        // Detect phase transitions from the structured output format
        if (buffer.includes('[COMPARISON]') && phase === 'summary') {
          const [summaryPart] = buffer.split('[COMPARISON]')
          yield { type: 'summary', content: summaryPart.replace('[SUMMARY]', '').trim() }
          buffer = buffer.split('[COMPARISON]')[1] || ''
          phase = 'comparison'
        } else if (buffer.includes('[RECOMMENDATION]') && phase === 'comparison') {
          const [compPart] = buffer.split('[RECOMMENDATION]')
          yield { type: 'comparison', content: compPart.trim() }
          buffer = buffer.split('[RECOMMENDATION]')[1] || ''
          phase = 'recommendation'
        }
      }
    } catch (err) {
      logger.error({ err, url: deadUrl }, 'AI streaming failed')
      // Fallback to non-streaming
      const fallback = await this.explain(deadUrl, archiveContent, alternatives)
      yield { type: 'summary', content: fallback.summary }
      yield { type: 'comparison', content: fallback.whatChanged }
      yield { type: 'recommendation', content: fallback.recommendation }
      yield { type: 'done', content: '' }
    }
  }

  private get systemPrompt(): string {
    return `You are a technical research assistant specialized in analyzing dead web pages and finding replacements.
    
Your role is to:
1. Analyze archived web content and explain what it was about
2. Compare it against modern alternatives 
3. Recommend the best replacement resource

Be concise, technical, and specific. Avoid vague statements. If content involves code/APIs, mention language/version specifics.

Always structure your response using these exact markers:
[SUMMARY] ... [COMPARISON] ... [RECOMMENDATION] ...`
  }

  private buildMessages(
    deadUrl: string,
    archiveContent: string | null,
    alternatives: AlternativeResult[],
  ): AIMessage[] {
    const altList = alternatives
      .slice(0, 5)
      .map((a, i) => `${i + 1}. ${a.title}\n   URL: ${a.url}\n   ${a.snippet}`)
      .join('\n\n')

    const userPrompt = `Dead URL: ${deadUrl}

${archiveContent ? `ARCHIVED CONTENT (truncated):
${archiveContent}

` : 'No archived content available.\n\n'}FOUND ALTERNATIVES:
${altList || 'No alternatives found.'}

Please analyze this dead link and:
1. [SUMMARY] Summarize what the original page contained (2-3 sentences)
2. [COMPARISON] Compare the archived content with the alternatives. What's changed? Is the content outdated?
3. [RECOMMENDATION] Which alternative best replaces the original? Why? Include the exact URL.

Also provide at the end: OUTDATED_SCORE: [0.0-1.0] (0.0=still current, 1.0=completely obsolete)
CONFIDENCE: [HIGH/MEDIUM/LOW]`

    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  }

  private parseStructuredResponse(
    text: string,
    alternatives: AlternativeResult[],
  ): AIExplanation {
    const summaryMatch = text.match(/\[SUMMARY\]([\s\S]*?)(?=\[COMPARISON\]|$)/)?.[1]?.trim() || ''
    const comparisonMatch = text.match(/\[COMPARISON\]([\s\S]*?)(?=\[RECOMMENDATION\]|$)/)?.[1]?.trim() || ''
    const recommendationMatch = text.match(/\[RECOMMENDATION\]([\s\S]*?)(?=OUTDATED_SCORE:|$)/)?.[1]?.trim() || ''
    const outdatedMatch = text.match(/OUTDATED_SCORE:\s*([\d.]+)/)?.[1]
    const confidenceMatch = text.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/)?.[1]

    // Extract recommended URL from the recommendation text
    const urlMatch = recommendationMatch.match(/https?:\/\/[^\s)]+/)
    const recommendedUrl = urlMatch?.[0] || alternatives[0]?.url || null

    return {
      summary: summaryMatch,
      whatChanged: comparisonMatch,
      recommendation: recommendationMatch,
      recommendedUrl,
      outdatedScore: outdatedMatch ? parseFloat(outdatedMatch) : 0.5,
      confidence: (confidenceMatch as AIExplanation['confidence']) || 'MEDIUM',
    }
  }

  private buildFallbackExplanation(
    deadUrl: string,
    alternatives: AlternativeResult[],
  ): AIExplanation {
    return {
      summary: `This URL (${deadUrl}) is no longer accessible.`,
      whatChanged: 'Analysis unavailable — AI service disabled or rate limited.',
      recommendation: alternatives.length > 0
        ? `Consider ${alternatives[0].title} as a potential replacement.`
        : 'No alternatives found for this URL.',
      recommendedUrl: alternatives[0]?.url || null,
      outdatedScore: 0.5,
      confidence: 'LOW',
    }
  }
}

export const aiExplainer = new AIExplainer()

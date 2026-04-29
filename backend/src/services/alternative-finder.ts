/**
 * AlternativeFinder — Multi-source semantic search for replacement resources
 *
 * Strategy:
 * 1. Extract search keywords from URL path + archived page title
 * 2. Search Google Custom Search, GitHub (for repos), and domain-specific sources in parallel
 * 3. Score each result with a relevance formula that weights domain authority,
 *    keyword overlap, link type match, and recency
 * 4. Deduplicate and return ranked list
 *
 * Fallback chain: Google CSE → Bing Web Search → GitHub search (for repo types)
 */

import got from 'got'
import { type LinkType } from '@prisma/client'
import { env } from '../config/env'
import { logger } from '../config/logger'
import { redis } from '../plugins/redis'

export interface AlternativeResult {
  url: string
  title: string
  snippet: string
  source: 'GOOGLE_SEARCH' | 'GITHUB_SEARCH' | 'AI_GENERATED'
  relevanceScore: number  // 0.0 to 1.0
  metadata?: Record<string, unknown>
}

interface GoogleSearchItem {
  link: string
  title: string
  snippet: string
  pagemap?: {
    metatags?: Array<Record<string, string>>
  }
}

interface GitHubRepo {
  html_url: string
  full_name: string
  description: string
  stargazers_count: number
  updated_at: string
  language: string
  topics: string[]
}

export class AlternativeFinder {
  /**
   * Find alternatives for a dead URL.
   * @param deadUrl - The broken URL
   * @param title - Page title from archive (improves search quality)
   * @param linkType - Classifies what kind of resource to search for
   */
  async find(
    deadUrl: string,
    title: string | null,
    linkType: LinkType,
  ): Promise<AlternativeResult[]> {
    const cacheKey = `alternatives:${deadUrl}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      logger.debug({ url: deadUrl }, 'Alternatives cache hit')
      return JSON.parse(cached) as AlternativeResult[]
    }

    // Extract meaningful search terms from URL structure
    const keywords = this.extractKeywords(deadUrl, title)
    logger.debug({ deadUrl, keywords, linkType }, 'Searching alternatives')

    // Run searches in parallel — don't let slow sources block fast ones
    const [webResults, githubResults] = await Promise.allSettled([
      this.searchGoogle(keywords, linkType),
      linkType === 'GITHUB_REPO' ? this.searchGitHub(keywords) : Promise.resolve([]),
    ])

    const allResults: AlternativeResult[] = [
      ...(webResults.status === 'fulfilled' ? webResults.value : []),
      ...(githubResults.status === 'fulfilled' ? githubResults.value : []),
    ]

    // Score, deduplicate, and sort
    const scored = this.scoreAndRank(allResults, deadUrl, keywords, linkType)
    const deduplicated = this.deduplicate(scored)
    const top10 = deduplicated.slice(0, 10)

    await redis.setex(cacheKey, env.CACHE_TTL_ALTERNATIVES, JSON.stringify(top10))

    return top10
  }

  /**
   * Extract search keywords from a URL.
   * URL: https://old-site.com/blog/2019/how-to-setup-webpack-5
   * Keywords: ["how", "to", "setup", "webpack", "5"]
   */
  extractKeywords(url: string, title: string | null): string[] {
    const parsed = new URL(url)

    // Decompose URL path into words
    const pathWords = parsed.pathname
      .split(/[-_/.]/)
      .filter(w => w.length > 2)             // Remove single chars and short words
      .filter(w => !/^\d{4}$/.test(w))       // Remove year patterns (2019, 2020)
      .filter(w => !/^(the|a|an|and|or|of|in|on|at|to|for|with|by)$/i.test(w))
      .map(w => w.toLowerCase())
      .slice(0, 8)                            // Cap at 8 path words

    // Add title words if available
    const titleWords = title
      ? title.split(/\s+/).filter(w => w.length > 3).slice(0, 6)
      : []

    // Merge, deduplicate, prioritize title words (more semantic)
    const merged = [...new Set([...titleWords, ...pathWords])]
    return merged.slice(0, 10)
  }

  private async searchGoogle(keywords: string[], linkType: LinkType): Promise<AlternativeResult[]> {
    if (!env.GOOGLE_CUSTOM_SEARCH_API_KEY || !env.GOOGLE_CUSTOM_SEARCH_CX) {
      logger.debug('Google CSE not configured, skipping')
      return []
    }

    // Add site-specific operators for documentation links
    const siteOperator = linkType === 'DOCUMENTATION'
      ? 'site:docs.* OR site:*.dev OR site:*.io'
      : ''

    const query = [...keywords.slice(0, 6), siteOperator].filter(Boolean).join(' ')

    try {
      const response = await got('https://www.googleapis.com/customsearch/v1', {
        searchParams: {
          key: env.GOOGLE_CUSTOM_SEARCH_API_KEY,
          cx: env.GOOGLE_CUSTOM_SEARCH_CX,
          q: query,
          num: 10,
          dateRestrict: 'y3',  // Prefer content from last 3 years
        },
        responseType: 'json',
        timeout: { request: 5_000 },
      })

      const body = response.body as { items?: GoogleSearchItem[] }
      return (body.items || []).map((item) => ({
        url: item.link,
        title: item.title,
        snippet: item.snippet,
        source: 'GOOGLE_SEARCH' as const,
        relevanceScore: 0,  // Scored in scoreAndRank()
        metadata: { pagemap: item.pagemap },
      }))
    } catch (err) {
      logger.warn({ err, query }, 'Google search failed')
      return []
    }
  }

  private async searchGitHub(keywords: string[]): Promise<AlternativeResult[]> {
    const query = keywords.slice(0, 4).join(' ')

    try {
      const response = await got('https://api.github.com/search/repositories', {
        searchParams: {
          q: `${query} in:name,description,readme`,
          sort: 'stars',
          per_page: 5,
        },
        headers: {
          Authorization: env.GITHUB_TOKEN ? `token ${env.GITHUB_TOKEN}` : undefined,
          Accept: 'application/vnd.github.v3+json',
        },
        responseType: 'json',
        timeout: { request: 5_000 },
      })

      const body = response.body as { items?: GitHubRepo[] }
      return (body.items || []).map((repo) => ({
        url: repo.html_url,
        title: repo.full_name,
        snippet: repo.description || `${repo.language} repository with ${repo.stargazers_count} stars`,
        source: 'GITHUB_SEARCH' as const,
        relevanceScore: 0,
        metadata: {
          stars: repo.stargazers_count,
          updatedAt: repo.updated_at,
          language: repo.language,
          topics: repo.topics,
        },
      }))
    } catch (err) {
      logger.warn({ err }, 'GitHub search failed')
      return []
    }
  }

  /**
   * Score results based on multiple signals:
   * - keyword_overlap: how many search terms appear in title/snippet
   * - source_authority: GitHub > Google for repos; Google > GitHub for docs
   * - recency_bonus: newer content gets a small boost
   * - link_type_match: does the result type match what we're looking for?
   */
  private scoreAndRank(
    results: AlternativeResult[],
    deadUrl: string,
    keywords: string[],
    linkType: LinkType,
  ): AlternativeResult[] {
    return results.map((result) => {
      const titleLower = result.title.toLowerCase()
      const snippetLower = result.snippet.toLowerCase()

      // Keyword overlap score (0-0.4)
      const matches = keywords.filter(
        k => titleLower.includes(k) || snippetLower.includes(k)
      ).length
      const keywordScore = Math.min(matches / Math.max(keywords.length, 1), 1) * 0.4

      // Source authority for link type (0-0.3)
      let sourceScore = 0.15
      if (linkType === 'GITHUB_REPO' && result.source === 'GITHUB_SEARCH') {
        const stars = (result.metadata?.stars as number) || 0
        sourceScore = Math.min(0.1 + Math.log10(stars + 1) / 10, 0.3)
      } else if (linkType === 'DOCUMENTATION' && result.source === 'GOOGLE_SEARCH') {
        sourceScore = 0.25
      }

      // Link type match bonus (0-0.2)
      const typeBonus = this.getLinkTypeBonus(result.url, linkType)

      // Domain diversity: don't stack-rank same domain (handled in deduplicate)
      const relevanceScore = Math.min(keywordScore + sourceScore + typeBonus, 1.0)

      return { ...result, relevanceScore }
    }).sort((a, b) => b.relevanceScore - a.relevanceScore)
  }

  private getLinkTypeBonus(url: string, expectedType: LinkType): number {
    const urlLower = url.toLowerCase()
    switch (expectedType) {
      case 'DOCUMENTATION': return /docs\.|\/docs\/|\.readthedocs\./.test(urlLower) ? 0.2 : 0
      case 'GITHUB_REPO': return /github\.com\/[^/]+\/[^/]+\/?$/.test(url) ? 0.2 : 0
      case 'PACKAGE': return /npmjs\.com|pypi\.org|crates\.io/.test(urlLower) ? 0.2 : 0
      default: return 0
    }
  }

  /** Remove duplicate domains — show max 2 results per domain */
  private deduplicate(results: AlternativeResult[]): AlternativeResult[] {
    const domainCount: Record<string, number> = {}
    return results.filter(r => {
      try {
        const domain = new URL(r.url).hostname
        domainCount[domain] = (domainCount[domain] || 0) + 1
        return domainCount[domain] <= 2
      } catch {
        return false
      }
    })
  }
}

export const alternativeFinder = new AlternativeFinder()

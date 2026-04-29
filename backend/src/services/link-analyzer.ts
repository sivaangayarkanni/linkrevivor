/**
 * LinkAnalyzer — Core service for detecting broken URLs
 *
 * Design principles:
 * - Never follow redirects blindly: track the full chain to catch redirect loops
 * - SSRF protection: validate URLs before fetching (blocks private IP ranges)
 * - Classify link type from URL patterns before fetching for early cache key optimization
 * - Timeout aggressively: we'd rather classify as "timeout" than hang a worker
 */

import dns from 'dns/promises'
import { URL } from 'url'
import got, { type Response, HTTPError, TimeoutError } from 'got'
import { type LinkType, type ErrorType } from '@prisma/client'
import { logger } from '../config/logger'
import { isPrivateIP } from '../utils/ssrf-guard'

// Private IP ranges that must never be fetched (SSRF prevention)
const BLOCKED_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./, // Link-local
  /^::1$/,
  /^fc00:/,
]

export interface AnalysisResult {
  url: string
  isAlive: boolean
  statusCode: number | null
  errorType: ErrorType | null
  errorDetail: string | null
  responseMs: number
  finalUrl: string          // After redirects
  redirectChain: string[]
  contentType: string | null
  linkType: LinkType
  title: string | null
}

export class LinkAnalyzer {
  private readonly REQUEST_TIMEOUT_MS = 10_000
  private readonly MAX_REDIRECTS = 10

  async analyze(rawUrl: string): Promise<AnalysisResult> {
    const startTime = Date.now()

    // Step 1: Parse and validate URL structure
    let parsedUrl: URL
    try {
      parsedUrl = new URL(rawUrl)
    } catch {
      return this.buildErrorResult(rawUrl, null, 'DNS_FAILURE', `Invalid URL: ${rawUrl}`, startTime)
    }

    // Only HTTP/HTTPS — block file://, ftp://, etc.
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return this.buildErrorResult(rawUrl, null, 'DNS_FAILURE', `Unsupported protocol: ${parsedUrl.protocol}`, startTime)
    }

    // Step 2: DNS resolution + SSRF check
    // We resolve DNS before fetching to prevent SSRF attacks
    let resolvedIPs: string[]
    try {
      const records = await dns.resolve4(parsedUrl.hostname).catch(() => [])
      const records6 = await dns.resolve6(parsedUrl.hostname).catch(() => [])
      resolvedIPs = [...records, ...records6]

      if (resolvedIPs.length === 0) {
        return this.buildErrorResult(rawUrl, null, 'DNS_FAILURE', `DNS resolution failed for ${parsedUrl.hostname}`, startTime)
      }

      // SSRF guard: reject if any resolved IP is private
      for (const ip of resolvedIPs) {
        if (isPrivateIP(ip, BLOCKED_IP_RANGES)) {
          logger.warn({ url: rawUrl, ip }, 'SSRF attempt blocked')
          return this.buildErrorResult(rawUrl, null, 'DNS_FAILURE', 'URL resolves to private IP range', startTime)
        }
      }
    } catch (err) {
      return this.buildErrorResult(rawUrl, null, 'DNS_FAILURE', `DNS error: ${String(err)}`, startTime)
    }

    // Step 3: HTTP request
    // Use HEAD first (fast), fall back to GET for servers that don't support HEAD
    const linkType = this.classifyLinkType(rawUrl)
    let response: Response<string> | null = null
    let fetchError: Error | null = null

    for (const method of ['HEAD', 'GET'] as const) {
      try {
        response = await got(rawUrl, {
          method,
          followRedirect: true,
          maxRedirects: this.MAX_REDIRECTS,
          timeout: { request: this.REQUEST_TIMEOUT_MS },
          throwHttpErrors: false, // We handle errors ourselves
          headers: {
            'User-Agent': 'LinkRevive/1.0 (link health checker; https://linkrevive.io)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        }) as Response<string>

        // Some CDNs return 405 for HEAD — fall through to GET
        if (method === 'HEAD' && response.statusCode === 405) {
          continue
        }
        break
      } catch (err) {
        fetchError = err as Error
        if (err instanceof TimeoutError) {
          return this.buildErrorResult(rawUrl, linkType, 'TIMEOUT', 'Request timed out', startTime)
        }
        if (method === 'HEAD') continue // Try GET fallback
        break
      }
    }

    if (!response) {
      const errorDetail = fetchError?.message || 'Unknown connection error'
      const errorType = errorDetail.includes('ECONNREFUSED') ? 'CONNECTION_REFUSED' : 'DNS_FAILURE'
      return this.buildErrorResult(rawUrl, linkType, errorType as ErrorType, errorDetail, startTime)
    }

    // Step 4: Classify result
    const statusCode = response.statusCode
    const isAlive = statusCode >= 200 && statusCode < 400
    const redirectChain = response.redirectUrls?.map(u => u.toString()) || []
    const finalUrl = redirectChain[redirectChain.length - 1] || rawUrl

    let errorType: ErrorType | null = null
    if (statusCode === 404) errorType = 'HTTP_404'
    else if (statusCode === 410) errorType = 'HTTP_410'
    else if (statusCode >= 500) errorType = 'HTTP_5XX'
    else if (!isAlive) errorType = 'HTTP_404' // Catch-all for 4xx

    // Extract page title for dead pages (we may have content from GET)
    const title = this.extractTitle(response.body)

    return {
      url: rawUrl,
      isAlive,
      statusCode,
      errorType,
      errorDetail: isAlive ? null : `HTTP ${statusCode}`,
      responseMs: Date.now() - startTime,
      finalUrl,
      redirectChain,
      contentType: response.headers['content-type'] || null,
      linkType,
      title,
    }
  }

  /**
   * Classify URL type from patterns — no fetching needed.
   * Used for cache key partitioning and UI display.
   */
  classifyLinkType(url: string): LinkType {
    const lower = url.toLowerCase()

    if (/github\.com\/[^/]+\/[^/]+\/?$/.test(url)) return 'GITHUB_REPO'
    if (/\.(pdf)(\?|$)/.test(lower)) return 'PDF'
    if (/docs\.|\/docs\/|\/documentation\/|\.readthedocs\./.test(lower)) return 'DOCUMENTATION'
    if (/npmjs\.com|pypi\.org|crates\.io|packagist\.org/.test(lower)) return 'PACKAGE'
    if (/youtube\.com|vimeo\.com|youtu\.be/.test(lower)) return 'VIDEO'
    if (/stackoverflow\.com|reddit\.com|forum|discuss/.test(lower)) return 'FORUM'
    if (/dev\.to|medium\.com|hashnode\.com|substack\.com|blog/.test(lower)) return 'BLOG_POST'
    if (/news\.ycombinator\.com|techcrunch|theverge|wired/.test(lower)) return 'NEWS'

    return 'UNKNOWN'
  }

  private extractTitle(html: string | undefined): string | null {
    if (!html) return null
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    return match?.[1]?.trim().slice(0, 500) || null
  }

  private buildErrorResult(
    url: string,
    linkType: LinkType | null,
    errorType: ErrorType,
    errorDetail: string,
    startTime: number,
  ): AnalysisResult {
    return {
      url,
      isAlive: false,
      statusCode: null,
      errorType,
      errorDetail,
      responseMs: Date.now() - startTime,
      finalUrl: url,
      redirectChain: [],
      contentType: null,
      linkType: linkType || 'UNKNOWN',
      title: null,
    }
  }
}

export const linkAnalyzer = new LinkAnalyzer()

/**
 * PageCrawler — Extract all links from a webpage for bulk analysis
 *
 * Uses cheerio for HTML parsing (fast, no headless browser needed).
 * Normalizes relative URLs to absolute using the page's base URL.
 * Filters out non-HTTP links, same-page anchors, and asset URLs.
 */

import got from 'got'
import * as cheerio from 'cheerio'
import { isPrivateIP } from '../utils/ssrf-guard'
import { logger } from '../config/logger'

const BLOCKED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.mp3', '.webm', '.zip', '.tar', '.gz',
])

export interface ExtractedLink {
  url: string
  anchorText: string
}

export class PageCrawler {
  async extractLinks(pageUrl: string): Promise<ExtractedLink[]> {
    let html: string
    try {
      const response = await got(pageUrl, {
        timeout: { request: 15_000 },
        throwHttpErrors: true,
        headers: {
          'User-Agent': 'LinkRevive/1.0 (bulk link scanner)',
        },
      })
      html = response.body
    } catch (err) {
      logger.warn({ pageUrl, err }, 'Failed to fetch page for bulk scan')
      throw new Error(`Cannot fetch page: ${String(err)}`)
    }

    const $ = cheerio.load(html)
    const baseUrl = this.getBaseUrl($, pageUrl)
    const seen = new Set<string>()
    const links: ExtractedLink[] = []

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href')?.trim()
      if (!href) return

      // Normalize to absolute URL
      let absoluteUrl: string
      try {
        absoluteUrl = new URL(href, baseUrl).toString()
      } catch {
        return  // Skip malformed hrefs
      }

      // Filters
      if (!absoluteUrl.startsWith('http')) return           // No mailto:, tel:, etc.
      if (absoluteUrl.includes('#') && !href.startsWith('#')) {
        absoluteUrl = absoluteUrl.split('#')[0]             // Strip anchors
      }
      if (seen.has(absoluteUrl)) return                     // Deduplicate
      if (this.isAssetUrl(absoluteUrl)) return              // Skip assets

      seen.add(absoluteUrl)
      links.push({
        url: absoluteUrl,
        anchorText: $(el).text().trim().slice(0, 200),
      })
    })

    logger.info({ pageUrl, count: links.length }, 'Extracted links from page')
    return links
  }

  private getBaseUrl($: cheerio.CheerioAPI, pageUrl: string): string {
    const base = $('base[href]').attr('href')
    if (base) {
      try { return new URL(base, pageUrl).toString() } catch {}
    }
    return pageUrl
  }

  private isAssetUrl(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase()
      const ext = '.' + pathname.split('.').pop()
      return BLOCKED_EXTENSIONS.has(ext)
    } catch {
      return false
    }
  }
}

export const pageCrawler = new PageCrawler()

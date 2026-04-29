/**
 * ArchiveFetcher — Wayback Machine integration
 *
 * Wayback CDX API is used for efficient snapshot queries (vs the slower Availability API)
 * because CDX returns structured data with timestamps and we need timeline data.
 *
 * CDX API docs: https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
 */

import got from 'got'
import { logger } from '../config/logger'
import { safeGet, safeSetex } from '../utils/redis-safe'
import { env } from '../config/env'

export interface ArchiveSnapshot {
  timestamp: string      // YYYYMMDDHHmmss format
  url: string           // Canonical archived URL
  statusCode: number
  mimeType: string
  length: number
  playbackUrl: string   // Full Wayback Machine playback URL
}

export interface ArchiveResult {
  hasArchive: boolean
  latestSnapshot: ArchiveSnapshot | null
  snapshotCount: number
  timeline: ArchiveSnapshot[]  // Last 10 snapshots for the timeline UI
  oldestSnapshot: ArchiveSnapshot | null
}

const CDX_API = 'https://web.archive.org/cdx/search/cdx'
const WAYBACK_BASE = 'https://web.archive.org/web'

export class ArchiveFetcher {
  /**
   * Fetch archive information for a URL.
   * Returns the latest good snapshot plus a timeline for the UI.
   *
   * @param url - The dead URL to look up
   * @param maxTimeline - How many historical snapshots to return (for timeline UI)
   */
  async fetch(url: string, maxTimeline = 10): Promise<ArchiveResult> {
    const cacheKey = `archive:${url}`

    // Check cache first — Wayback results don't change often
    const cached = await safeGet(cacheKey)
    if (cached) {
      logger.debug({ url }, 'Archive cache hit')
      return JSON.parse(cached) as ArchiveResult
    }

    // Fetch latest good snapshot
    const latestSnapshot = await this.fetchLatestSnapshot(url)

    // Fetch snapshot timeline (for the timeline component)
    const timeline = await this.fetchTimeline(url, maxTimeline)

    // Oldest snapshot gives users context for how long a resource existed
    const oldestSnapshot = await this.fetchOldestSnapshot(url)

    const result: ArchiveResult = {
      hasArchive: latestSnapshot !== null,
      latestSnapshot,
      snapshotCount: await this.fetchSnapshotCount(url),
      timeline,
      oldestSnapshot,
    }

    // Cache for 24 hours — archives are stable
    await safeSetex(cacheKey, env.CACHE_TTL_ARCHIVE, JSON.stringify(result))

    return result
  }

  private async fetchLatestSnapshot(url: string): Promise<ArchiveSnapshot | null> {
    try {
      const params = new URLSearchParams({
        url,
        output: 'json',
        fl: 'timestamp,original,statuscode,mimetype,length',
        filter: 'statuscode:200',  // Only fetch successful archives
        limit: '1',
        fastLatest: 'true',        // CDX optimization: return latest without full scan
      })

      const response = await got(`${CDX_API}?${params}`, {
        timeout: { request: 8_000 },
        responseType: 'json',
      })

      const rows = response.body as string[][]
      if (!rows || rows.length === 0) return null

      const [timestamp, original, statusCode, mimeType, length] = rows[0]
      return this.buildSnapshot(timestamp, original, statusCode, mimeType, length)
    } catch (err) {
      logger.warn({ url, err }, 'Failed to fetch latest Wayback snapshot')
      return null
    }
  }

  private async fetchTimeline(url: string, limit: number): Promise<ArchiveSnapshot[]> {
    try {
      // Collapse by year to get meaningful timeline points, not every crawl
      const params = new URLSearchParams({
        url,
        output: 'json',
        fl: 'timestamp,original,statuscode,mimetype,length',
        filter: 'statuscode:200',
        limit: String(limit),
        collapse: 'timestamp:6',  // Collapse by YYYYMM (monthly granularity)
      })

      const response = await got(`${CDX_API}?${params}`, {
        timeout: { request: 8_000 },
        responseType: 'json',
      })

      const rows = response.body as string[][]
      if (!rows) return []

      return rows.map(([timestamp, original, statusCode, mimeType, length]) =>
        this.buildSnapshot(timestamp, original, statusCode, mimeType, length)
      )
    } catch (err) {
      logger.warn({ url, err }, 'Failed to fetch Wayback timeline')
      return []
    }
  }

  private async fetchOldestSnapshot(url: string): Promise<ArchiveSnapshot | null> {
    try {
      const params = new URLSearchParams({
        url,
        output: 'json',
        fl: 'timestamp,original,statuscode,mimetype,length',
        filter: 'statuscode:200',
        limit: '1',
        // No fastLatest = scans from beginning
      })

      const response = await got(`${CDX_API}?${params}`, {
        timeout: { request: 8_000 },
        responseType: 'json',
      })

      const rows = response.body as string[][]
      if (!rows || rows.length === 0) return null

      const [timestamp, original, statusCode, mimeType, length] = rows[0]
      return this.buildSnapshot(timestamp, original, statusCode, mimeType, length)
    } catch {
      return null
    }
  }

  private async fetchSnapshotCount(url: string): Promise<number> {
    try {
      const params = new URLSearchParams({
        url,
        output: 'json',
        fl: 'timestamp',
        limit: '1000',
      })

      // CDX returns one JSON array per snapshot — count is array length
      const response = await got(`${CDX_API}?${params}`, {
        timeout: { request: 5_000 },
        responseType: 'json',
      })

      return Array.isArray(response.body) ? (response.body as unknown[]).length : 0
    } catch {
      return 0
    }
  }

  private buildSnapshot(
    timestamp: string,
    original: string,
    statusCode: string,
    mimeType: string,
    length: string,
  ): ArchiveSnapshot {
    return {
      timestamp,
      url: original,
      statusCode: parseInt(statusCode) || 200,
      mimeType,
      length: parseInt(length) || 0,
      // Wayback playback URL format: /web/{timestamp}/{original_url}
      playbackUrl: `${WAYBACK_BASE}/${timestamp}/${original}`,
    }
  }

  /**
   * Parse Wayback timestamp (YYYYMMDDHHmmss) to ISO date string
   */
  static parseTimestamp(ts: string): Date {
    return new Date(
      `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T` +
      `${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`
    )
  }
}

export const archiveFetcher = new ArchiveFetcher()

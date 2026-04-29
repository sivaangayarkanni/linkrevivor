/**
 * Shared TypeScript types for API request/response shapes.
 * Keep in sync with backend service interfaces.
 */

export type LinkType =
  | 'DOCUMENTATION'
  | 'BLOG_POST'
  | 'GITHUB_REPO'
  | 'PDF'
  | 'VIDEO'
  | 'TOOL'
  | 'PACKAGE'
  | 'NEWS'
  | 'FORUM'
  | 'UNKNOWN'

export type ErrorType =
  | 'HTTP_404'
  | 'HTTP_410'
  | 'HTTP_5XX'
  | 'TIMEOUT'
  | 'DNS_FAILURE'
  | 'SSL_ERROR'
  | 'CONNECTION_REFUSED'
  | 'REDIRECT_LOOP'

export interface LinkAnalysis {
  url: string
  isAlive: boolean
  statusCode: number | null
  errorType: ErrorType | null
  errorDetail: string | null
  responseMs: number
  finalUrl: string
  redirectChain: string[]
  contentType: string | null
  linkType: LinkType
  title: string | null
}

export interface ArchiveSnapshot {
  timestamp: string
  url: string
  statusCode: number
  mimeType: string
  length: number
  playbackUrl: string
}

export interface ArchiveResult {
  hasArchive: boolean
  latestSnapshot: ArchiveSnapshot | null
  snapshotCount: number
  timeline: ArchiveSnapshot[]
  oldestSnapshot: ArchiveSnapshot | null
}

export interface AlternativeResult {
  url: string
  title: string
  snippet: string
  source: 'GOOGLE_SEARCH' | 'GITHUB_SEARCH' | 'AI_GENERATED'
  relevanceScore: number
  metadata?: Record<string, unknown>
}

export interface AIExplanation {
  summary: string
  outdatedScore: number
  whatChanged: string
  recommendation: string
  recommendedUrl: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface AIChunk {
  type: 'summary' | 'comparison' | 'recommendation' | 'done'
  content: string
}

export interface BulkScanResult {
  id: string
  pageUrl: string
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  totalLinks: number
  checkedLinks: number
  brokenLinks: number
  items: BulkScanItem[]
  createdAt: string
  completedAt: string | null
}

export interface BulkScanItem {
  url: string
  anchorText: string | null
  statusCode: number | null
  isBroken: boolean
}

// API response envelope
export interface ApiResponse<T> {
  data?: T
  error?: string
  details?: unknown
}

export interface JobResponse {
  jobId: string
  message: string
  pollUrl: string
}

export interface JobStatusResponse {
  state: 'waiting' | 'active' | 'completed' | 'failed'
  progress: number
  data?: {
    linkId: string
    checkId: string
    isAlive: boolean
  }
}

/**
 * LinkRevive Extension — Background Service Worker (Manifest v3)
 *
 * Responsibilities:
 * 1. Intercept navigation events to detect broken pages (4xx, 5xx, DNS failures)
 * 2. Queue URL analysis via the LinkRevive API
 * 3. Send messages to content script to show the overlay UI
 * 4. Maintain a local cache of recently checked URLs (chrome.storage.local)
 *
 * Design note: Service workers in MV3 are event-driven and can be killed between events.
 * We cannot hold state in module-level variables that persists across events.
 * All persistent state must go through chrome.storage.
 */

const API_BASE = 'https://api.linkrevive.io' // Change to localhost:3001 for dev
const CACHE_TTL_MS = 60 * 60 * 1000          // 1 hour
const ERROR_STATUS_CODES = new Set([404, 410, 500, 502, 503, 504])

// ─── Navigation listener ─────────────────────────────────────────────────────

/**
 * Fires when a navigation completes.
 * We check the HTTP status via webNavigation + webRequest correlation.
 */
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only track main frame navigations (not iframes, assets)
  if (details.frameId !== 0) return
  if (!details.url.startsWith('http')) return

  // Check our local cache first
  const cached = await getCachedResult(details.url)
  if (cached) {
    if (!cached.isAlive) {
      await notifyContentScript(details.tabId, cached)
    }
    return
  }

  // Fetch analysis from API
  const result = await analyzeUrl(details.url)
  if (result) {
    await cacheResult(details.url, result)
    if (!result.isAlive) {
      await notifyContentScript(details.tabId, result)
    }
  }
})

// Also catch navigation errors (DNS failure, connection refused)
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return

  const errorResult: CachedResult = {
    url: details.url,
    isAlive: false,
    statusCode: null,
    errorType: mapExtensionError(details.error),
    hasArchive: false,
    alternatives: [],
    checkedAt: Date.now(),
  }

  await cacheResult(details.url, errorResult)
  await notifyContentScript(details.tabId, errorResult)
})

// ─── API communication ────────────────────────────────────────────────────────

interface CachedResult {
  url: string
  isAlive: boolean
  statusCode: number | null
  errorType: string | null
  hasArchive: boolean
  archiveUrl?: string
  alternatives: Array<{ title: string; url: string; relevanceScore: number }>
  checkedAt: number
}

async function analyzeUrl(url: string): Promise<CachedResult | null> {
  try {
    const apiKey = await getApiKey()

    const response = await fetch(`${API_BASE}/api/v1/links/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ url, instant: true }),
    })

    if (!response.ok) {
      console.warn('[LinkRevive] API error:', response.status)
      return null
    }

    const data = await response.json()
    return {
      url,
      isAlive: data.analysis?.isAlive ?? true,
      statusCode: data.analysis?.statusCode ?? null,
      errorType: data.analysis?.errorType ?? null,
      hasArchive: data.archive?.hasArchive ?? false,
      archiveUrl: data.archive?.latestSnapshot?.playbackUrl,
      alternatives: (data.alternatives || []).slice(0, 3),
      checkedAt: Date.now(),
    }
  } catch (err) {
    console.error('[LinkRevive] Failed to analyze URL:', err)
    return null
  }
}

async function notifyContentScript(tabId: number, result: CachedResult) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'LINK_DEAD',
      data: result,
    })
  } catch {
    // Tab might have navigated away — safe to ignore
  }
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

async function getCachedResult(url: string): Promise<CachedResult | null> {
  const key = `cache:${url}`
  const stored = await chrome.storage.local.get(key)
  const entry = stored[key] as CachedResult | undefined

  if (!entry) return null
  if (Date.now() - entry.checkedAt > CACHE_TTL_MS) {
    // Expired — delete and return null
    await chrome.storage.local.remove(key)
    return null
  }

  return entry
}

async function cacheResult(url: string, result: CachedResult) {
  const key = `cache:${url}`
  await chrome.storage.local.set({ [key]: result })
}

async function getApiKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get('apiKey')
  return (stored.apiKey as string) || null
}

// ─── Message handler (from popup or content script) ────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    // Popup asking for current tab's status
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0]
      if (!tab?.url) { sendResponse(null); return }

      const cached = await getCachedResult(tab.url)
      sendResponse(cached)
    })
    return true // Keep channel open for async sendResponse
  }

  if (message.type === 'SET_API_KEY') {
    chrome.storage.local.set({ apiKey: message.apiKey })
    sendResponse({ ok: true })
  }

  if (message.type === 'REANALYZE') {
    const { url, tabId } = message
    analyzeUrl(url).then(result => {
      if (result) {
        cacheResult(url, result)
        if (!result.isAlive) notifyContentScript(tabId, result)
      }
    })
    sendResponse({ queued: true })
  }
})

// ─── Utilities ────────────────────────────────────────────────────────────────

function mapExtensionError(error: string): string {
  if (error.includes('NAME_NOT_RESOLVED') || error.includes('dns')) return 'DNS_FAILURE'
  if (error.includes('CONNECTION_REFUSED')) return 'CONNECTION_REFUSED'
  if (error.includes('TIMED_OUT')) return 'TIMEOUT'
  return 'DNS_FAILURE'
}

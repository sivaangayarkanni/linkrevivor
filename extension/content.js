/**
 * LinkRevive Content Script
 *
 * Injected into every page. Listens for LINK_DEAD messages from the
 * background worker and injects a non-intrusive overlay at the bottom
 * of the viewport.
 *
 * Design principles:
 * - Shadow DOM isolates our styles from the page's CSS
 * - Never modify the page's DOM structure — only append/remove our overlay
 * - Overlay is dismissible with one click and stays dismissed for this navigation
 */

;(function () {
  'use strict'

  let overlayRoot = null
  let dismissed = false

  // ─── Message listener ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'LINK_DEAD' && !dismissed) {
      showOverlay(message.data)
    }
  })

  // ─── Overlay ────────────────────────────────────────────────────────────────

  function showOverlay(data) {
    if (overlayRoot) overlayRoot.remove()

    // Use Shadow DOM for style isolation
    const host = document.createElement('div')
    host.id = 'linkrevive-host'
    host.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;pointer-events:none'

    const shadow = host.attachShadow({ mode: 'closed' })

    const styles = `
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .bar {
        background: rgba(10,10,11,0.95);
        border-top: 1px solid rgba(255,255,255,0.1);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        padding: 12px 20px;
        display: flex;
        align-items: center;
        gap: 16px;
        pointer-events: all;
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        animation: slideUp 0.3s ease;
      }

      @keyframes slideUp {
        from { transform: translateY(100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .icon {
        width: 28px;
        height: 28px;
        background: #ff4444;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        font-size: 14px;
      }

      .text-wrap { flex: 1; min-width: 0; }
      .headline { color: #fff; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
      .sub { color: rgba(255,255,255,0.4); font-size: 11px; margin-top: 2px; }

      .actions { display: flex; gap: 8px; flex-shrink: 0; }

      .btn {
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 6px;
        transition: opacity 0.15s;
      }
      .btn:hover { opacity: 0.85; }

      .btn-primary { background: #00ff88; color: #000; }
      .btn-secondary { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
      .btn-ghost { background: transparent; color: rgba(255,255,255,0.3); padding: 6px 8px; }

      .alt-list {
        margin-top: 10px;
        border-top: 1px solid rgba(255,255,255,0.08);
        padding-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .alt-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,0.04);
        cursor: pointer;
        text-decoration: none;
        transition: background 0.15s;
      }
      .alt-item:hover { background: rgba(255,255,255,0.08); }
      .alt-title { color: #fff; font-size: 11px; flex: 1; min-width: 0; }
      .alt-url { color: rgba(255,255,255,0.3); font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
      .alt-score { color: #00ff88; font-size: 10px; flex-shrink: 0; }
    `

    const hasAlternatives = data.alternatives?.length > 0

    shadow.innerHTML = `
      <style>${styles}</style>
      <div class="bar">
        <div class="icon">💀</div>
        <div class="text-wrap">
          <div class="headline">This page is unavailable</div>
          <div class="sub">
            ${data.statusCode ? `HTTP ${data.statusCode}` : data.errorType || 'Dead link'} ·
            ${hasAlternatives ? `${data.alternatives.length} alternative${data.alternatives.length > 1 ? 's' : ''} found` : 'Searching alternatives...'}
          </div>
          ${hasAlternatives ? `
          <div class="alt-list">
            ${data.alternatives.slice(0, 3).map(alt => `
              <a class="alt-item" href="${escapeHtml(alt.url)}" target="_blank" rel="noopener">
                <span class="alt-title">${escapeHtml(alt.title)}</span>
                <span class="alt-url">${escapeHtml(new URL(alt.url).hostname)}</span>
                <span class="alt-score">${Math.round(alt.relevanceScore * 100)}%</span>
              </a>
            `).join('')}
          </div>` : ''}
        </div>
        <div class="actions">
          ${data.hasArchive ? `
            <button class="btn btn-secondary" id="lr-archive">View Archive</button>
          ` : ''}
          <button class="btn btn-primary" id="lr-full">Full Analysis</button>
          <button class="btn btn-ghost" id="lr-dismiss">✕</button>
        </div>
      </div>
    `

    // Event listeners
    shadow.getElementById('lr-dismiss')?.addEventListener('click', () => {
      dismissed = true
      host.remove()
    })

    shadow.getElementById('lr-archive')?.addEventListener('click', () => {
      if (data.archiveUrl) {
        window.open(data.archiveUrl, '_blank', 'noopener')
      }
    })

    shadow.getElementById('lr-full')?.addEventListener('click', () => {
      const analysisUrl = `https://linkrevive.io/?url=${encodeURIComponent(data.url)}`
      window.open(analysisUrl, '_blank', 'noopener')
    })

    document.body.appendChild(host)
    overlayRoot = host
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]))
  }
})()

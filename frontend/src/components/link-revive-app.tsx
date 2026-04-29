'use client'

import { useState, useRef, useCallback } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────

type Phase = 'idle' | 'checking' | 'archive' | 'alternatives' | 'ai' | 'done' | 'error'

interface Analysis {
  url: string
  isAlive: boolean
  statusCode: number | null
  errorType: string | null
  responseMs: number
  finalUrl: string
  redirectChain: string[]
  linkType: string
  title: string | null
}

interface Snapshot {
  timestamp: string
  playbackUrl: string
  mimeType: string
  length: number
}

interface Archive {
  hasArchive: boolean
  latestSnapshot: Snapshot | null
  snapshotCount: number
  timeline: Snapshot[]
}

interface Alternative {
  url: string
  title: string
  snippet: string
  source: string
  relevanceScore: number
}

interface State {
  phase: Phase
  analysis: Analysis | null
  archive: Archive | null
  alternatives: Alternative[]
  aiText: string
  error: string | null
}

const INIT: State = {
  phase: 'idle',
  analysis: null,
  archive: null,
  alternatives: [],
  aiText: '',
  error: null,
}

const API = process.env.NEXT_PUBLIC_API_URL || ''

// ── Main App ───────────────────────────────────────────────────────────────

export function LinkReviveApp() {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<State>(INIT)
  const [tab, setTab] = useState<'overview' | 'archive' | 'alternatives' | 'ai'>('overview')
  const abortRef = useRef<AbortController | null>(null)

  const analyze = useCallback(async (targetUrl?: string) => {
    const u = targetUrl || url
    if (!u.trim()) return
    if (targetUrl) setUrl(targetUrl)

    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setState({ ...INIT, phase: 'checking' })
    setTab('overview')

    const fullUrl = u.startsWith('http') ? u : `https://${u}`

    try {
      const res = await fetch(
        `${API}/api/v1/links/analyze/stream?url=${encodeURIComponent(fullUrl)}`,
        { signal: abortRef.current.signal }
      )

      if (!res.ok) throw new Error(`API error ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No stream')

      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            handleEvent(ev)
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      setState(p => ({ ...p, phase: 'error', error: err.message || 'Failed to fetch' }))
    }
  }, [url])

  function handleEvent(ev: any) {
    switch (ev.type) {
      case 'analysis':
        setState(p => ({ ...p, phase: 'archive', analysis: ev.data }))
        break
      case 'archive':
        setState(p => ({ ...p, phase: 'alternatives', archive: ev.data }))
        break
      case 'alternatives':
        setState(p => ({ ...p, phase: 'ai', alternatives: ev.data }))
        break
      case 'ai':
        if (ev.data?.type !== 'done') {
          setState(p => ({ ...p, aiText: p.aiText + (ev.data?.content || '') }))
        }
        break
      case 'done':
        setState(p => ({ ...p, phase: 'done' }))
        break
      case 'error':
        setState(p => ({ ...p, phase: 'error', error: ev.message || 'Analysis failed' }))
        break
    }
  }

  const loading = !['idle', 'done', 'error'].includes(state.phase)
  const phaseLabel: Record<Phase, string> = {
    idle: '', checking: 'Checking URL...', archive: 'Fetching archive...',
    alternatives: 'Finding alternatives...', ai: 'AI analyzing...', done: '', error: '',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0f', color: '#e8e8e8', fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ── Nav ── */}
      <nav style={{ borderBottom: '1px solid #1e1e24', padding: '14px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: '#00e676', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>🔗</div>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>LinkRevive</span>
          <span style={{ fontSize: 11, color: '#555', border: '1px solid #222', borderRadius: 4, padding: '2px 6px', fontFamily: 'monospace' }}>v1.0</span>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <a href="/bulk" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>Link Checker</a>
          <a href="/bulk" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>Bulk Scanner</a>
          <a href="/extension" style={{ color: '#888', fontSize: 13, textDecoration: 'none' }}>Extension</a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '72px 32px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00e676', display: 'inline-block', animation: 'pulse 2s infinite' }} />
          <span style={{ fontSize: 12, color: '#00e676', fontFamily: 'monospace', letterSpacing: '0.05em' }}>Live — real-time analysis</span>
        </div>

        <h1 style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-1.5px', marginBottom: 16 }}>
          Dead links,{' '}
          <span style={{ background: 'linear-gradient(90deg, #00e676, #00b0ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            revived.
          </span>
        </h1>

        <p style={{ fontSize: 17, color: '#888', lineHeight: 1.7, marginBottom: 36, maxWidth: 560 }}>
          Paste any broken URL. We retrieve the last archive, find modern alternatives, and explain what changed.
        </p>

        {/* ── Input ── */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#444', fontSize: 13, fontFamily: 'monospace', pointerEvents: 'none' }}>url →</span>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && analyze()}
              placeholder="https://broken-link.example.com/page"
              disabled={loading}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#111', border: '1px solid #222', borderRadius: 10,
                padding: '14px 14px 14px 60px', fontSize: 14, color: '#e8e8e8',
                outline: 'none', fontFamily: 'monospace',
                transition: 'border-color 0.2s',
              }}
            />
          </div>
          <button
            onClick={() => analyze()}
            disabled={loading || !url.trim()}
            style={{
              padding: '14px 24px', background: loading ? '#1a3a2a' : '#00e676',
              color: loading ? '#00e676' : '#000', border: 'none', borderRadius: 10,
              fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap', transition: 'all 0.2s',
            }}
          >
            {loading ? phaseLabel[state.phase] || 'Analyzing...' : 'Revive →'}
          </button>
        </div>

        {/* ── Examples ── */}
        {state.phase === 'idle' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#444' }}>Try:</span>
            {[
              'code.google.com/p/google-guice',
              'bower.io/docs/api',
              'api.jquery.com/removed',
            ].map(ex => (
              <button key={ex} onClick={() => analyze(`https://${ex}`)}
                style={{ fontSize: 12, color: '#555', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                {ex}
              </button>
            ))}
          </div>
        )}

        {/* ── Progress ── */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['checking', 'archive', 'alternatives', 'ai'] as Phase[]).map((p, i) => {
                const phases = ['checking', 'archive', 'alternatives', 'ai']
                const current = phases.indexOf(state.phase)
                return (
                  <div key={p} style={{
                    width: 32, height: 3, borderRadius: 2,
                    background: i <= current ? '#00e676' : '#1e1e24',
                    transition: 'background 0.3s',
                  }} />
                )
              })}
            </div>
            <span style={{ fontSize: 12, color: '#555', fontFamily: 'monospace' }}>{phaseLabel[state.phase]}</span>
          </div>
        )}

        {/* ── Error ── */}
        {state.phase === 'error' && (
          <div style={{ marginTop: 16, padding: '12px 16px', background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: 8 }}>
            <span style={{ fontSize: 13, color: '#ff5555', fontFamily: 'monospace' }}>{state.error}</span>
          </div>
        )}
      </section>

      {/* ── Results ── */}
      {state.analysis && (
        <section style={{ maxWidth: 720, margin: '0 auto 48px', padding: '0 32px' }}>
          <div style={{ border: '1px solid #1e1e24', borderRadius: 12, overflow: 'hidden', background: '#0f0f12' }}>

            {/* Status bar */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #1e1e24', display: 'flex', alignItems: 'center', gap: 12, background: '#111' }}>
              <StatusBadge analysis={state.analysis} />
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#555', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {state.analysis.finalUrl || state.analysis.url}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#444' }}>{state.analysis.responseMs}ms</span>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid #1e1e24' }}>
              {([
                { id: 'overview', label: 'Overview' },
                { id: 'archive', label: `Archive${state.archive?.snapshotCount ? ` (${state.archive.snapshotCount})` : ''}` },
                { id: 'alternatives', label: `Alternatives (${state.alternatives.length})` },
                { id: 'ai', label: 'AI Analysis' },
              ] as const).map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{
                    padding: '12px 18px', fontSize: 13, fontFamily: 'monospace',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: tab === t.id ? '#00e676' : '#555',
                    borderBottom: tab === t.id ? '2px solid #00e676' : '2px solid transparent',
                    transition: 'all 0.2s',
                  }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ padding: 20 }}>
              {tab === 'overview' && <OverviewTab analysis={state.analysis} />}
              {tab === 'archive' && <ArchiveTab archive={state.archive} loading={loading} />}
              {tab === 'alternatives' && <AlternativesTab alternatives={state.alternatives} loading={loading} />}
              {tab === 'ai' && <AITab text={state.aiText} loading={loading} />}
            </div>
          </div>
        </section>
      )}

      {/* ── Features ── */}
      <section style={{ maxWidth: 720, margin: '0 auto 80px', padding: '0 32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
          {[
            { icon: '🔍', title: 'Link health detection', desc: 'HTTP status, DNS failures, timeouts, SSL errors, and redirect loops.' },
            { icon: '📦', title: 'Wayback Machine', desc: 'Fetch the latest archived snapshot and full timeline of crawls.' },
            { icon: '🔗', title: 'Smart alternatives', desc: 'Google + GitHub search ranked by semantic relevance score.' },
            { icon: '🤖', title: 'AI explanation', desc: 'Compares archived vs modern, rates staleness, recommends the best replacement.' },
          ].map(f => (
            <div key={f.title} style={{ padding: 20, border: '1px solid #1e1e24', borderRadius: 10, background: '#0f0f12' }}>
              <div style={{ fontSize: 22, marginBottom: 10 }}>{f.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        input:focus { border-color: #00e676 !important; }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        a { color: inherit; }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ analysis }: { analysis: Analysis }) {
  if (analysis.isAlive) {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'monospace', color: '#00e676', background: '#001a0d', padding: '4px 10px', borderRadius: 20 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00e676', display: 'inline-block' }} />
        {analysis.statusCode} LIVE
      </span>
    )
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontFamily: 'monospace', color: '#ff5555', background: '#1a0505', padding: '4px 10px', borderRadius: 20 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5555', display: 'inline-block' }} />
      {analysis.statusCode || analysis.errorType || 'DEAD'}
    </span>
  )
}

function OverviewTab({ analysis }: { analysis: Analysis }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <Cell label="Status" value={String(analysis.statusCode || analysis.errorType || '—')} />
        <Cell label="Type" value={analysis.linkType} />
        <Cell label="Response" value={`${analysis.responseMs}ms`} />
      </div>
      {analysis.title && <Cell label="Title" value={analysis.title} />}
      {analysis.finalUrl !== analysis.url && <Cell label="Final URL" value={analysis.finalUrl} mono />}
      {analysis.redirectChain.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace', marginBottom: 8 }}>Redirect chain</div>
          {[analysis.url, ...analysis.redirectChain].map((u, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {i > 0 && <span style={{ color: '#333', fontSize: 12 }}>↳</span>}
              <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#666' }}>{u}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ArchiveTab({ archive, loading }: { archive: Archive | null; loading: boolean }) {
  if (loading && !archive) return <Skeleton />
  if (!archive?.hasArchive) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: '#444', fontSize: 13, fontFamily: 'monospace' }}>
      No archived versions found in the Wayback Machine
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {archive.latestSnapshot && (
        <div style={{ border: '1px solid #1e1e24', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 11, color: '#444', fontFamily: 'monospace' }}>Latest snapshot</span>
            <span style={{ fontSize: 11, color: '#00e676', fontFamily: 'monospace' }}>{fmtTs(archive.latestSnapshot.timestamp)}</span>
          </div>
          <a href={archive.latestSnapshot.playbackUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontFamily: 'monospace', fontSize: 12, color: '#00b0ff', display: 'block', marginBottom: 8, wordBreak: 'break-all' }}>
            {archive.latestSnapshot.playbackUrl}
          </a>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{ fontSize: 11, color: '#444' }}>{archive.latestSnapshot.mimeType}</span>
            <span style={{ fontSize: 11, color: '#444' }}>{Math.round(archive.latestSnapshot.length / 1024)}KB</span>
            <span style={{ fontSize: 11, color: '#444' }}>{archive.snapshotCount} total snapshots</span>
          </div>
        </div>
      )}
      {archive.timeline.length > 1 && (
        <div>
          <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace', marginBottom: 10 }}>Timeline</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {archive.timeline.map((s, i) => (
              <a key={i} href={s.playbackUrl} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: 'monospace', fontSize: 11, color: '#666', border: '1px solid #1e1e24', borderRadius: 4, padding: '3px 8px', textDecoration: 'none' }}>
                {fmtTs(s.timestamp, true)}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlternativesTab({ alternatives, loading }: { alternatives: Alternative[]; loading: boolean }) {
  if (loading && alternatives.length === 0) return <Skeleton />
  if (alternatives.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: '#444', fontSize: 13, fontFamily: 'monospace' }}>
      No alternatives found
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {alternatives.map((alt, i) => (
        <div key={i} style={{ border: '1px solid #1e1e24', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
            <a href={alt.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 14, fontWeight: 600, color: '#e8e8e8', textDecoration: 'none' }}>
              {alt.title}
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ width: 60, height: 4, background: '#1e1e24', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${alt.relevanceScore * 100}%`, height: '100%', background: '#00e676', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, color: '#444', fontFamily: 'monospace' }}>{Math.round(alt.relevanceScore * 100)}%</span>
              <span style={{ fontSize: 11, color: '#444', border: '1px solid #1e1e24', borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace' }}>
                {alt.source === 'GOOGLE_SEARCH' ? 'Google' : alt.source === 'GITHUB_SEARCH' ? 'GitHub' : 'AI'}
              </span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: '#555', lineHeight: 1.6, marginBottom: 6 }}>{alt.snippet}</p>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#333' }}>{alt.url}</span>
        </div>
      ))}
    </div>
  )
}

function AITab({ text, loading }: { text: string; loading: boolean }) {
  if (!text && loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00e676', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
      <span style={{ fontSize: 13, color: '#444', fontFamily: 'monospace' }}>AI is analyzing...</span>
    </div>
  )
  if (!text) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: '#444', fontSize: 13, fontFamily: 'monospace' }}>
      No AI analysis available
    </div>
  )
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#aaa', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
      {text}
      {loading && <span style={{ display: 'inline-block', width: 2, height: 14, background: '#00e676', animation: 'pulse 1s infinite', marginLeft: 2, verticalAlign: 'middle' }} />}
    </div>
  )
}

function Cell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, color: '#444', fontFamily: 'monospace', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 12, color: '#aaa', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[80, 60, 90, 50].map((w, i) => (
        <div key={i} style={{ height: 12, background: '#1a1a1f', borderRadius: 4, width: `${w}%`, animation: 'pulse 1.5s infinite' }} />
      ))}
    </div>
  )
}

function fmtTs(ts: string, short = false): string {
  try {
    const y = ts.slice(0, 4), m = ts.slice(4, 6), d = ts.slice(6, 8)
    return short ? `${y}-${m}` : `${y}-${m}-${d}`
  } catch { return ts }
}

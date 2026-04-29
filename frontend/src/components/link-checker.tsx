'use client'

/**
 * LinkChecker — Primary UI component
 *
 * Uses SSE (Server-Sent Events) for streaming results:
 * analysis → archive → alternatives → AI explanation
 *
 * State machine: idle → loading → streaming → done | error
 */

import { useState, useRef, useCallback } from 'react'
import { AnalysisResult } from './analysis-result'
import type {
  LinkAnalysis,
  ArchiveResult,
  AlternativeResult,
  AIChunk,
} from '@/types/api'

type StreamPhase = 'idle' | 'checking' | 'archive' | 'alternatives' | 'ai' | 'done' | 'error'

interface StreamState {
  phase: StreamPhase
  analysis: LinkAnalysis | null
  archive: ArchiveResult | null
  alternatives: AlternativeResult[]
  aiText: string
  aiPhase: string
  error: string | null
}

const INITIAL_STATE: StreamState = {
  phase: 'idle',
  analysis: null,
  archive: null,
  alternatives: [],
  aiText: '',
  aiPhase: '',
  error: null,
}

const PHASE_LABELS: Record<StreamPhase, string> = {
  idle: '',
  checking: 'Checking URL status...',
  archive: 'Fetching archived versions...',
  alternatives: 'Finding modern alternatives...',
  ai: 'AI is analyzing the changes...',
  done: 'Analysis complete',
  error: 'Analysis failed',
}

export function LinkChecker() {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<StreamState>(INITIAL_STATE)
  const abortRef = useRef<AbortController | null>(null)

  const handleAnalyze = useCallback(async () => {
    if (!url.trim()) return

    // Abort any in-flight request
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setState({ ...INITIAL_STATE, phase: 'checking' })

    const apiUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/v1/links/analyze/stream?url=${encodeURIComponent(url)}`

    try {
      const response = await fetch(apiUrl, {
        signal: abortRef.current.signal,
      })

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (!reader) throw new Error('No response body')

      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = JSON.parse(line.slice(6))
          processSSEEvent(data)
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: (err as Error).message || 'Analysis failed',
      }))
    }
  }, [url])

  function processSSEEvent(data: {
    type: string
    data?: unknown
    message?: string
  }) {
    switch (data.type) {
      case 'analysis':
        setState(prev => ({
          ...prev,
          phase: 'archive',
          analysis: data.data as LinkAnalysis,
        }))
        break

      case 'archive':
        setState(prev => ({
          ...prev,
          phase: 'alternatives',
          archive: data.data as ArchiveResult,
        }))
        break

      case 'alternatives':
        setState(prev => ({
          ...prev,
          phase: 'ai',
          alternatives: data.data as AlternativeResult[],
        }))
        break

      case 'ai': {
        const chunk = data.data as AIChunk
        setState(prev => ({
          ...prev,
          aiPhase: chunk.type,
          aiText: chunk.type === 'done' ? prev.aiText : prev.aiText + chunk.content,
        }))
        break
      }

      case 'done':
        setState(prev => ({ ...prev, phase: 'done' }))
        break

      case 'error':
        setState(prev => ({
          ...prev,
          phase: 'error',
          error: data.message || 'Unknown error',
        }))
        break
    }
  }

  const isLoading = !['idle', 'done', 'error'].includes(state.phase)

  return (
    <div className="space-y-6">
      {/* URL Input */}
      <div className="relative flex gap-3">
        <div className="flex-1 relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 font-mono text-sm">
            https://
          </div>
          <input
            type="text"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            placeholder="broken-url.com/some/dead/page"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 pl-[4.5rem]
                       font-mono text-sm text-white placeholder-white/20
                       focus:outline-none focus:border-[#00ff88]/50 focus:bg-white/8
                       transition-all"
            disabled={isLoading}
          />
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isLoading || !url.trim()}
          className="px-6 py-4 bg-[#00ff88] text-black font-mono text-sm font-semibold
                     rounded-xl hover:bg-[#00ff88]/90 disabled:opacity-40
                     disabled:cursor-not-allowed transition-all shrink-0"
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full border border-black/30 border-t-black animate-spin" />
              Analyzing
            </span>
          ) : (
            'Revive Link →'
          )}
        </button>
      </div>

      {/* Progress indicator */}
      {isLoading && (
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {(['checking', 'archive', 'alternatives', 'ai'] as StreamPhase[]).map(phase => (
              <div
                key={phase}
                className={`h-0.5 w-8 rounded-full transition-all duration-500 ${
                  getPhaseIndex(state.phase) >= getPhaseIndex(phase)
                    ? 'bg-[#00ff88]'
                    : 'bg-white/10'
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-xs text-white/40">
            {PHASE_LABELS[state.phase]}
          </span>
        </div>
      )}

      {/* Error state */}
      {state.phase === 'error' && (
        <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-4">
          <p className="font-mono text-sm text-red-400">{state.error}</p>
        </div>
      )}

      {/* Results */}
      {state.analysis && (
        <AnalysisResult
          analysis={state.analysis}
          archive={state.archive}
          alternatives={state.alternatives}
          aiText={state.aiText}
          isStreaming={isLoading}
        />
      )}

      {/* Example URLs */}
      {state.phase === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <span className="font-mono text-xs text-white/20">Try dead links:</span>
          {[
            'https://dl.dropbox.com/u/12345/example.pdf',
            'https://code.google.com/p/android/issues/detail?id=1',
            'https://support.google.com/plus/answer/1046901',
          ].map(exampleUrl => (
            <button
              key={exampleUrl}
              onClick={() => setUrl(exampleUrl)}
              className="font-mono text-xs text-white/30 hover:text-white/60 underline underline-offset-2 transition-colors"
            >
              {exampleUrl.replace('https://', '')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getPhaseIndex(phase: StreamPhase): number {
  return ['idle', 'checking', 'archive', 'alternatives', 'ai', 'done'].indexOf(phase)
}

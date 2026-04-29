'use client'

import { useState } from 'react'
import type { LinkAnalysis, ArchiveResult, AlternativeResult } from '@/types/api'

interface Props {
  analysis: LinkAnalysis
  archive: ArchiveResult | null
  alternatives: AlternativeResult[]
  aiText: string
  isStreaming: boolean
}

export function AnalysisResult({ analysis, archive, alternatives, aiText, isStreaming }: Props) {
  const [activeTab, setActiveTab] = useState<'overview' | 'archive' | 'alternatives' | 'ai'>('overview')

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-white/2">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-white/10 bg-white/3">
        <StatusBadge analysis={analysis} />
        <div className="flex-1 font-mono text-xs text-white/40 truncate">
          {analysis.url}
        </div>
        <div className="font-mono text-xs text-white/30">
          {analysis.responseMs}ms
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        {(
          [
            { id: 'overview', label: 'Overview' },
            { id: 'archive', label: `Archive${archive?.snapshotCount ? ` (${archive.snapshotCount})` : ''}` },
            { id: 'alternatives', label: `Alternatives (${alternatives.length})` },
            { id: 'ai', label: 'AI Analysis' },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 font-mono text-xs transition-colors ${
              activeTab === tab.id
                ? 'text-[#00ff88] border-b border-[#00ff88]'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">
        {activeTab === 'overview' && <OverviewTab analysis={analysis} />}
        {activeTab === 'archive' && <ArchiveTab archive={archive} isStreaming={isStreaming} />}
        {activeTab === 'alternatives' && (
          <AlternativesTab alternatives={alternatives} isStreaming={isStreaming} />
        )}
        {activeTab === 'ai' && <AITab text={aiText} isStreaming={isStreaming} />}
      </div>
    </div>
  )
}

function StatusBadge({ analysis }: { analysis: LinkAnalysis }) {
  if (analysis.isAlive) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-[#00ff88] bg-[#00ff88]/10 px-2.5 py-1 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-[#00ff88]" />
        {analysis.statusCode} LIVE
      </span>
    )
  }

  const color = analysis.statusCode === 404 ? 'text-red-400 bg-red-400/10' : 'text-orange-400 bg-orange-400/10'
  const dot = analysis.statusCode === 404 ? 'bg-red-400' : 'bg-orange-400'

  return (
    <span className={`flex items-center gap-1.5 font-mono text-xs ${color} px-2.5 py-1 rounded-full`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {analysis.statusCode || analysis.errorType || 'DEAD'}
    </span>
  )
}

function OverviewTab({ analysis }: { analysis: LinkAnalysis }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <InfoCell label="Status" value={analysis.statusCode?.toString() || analysis.errorType || '—'} />
        <InfoCell label="Type" value={analysis.linkType} />
        <InfoCell label="Response" value={`${analysis.responseMs}ms`} />
        {analysis.title && <InfoCell label="Title" value={analysis.title} className="col-span-2 sm:col-span-3" />}
        {analysis.finalUrl !== analysis.url && (
          <InfoCell label="Final URL" value={analysis.finalUrl} className="col-span-2 sm:col-span-3" />
        )}
      </div>

      {analysis.redirectChain.length > 0 && (
        <div>
          <p className="font-mono text-xs text-white/30 mb-2">Redirect chain</p>
          <div className="space-y-1">
            {[analysis.url, ...analysis.redirectChain].map((u, i) => (
              <div key={i} className="flex items-center gap-2">
                {i > 0 && <span className="font-mono text-xs text-white/20">↳</span>}
                <span className="font-mono text-xs text-white/50 truncate">{u}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ArchiveTab({ archive, isStreaming }: { archive: ArchiveResult | null; isStreaming: boolean }) {
  if (isStreaming && !archive) {
    return <Skeleton lines={4} />
  }

  if (!archive?.hasArchive) {
    return (
      <div className="text-center py-8">
        <p className="font-mono text-sm text-white/30">No archived versions found</p>
        <p className="font-mono text-xs text-white/20 mt-1">
          The Wayback Machine has not crawled this URL
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {archive.latestSnapshot && (
        <div className="border border-white/10 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-white/40">Latest snapshot</span>
            <span className="font-mono text-xs text-[#00ff88]">
              {formatTimestamp(archive.latestSnapshot.timestamp)}
            </span>
          </div>
          <a
            href={archive.latestSnapshot.playbackUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block font-mono text-xs text-[#00ccff] hover:text-white truncate transition-colors"
          >
            {archive.latestSnapshot.playbackUrl}
          </a>
          <div className="flex gap-4">
            <span className="font-mono text-xs text-white/30">
              {archive.latestSnapshot.mimeType}
            </span>
            <span className="font-mono text-xs text-white/30">
              {Math.round(archive.latestSnapshot.length / 1024)}KB
            </span>
            <span className="font-mono text-xs text-white/30">
              {archive.snapshotCount} total snapshots
            </span>
          </div>
        </div>
      )}

      {/* Timeline */}
      {archive.timeline.length > 1 && (
        <div>
          <p className="font-mono text-xs text-white/30 mb-3">Snapshot timeline</p>
          <div className="flex gap-1.5 flex-wrap">
            {archive.timeline.map((snap, i) => (
              <a
                key={i}
                href={snap.playbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs bg-white/5 border border-white/10 px-2 py-1 rounded
                           hover:border-[#00ccff]/40 hover:text-[#00ccff] transition-colors"
              >
                {formatTimestamp(snap.timestamp, 'short')}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function AlternativesTab({ alternatives, isStreaming }: { alternatives: AlternativeResult[]; isStreaming: boolean }) {
  if (isStreaming && alternatives.length === 0) {
    return <Skeleton lines={6} />
  }

  if (alternatives.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="font-mono text-sm text-white/30">No alternatives found</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {alternatives.map((alt, i) => (
        <div
          key={i}
          className="border border-white/10 rounded-lg p-4 hover:border-white/20 transition-colors"
        >
          <div className="flex items-start justify-between gap-4 mb-2">
            <a
              href={alt.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-sm text-white hover:text-[#00ccff] transition-colors"
            >
              {alt.title}
            </a>
            <div className="flex items-center gap-2 shrink-0">
              <RelevanceBar score={alt.relevanceScore} />
              <SourceBadge source={alt.source} />
            </div>
          </div>
          <p className="text-xs text-white/40 leading-relaxed mb-2">{alt.snippet}</p>
          <span className="font-mono text-xs text-white/20 truncate block">{alt.url}</span>
        </div>
      ))}
    </div>
  )
}

function AITab({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  if (!text && isStreaming) {
    return (
      <div className="flex items-center gap-2 py-4">
        <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
        <span className="font-mono text-xs text-white/40">AI is analyzing...</span>
      </div>
    )
  }

  if (!text) {
    return (
      <div className="text-center py-8">
        <p className="font-mono text-sm text-white/30">No AI analysis available</p>
      </div>
    )
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <div className="font-mono text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
        {text}
        {isStreaming && <span className="inline-block w-0.5 h-4 bg-[#00ff88] animate-pulse ml-0.5 align-middle" />}
      </div>
    </div>
  )
}

function InfoCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`bg-white/3 rounded-lg p-3 ${className}`}>
      <p className="font-mono text-xs text-white/30 mb-1">{label}</p>
      <p className="font-mono text-xs text-white/80 truncate">{value}</p>
    </div>
  )
}

function RelevanceBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-16 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#00ff88] rounded-full"
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className="font-mono text-xs text-white/30">{Math.round(score * 100)}%</span>
    </div>
  )
}

function SourceBadge({ source }: { source: string }) {
  const map: Record<string, string> = {
    GOOGLE_SEARCH: 'Google',
    GITHUB_SEARCH: 'GitHub',
    AI_GENERATED: 'AI',
  }
  return (
    <span className="font-mono text-xs text-white/30 border border-white/10 px-1.5 py-0.5 rounded">
      {map[source] || source}
    </span>
  )
}

function Skeleton({ lines }: { lines: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 bg-white/5 rounded animate-pulse"
          style={{ width: `${60 + Math.random() * 40}%` }}
        />
      ))}
    </div>
  )
}

function formatTimestamp(ts: string, format: 'full' | 'short' = 'full'): string {
  try {
    const year = ts.slice(0, 4)
    const month = ts.slice(4, 6)
    const day = ts.slice(6, 8)
    if (format === 'short') return `${year}-${month}`
    return `${year}-${month}-${day}`
  } catch {
    return ts
  }
}

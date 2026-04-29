/**
 * LinkRevive Homepage
 * Aesthetic direction: Industrial precision — monospace accents, tight grid,
 * high-contrast status indicators, technical but accessible.
 */

import type { Metadata } from 'next'
import { LinkChecker } from '@/components/link-checker'
import { FeatureGrid } from '@/components/feature-grid'
import { StatsBar } from '@/components/stats-bar'

export const metadata: Metadata = {
  title: 'LinkRevive — Dead Link Internet Fixer',
  description: 'Detect broken URLs, retrieve archived versions, and find modern alternatives instantly.',
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      {/* Top nav */}
      <nav className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-[#00ff88] flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1L11 5H8V9H6V5H3L7 1Z" fill="#0a0a0b"/>
              <path d="M2 8V12H12V8" stroke="#0a0a0b" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="font-mono text-sm font-semibold tracking-tight">LinkRevive</span>
          <span className="font-mono text-xs text-white/30 border border-white/10 px-1.5 py-0.5 rounded">
            v1.0
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a href="/bulk" className="text-sm text-white/60 hover:text-white transition-colors">
            Bulk Scanner
          </a>
          <a href="/extension" className="text-sm text-white/60 hover:text-white transition-colors">
            Extension
          </a>
          <a
            href="/api/v1/docs"
            className="text-sm font-mono bg-white/5 border border-white/10 px-3 py-1.5 rounded hover:bg-white/10 transition-colors"
          >
            API Docs
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-20 pb-12">
        <div className="flex items-center gap-2 mb-6">
          <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
          <span className="font-mono text-xs text-[#00ff88]">LIVE — checking links in real time</span>
        </div>

        <h1 className="text-[3.5rem] font-bold leading-[1.05] tracking-tight mb-6">
          Dead links,{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00ff88] to-[#00ccff]">
            revived.
          </span>
        </h1>

        <p className="text-xl text-white/60 max-w-2xl mb-12 leading-relaxed">
          Paste any broken URL. We fetch the last archived snapshot,
          find modern alternatives, and explain what changed — powered by AI.
        </p>

        <LinkChecker />
      </section>

      <StatsBar />

      <FeatureGrid />
    </main>
  )
}

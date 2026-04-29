'use client'

import { useState } from 'react'

export default function BulkScannerPage() {
  const [pageUrl, setPageUrl] = useState('')
  const [status, setStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [scanId, setScanId] = useState('')

  async function startScan() {
    if (!pageUrl.trim()) return
    setStatus('scanning')
    setError('')
    setResult(null)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setScanId(data.scanId)
      pollScan(data.scanId)
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }

  async function pollScan(id: string) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/scan/${id}`)
        const data = await res.json()
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          clearInterval(interval)
          setResult(data)
          setStatus(data.status === 'COMPLETED' ? 'done' : 'error')
        }
      } catch {
        clearInterval(interval)
        setStatus('error')
        setError('Failed to poll scan status')
      }
    }, 3000)
  }

  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <a href="/" className="font-mono text-sm text-white/60 hover:text-white transition-colors">← Back</a>
        <span className="font-mono text-sm font-semibold">Bulk Scanner</span>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 pb-12">
        <h1 className="text-4xl font-bold mb-3">Bulk Link Scanner</h1>
        <p className="text-white/50 mb-10">Enter a webpage URL to scan all its links for broken ones.</p>

        <div className="flex gap-3 mb-8">
          <input
            type="text"
            value={pageUrl}
            onChange={e => setPageUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && startScan()}
            placeholder="https://yoursite.com/docs"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-4
                       font-mono text-sm text-white placeholder-white/20
                       focus:outline-none focus:border-[#00ff88]/50 transition-all"
            disabled={status === 'scanning'}
          />
          <button
            onClick={startScan}
            disabled={status === 'scanning' || !pageUrl.trim()}
            className="px-6 py-4 bg-[#00ff88] text-black font-mono text-sm font-semibold
                       rounded-xl hover:bg-[#00ff88]/90 disabled:opacity-40 transition-all"
          >
            {status === 'scanning' ? 'Scanning...' : 'Scan Page →'}
          </button>
        </div>

        {status === 'scanning' && (
          <div className="border border-white/10 rounded-xl p-6 text-center">
            <div className="w-6 h-6 border-2 border-[#00ff88] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="font-mono text-sm text-white/50">Scanning links on the page...</p>
            <p className="font-mono text-xs text-white/30 mt-1">This may take 30-60 seconds</p>
          </div>
        )}

        {error && (
          <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-4">
            <p className="font-mono text-sm text-red-400">{error}</p>
          </div>
        )}

        {result && status === 'done' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Total Links" value={result.totalLinks} />
              <StatCard label="Broken Links" value={result.brokenLinks} color="text-red-400" />
              <StatCard label="Checked" value={result.checkedLinks} />
            </div>

            {result.items?.length > 0 && (
              <div className="border border-white/10 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10 bg-white/3">
                  <p className="font-mono text-xs text-white/50">Broken Links Found</p>
                </div>
                <div className="divide-y divide-white/5">
                  {result.items.map((item: any, i: number) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between gap-4">
                      <span className="font-mono text-xs text-white/60 truncate">{item.link?.url}</span>
                      <span className="font-mono text-xs text-red-400 shrink-0">
                        {item.statusCode || 'DEAD'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value, color = 'text-[#00ff88]' }: { label: string; value: number; color?: string }) {
  return (
    <div className="border border-white/10 rounded-xl p-4 text-center">
      <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
      <div className="font-mono text-xs text-white/40 mt-1">{label}</div>
    </div>
  )
}

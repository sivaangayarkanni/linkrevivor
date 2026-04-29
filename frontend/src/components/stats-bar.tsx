export function StatsBar() {
  const stats = [
    { label: 'Links Checked', value: '1M+' },
    { label: 'Archives Found', value: '840K+' },
    { label: 'Alternatives Found', value: '620K+' },
    { label: 'Avg Response Time', value: '<2s' },
  ]

  return (
    <section className="border-y border-white/10 bg-white/[0.02]">
      <div className="max-w-4xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <div className="font-mono text-2xl font-bold text-[#00ff88]">{s.value}</div>
            <div className="text-xs text-white/40 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

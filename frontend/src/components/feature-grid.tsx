export function FeatureGrid() {
  const features = [
    {
      icon: '🔍',
      title: 'Dead Link Detection',
      description: 'Instantly checks if a URL is alive, dead, or redirected with full HTTP analysis.',
    },
    {
      icon: '📦',
      title: 'Archive Retrieval',
      description: 'Fetches the last known good snapshot from the Wayback Machine automatically.',
    },
    {
      icon: '🔄',
      title: 'Smart Alternatives',
      description: 'Finds modern replacements using Google Search and GitHub with relevance scoring.',
    },
    {
      icon: '🤖',
      title: 'AI Explanations',
      description: 'Explains what changed, why the link died, and which alternative to use.',
    },
    {
      icon: '⚡',
      title: 'Bulk Scanner',
      description: 'Scan entire pages for broken links in one click — up to 100 links at once.',
    },
    {
      icon: '🧩',
      title: 'Chrome Extension',
      description: 'Automatically detects dead links as you browse and shows fixes inline.',
    },
  ]

  return (
    <section className="max-w-4xl mx-auto px-6 py-16">
      <h2 className="text-2xl font-bold mb-2">Everything you need</h2>
      <p className="text-white/50 mb-10">A complete toolkit for fixing broken links on the web.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="border border-white/10 rounded-xl p-5 bg-white/[0.02] hover:bg-white/[0.05] transition-colors"
          >
            <div className="text-2xl mb-3">{f.icon}</div>
            <h3 className="font-semibold mb-1">{f.title}</h3>
            <p className="text-sm text-white/50 leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

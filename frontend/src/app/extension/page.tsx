export default function ExtensionPage() {
  return (
    <main className="min-h-screen bg-[#0a0a0b] text-white">
      <nav className="border-b border-white/10 px-6 py-4 flex items-center gap-4">
        <a href="/" className="font-mono text-sm text-white/60 hover:text-white transition-colors">← Back</a>
        <span className="font-mono text-sm font-semibold">Chrome Extension</span>
      </nav>

      <div className="max-w-3xl mx-auto px-6 pt-16 pb-12">
        <h1 className="text-4xl font-bold mb-3">Chrome Extension</h1>
        <p className="text-white/50 mb-10 text-lg">
          Automatically detects dead links as you browse and shows fixes inline — no copy-pasting needed.
        </p>

        <div className="grid gap-6 mb-12">
          {[
            { step: '01', title: 'Download the extension', desc: 'Clone the repo and find the extension/ folder.' },
            { step: '02', title: 'Open Chrome Extensions', desc: 'Go to chrome://extensions in your browser.' },
            { step: '03', title: 'Enable Developer Mode', desc: 'Toggle "Developer mode" in the top right corner.' },
            { step: '04', title: 'Load Unpacked', desc: 'Click "Load unpacked" and select the extension/ folder.' },
          ].map(item => (
            <div key={item.step} className="flex gap-5 border border-white/10 rounded-xl p-5">
              <span className="font-mono text-2xl font-bold text-[#00ff88]/30">{item.step}</span>
              <div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-white/50">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="border border-[#00ff88]/20 bg-[#00ff88]/5 rounded-xl p-6">
          <h3 className="font-semibold text-[#00ff88] mb-2">How it works</h3>
          <p className="text-sm text-white/60 leading-relaxed">
            The extension monitors navigation events. When you land on a dead page (404, 410, connection error),
            it automatically queries the LinkRevive API and shows an overlay with archived versions and modern alternatives.
          </p>
        </div>
      </div>
    </main>
  )
}

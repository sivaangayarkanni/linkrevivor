import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'LinkRevive — Dead Link Internet Fixer',
  description: 'Detect broken URLs, retrieve archived versions, and find modern alternatives instantly.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

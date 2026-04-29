import type { Metadata } from 'next'
import { LinkReviveApp } from '@/components/link-revive-app'

export const metadata: Metadata = {
  title: 'LinkRevive — Dead Link Internet Fixer',
  description: 'Detect broken URLs, retrieve archived versions, and find modern alternatives instantly.',
}

export default function HomePage() {
  return <LinkReviveApp />
}

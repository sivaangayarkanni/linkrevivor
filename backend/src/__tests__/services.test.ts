/**
 * Unit tests for core services
 * Run: npm test
 *
 * External APIs are mocked — tests run without network access.
 * Focus on business logic: URL classification, keyword extraction, scoring.
 */

import { LinkAnalyzer } from '../src/services/link-analyzer'
import { AlternativeFinder } from '../src/services/alternative-finder'
import { ArchiveFetcher } from '../src/services/archive-fetcher'

// ─── Link Analyzer Tests ──────────────────────────────────────────────────────

describe('LinkAnalyzer', () => {
  let analyzer: LinkAnalyzer

  beforeEach(() => {
    analyzer = new LinkAnalyzer()
  })

  describe('classifyLinkType', () => {
    const cases: Array<[string, string]> = [
      ['https://github.com/facebook/react', 'GITHUB_REPO'],
      ['https://docs.python.org/3/library/os.html', 'DOCUMENTATION'],
      ['https://react.dev/docs/getting-started', 'DOCUMENTATION'],
      ['https://example.com/report.pdf', 'PDF'],
      ['https://www.npmjs.com/package/lodash', 'PACKAGE'],
      ['https://www.youtube.com/watch?v=abc123', 'VIDEO'],
      ['https://stackoverflow.com/questions/123', 'FORUM'],
      ['https://medium.com/@user/blog-post', 'BLOG_POST'],
      ['https://techcrunch.com/2024/01/article', 'NEWS'],
      ['https://random-site.com/page', 'UNKNOWN'],
    ]

    test.each(cases)('classifies %s as %s', (url, expected) => {
      expect(analyzer.classifyLinkType(url)).toBe(expected)
    })
  })

  describe('analyze', () => {
    it('returns DNS_FAILURE for invalid URL', async () => {
      const result = await analyzer.analyze('not-a-url')
      expect(result.isAlive).toBe(false)
      expect(result.errorType).toBe('DNS_FAILURE')
    })

    it('blocks non-HTTP protocols', async () => {
      const result = await analyzer.analyze('ftp://example.com/file')
      expect(result.isAlive).toBe(false)
      expect(result.errorType).toBe('DNS_FAILURE')
    })

    it('blocks private IP ranges (SSRF)', async () => {
      // This depends on DNS resolution of localhost — mock in integration tests
      // Unit: just verify the URL parse step
      const result = await analyzer.analyze('http://[::1]/admin')
      expect(result.isAlive).toBe(false)
    })
  })
})

// ─── Alternative Finder Tests ─────────────────────────────────────────────────

describe('AlternativeFinder', () => {
  let finder: AlternativeFinder

  beforeEach(() => {
    finder = new AlternativeFinder()
  })

  describe('extractKeywords', () => {
    it('extracts words from URL path', () => {
      const keywords = finder.extractKeywords(
        'https://old-site.com/docs/2019/how-to-setup-webpack',
        null
      )
      expect(keywords).toContain('how')
      expect(keywords).toContain('setup')
      expect(keywords).toContain('webpack')
      // Should not contain year
      expect(keywords).not.toContain('2019')
    })

    it('prioritizes title words over URL words', () => {
      const keywords = finder.extractKeywords(
        'https://example.com/post/123',
        'Complete Guide to React Server Components'
      )
      expect(keywords[0]).toBe('Complete')
      expect(keywords).toContain('React')
      expect(keywords).toContain('Components')
    })

    it('filters common stop words', () => {
      const keywords = finder.extractKeywords(
        'https://example.com/a/the/and/getting-started',
        null
      )
      expect(keywords).not.toContain('the')
      expect(keywords).not.toContain('and')
      expect(keywords).toContain('getting')
      expect(keywords).toContain('started')
    })

    it('caps output at 10 keywords', () => {
      const keywords = finder.extractKeywords(
        'https://example.com/one/two/three/four/five/six/seven/eight/nine/ten/eleven',
        'title with many extra words that would exceed the limit if not capped'
      )
      expect(keywords.length).toBeLessThanOrEqual(10)
    })
  })

  describe('find (mocked)', () => {
    // Mock the external API calls
    beforeEach(() => {
      jest.spyOn(finder as any, 'searchGoogle').mockResolvedValue([
        {
          url: 'https://new-docs.example.com/guide',
          title: 'Getting Started Guide',
          snippet: 'A comprehensive guide to getting started',
          source: 'GOOGLE_SEARCH',
          relevanceScore: 0,
        },
      ])
      jest.spyOn(finder as any, 'searchGitHub').mockResolvedValue([])
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('returns scored and sorted results', async () => {
      const results = await finder.find(
        'https://old-site.com/docs/getting-started',
        'Getting Started Guide',
        'DOCUMENTATION'
      )
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].relevanceScore).toBeGreaterThan(0)
    })

    it('deduplicates same-domain results', async () => {
      jest.spyOn(finder as any, 'searchGoogle').mockResolvedValue([
        { url: 'https://docs.example.com/page1', title: 'Page 1', snippet: 'p1', source: 'GOOGLE_SEARCH', relevanceScore: 0 },
        { url: 'https://docs.example.com/page2', title: 'Page 2', snippet: 'p2', source: 'GOOGLE_SEARCH', relevanceScore: 0 },
        { url: 'https://docs.example.com/page3', title: 'Page 3', snippet: 'p3', source: 'GOOGLE_SEARCH', relevanceScore: 0 },
        { url: 'https://other.com/page', title: 'Other', snippet: 'other', source: 'GOOGLE_SEARCH', relevanceScore: 0 },
      ])

      const results = await finder.find(
        'https://dead.example.com/page',
        null,
        'DOCUMENTATION'
      )

      // docs.example.com should appear max 2 times
      const domainCount = results.filter(r => r.url.includes('docs.example.com')).length
      expect(domainCount).toBeLessThanOrEqual(2)
    })
  })
})

// ─── Archive Fetcher Tests ────────────────────────────────────────────────────

describe('ArchiveFetcher', () => {
  describe('parseTimestamp', () => {
    it('parses Wayback timestamp correctly', () => {
      const date = ArchiveFetcher.parseTimestamp('20190315143022')
      expect(date.getFullYear()).toBe(2019)
      expect(date.getMonth()).toBe(2) // 0-indexed
      expect(date.getDate()).toBe(15)
    })
  })
})

// ─── Integration tests (require running services) ─────────────────────────────
// Run with: npm run test:integration

describe.skip('Integration: Link Analyzer', () => {
  it('detects a known dead URL', async () => {
    const analyzer = new LinkAnalyzer()
    // This URL is permanently dead — use a reliably dead one
    const result = await analyzer.analyze('https://code.google.com/p/google-guice')
    expect(result.isAlive).toBe(false)
    expect([404, 301]).toContain(result.statusCode)
  })

  it('detects a known live URL', async () => {
    const analyzer = new LinkAnalyzer()
    const result = await analyzer.analyze('https://example.com')
    expect(result.isAlive).toBe(true)
    expect(result.statusCode).toBe(200)
  })
})

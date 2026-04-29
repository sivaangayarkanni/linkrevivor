import { NextResponse } from 'next/server'

export async function GET() {
  const docs = {
    name: 'LinkRevive API',
    version: '1.0.0',
    baseUrl: process.env.NEXT_PUBLIC_API_URL,
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/links/analyze',
        description: 'Analyze a URL (async or instant)',
        body: { url: 'string', instant: 'boolean (optional)' },
        response: { jobId: 'string', pollUrl: 'string' },
      },
      {
        method: 'GET',
        path: '/api/v1/links/analyze/stream?url=',
        description: 'Stream analysis via SSE',
        response: 'text/event-stream',
      },
      {
        method: 'GET',
        path: '/api/v1/links/jobs/:jobId',
        description: 'Poll job status',
        response: { state: 'string', progress: 'number', data: 'object' },
      },
      {
        method: 'POST',
        path: '/api/v1/scan',
        description: 'Start a bulk page scan',
        body: { pageUrl: 'string' },
        response: { scanId: 'string', pollUrl: 'string' },
      },
      {
        method: 'GET',
        path: '/api/v1/scan/:id',
        description: 'Get bulk scan results',
        response: { status: 'string', totalLinks: 'number', brokenLinks: 'number', items: 'array' },
      },
      {
        method: 'GET',
        path: '/health',
        description: 'Health check',
        response: { status: 'string', db: 'string', redis: 'string', ai: 'object' },
      },
    ],
    rateLimits: {
      anonymous: '100 req/min',
      authenticated: '1000 req/min (X-API-Key header)',
    },
  }

  return NextResponse.json(docs, {
    headers: { 'Content-Type': 'application/json' },
  })
}

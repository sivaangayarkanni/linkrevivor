# LinkRevive — Dead Link Internet Fixer

> Detect broken URLs · Retrieve archives · Find modern alternatives · Powered by AI

---

## Quick Start (Docker — recommended)

```bash
# 1. Clone and enter the project
git clone https://github.com/yourname/linkrevive && cd linkrevive

# 2. Copy environment file and fill in your API keys
cp .env.example .env

# 3. Start all services (Postgres, Redis, API, Worker, Frontend)
docker compose up -d

# 4. Run database migrations
docker compose exec api npx prisma migrate deploy

# Open http://localhost:3000
```

---

## Environment Variables (.env)

```env
# Required
DATABASE_URL=postgresql://linkrevive:yourpassword@localhost:5432/linkrevive
REDIS_URL=redis://localhost:6379
API_SECRET_KEY=change-this-to-a-random-32-char-string-minimum
ANTHROPIC_API_KEY=sk-ant-...

# Optional (improves alternative search quality)
GOOGLE_CUSTOM_SEARCH_API_KEY=AIza...
GOOGLE_CUSTOM_SEARCH_CX=your-cx-id
GITHUB_TOKEN=ghp_...

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:3001
ALLOWED_ORIGINS=http://localhost:3000

# Feature flags
ENABLE_AI_EXPLANATIONS=true
MAX_BULK_LINKS=100
```

---

## Manual Setup (Local Dev)

### Prerequisites
- Node.js 20+
- PostgreSQL 16
- Redis 7

### Backend

```bash
cd backend
npm install
cp .env.example .env  # Fill in values
npx prisma migrate dev --name init
npm run dev           # API on :3001
npm run dev:worker    # Workers (separate terminal)
```

### Frontend

```bash
cd frontend
npm install
npm run dev           # Next.js on :3000
```

---

## Deployment

### Vercel + Railway (Recommended for Production)

**Frontend → Vercel**
1. Push `frontend/` to GitHub
2. Import to Vercel → Framework: Next.js
3. Set `NEXT_PUBLIC_API_URL` to your Railway API URL
4. Deploy

**Backend + Workers → Railway**
1. Create new Railway project
2. Add services: PostgreSQL plugin, Redis plugin
3. Deploy backend from `backend/` with `npm run build && node dist/server.js`
4. Deploy workers from `backend/` with `node dist/workers/index.js` (separate service)
5. Set all environment variables from Railway's PostgreSQL/Redis connection strings

**Railway one-click config (`railway.toml`):**
```toml
[build]
builder = "nixpacks"
buildCommand = "npm ci && npm run build && npx prisma generate"

[deploy]
startCommand = "npx prisma migrate deploy && node dist/server.js"
healthcheckPath = "/health"
healthcheckTimeout = 30
```

### Self-hosted Docker (VPS/EC2)

```bash
# On your server
git clone https://github.com/yourname/linkrevive
cd linkrevive
cp .env.example .env  # Edit with production values
docker compose -f docker-compose.yml up -d

# Set up nginx reverse proxy
# Frontend: proxy_pass http://localhost:3000
# API:      proxy_pass http://localhost:3001
```

---

## Chrome Extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `extension/` folder
4. Visit any dead URL — the overlay appears automatically

For production, submit to Chrome Web Store via [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole).

---

## API Reference

### Analyze a URL (async)
```http
POST /api/v1/links/analyze
Content-Type: application/json

{ "url": "https://dead-link.example.com/page" }
```
Response: `{ "jobId": "...", "pollUrl": "/api/v1/links/jobs/{id}" }`

### Analyze a URL (instant, for extension)
```http
POST /api/v1/links/analyze
Content-Type: application/json

{ "url": "https://dead-link.example.com/page", "instant": true }
```

### Stream analysis (SSE)
```http
GET /api/v1/links/analyze/stream?url=https://dead-link.example.com/page
Accept: text/event-stream
```

### Bulk scan a page
```http
POST /api/v1/scan
Content-Type: application/json

{ "pageUrl": "https://yoursite.com/docs" }
```

### Rate limits
- Anonymous: 100 req/min
- Authenticated (X-API-Key header): 1000 req/min

---

## Project Structure

```
linkrevive/
├── backend/
│   ├── src/
│   │   ├── server.ts           ← Fastify entry point
│   │   ├── config/
│   │   │   ├── env.ts          ← Zod-validated environment
│   │   │   └── logger.ts       ← Pino structured logger
│   │   ├── plugins/
│   │   │   ├── redis.ts        ← Redis singleton + Fastify plugin
│   │   │   ├── prisma.ts       ← Prisma Fastify plugin
│   │   │   ├── auth.ts         ← API key authentication
│   │   │   └── queue.ts        ← BullMQ queue registration
│   │   ├── routes/
│   │   │   ├── links.ts        ← Link analysis endpoints
│   │   │   ├── scan.ts         ← Bulk scan endpoints
│   │   │   └── health.ts       ← Health/liveness/readiness
│   │   ├── services/
│   │   │   ├── link-analyzer.ts    ← HTTP check + SSRF guard + classify
│   │   │   ├── archive-fetcher.ts  ← Wayback Machine CDX API
│   │   │   ├── alternative-finder.ts ← Google + GitHub search + ranking
│   │   │   ├── ai-explainer.ts     ← Claude-powered analysis + streaming
│   │   │   └── page-crawler.ts     ← Cheerio HTML link extractor
│   │   ├── workers/
│   │   │   └── index.ts        ← BullMQ workers (link-analysis + bulk-scan)
│   │   ├── utils/
│   │   │   └── ssrf-guard.ts   ← SSRF prevention utilities
│   │   └── __tests__/
│   │       └── services.test.ts ← Unit + integration tests
│   ├── prisma/
│   │   └── schema.prisma       ← Database schema
│   ├── Dockerfile
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   └── page.tsx        ← Next.js homepage
│   │   ├── components/
│   │   │   ├── link-checker.tsx    ← Main SSE streaming UI
│   │   │   └── analysis-result.tsx ← Tabbed results panel
│   │   └── types/
│   │       └── api.ts          ← Shared TypeScript interfaces
│   ├── Dockerfile
│   └── package.json
│
├── extension/
│   ├── manifest.json           ← Manifest v3
│   ├── background.js           ← Service worker (navigation detection)
│   ├── content.js              ← Shadow DOM overlay injection
│   └── popup.html              ← Extension popup UI
│
├── docker-compose.yml          ← Full stack orchestration
└── README.md
```

---

## Architecture Decisions

| Decision | Choice | Reason |
|---|---|---|
| API framework | Fastify | 2x faster than Express, schema-first, TypeScript-first |
| Queue | BullMQ | Built on Redis (no extra broker), excellent retries, TypeScript |
| ORM | Prisma | Type-safe queries, migration system, great DX |
| AI | Claude Sonnet | Best instruction-following for structured output parsing |
| SSE vs WebSocket | SSE | Simpler, HTTP/2 multiplexable, no upgrade handshake |
| Shadow DOM | Extension overlay | CSS isolation — zero risk of breaking host page styles |
| SSRF protection | DNS pre-resolution | Blocks metadata endpoints before any request is sent |

---

## License

MIT — see LICENSE file.

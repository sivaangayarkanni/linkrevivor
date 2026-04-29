# LinkRevive Deployment Guide: Vercel + Render

This guide walks you through deploying LinkRevive using Vercel for the frontend and Render for the backend services.

## Overview

- **Frontend (Next.js)** → Vercel
- **Backend API + Workers** → Render
- **Database (PostgreSQL)** → Render
- **Cache (Redis)** → Render

## Prerequisites

1. GitHub account with your LinkRevive repository
2. Vercel account (free tier available)
3. Render account (free tier available)
4. Anthropic API key for AI features

## Step 1: Deploy Backend to Render

### 1.1 Create Render Account
1. Go to [render.com](https://render.com) and sign up
2. Connect your GitHub account

### 1.2 Deploy Services

**Option A: Using render.yaml (Recommended)**
1. Push the `render.yaml` file to your repository
2. In Render dashboard, click "New" → "Blueprint"
3. Connect your repository and select the `render.yaml` file
4. Render will automatically create all services

**Option B: Manual Setup**

**PostgreSQL Database:**
1. In Render dashboard: New → PostgreSQL
2. Name: `linkrevive-postgres`
3. Database: `linkrevive`
4. User: `linkrevive`
5. Plan: Starter (free)

**Redis:**
1. New → Redis
2. Name: `linkrevive-redis`
3. Plan: Starter (free)

**API Service:**
1. New → Web Service
2. Connect your repository
3. Root Directory: `backend`
4. Environment: Node
5. Build Command: `./render-build.sh`
6. Start Command: `./render-start.sh`
7. Plan: Starter

**Worker Service:**
1. New → Background Worker
2. Connect your repository
3. Root Directory: `backend`
4. Build Command: `./render-build.sh`
5. Start Command: `npm run start:worker`
6. Plan: Starter

### 1.3 Configure Environment Variables

For both API and Worker services, add these environment variables:

**Required:**
```
NODE_ENV=production
DATABASE_URL=[Auto-filled from PostgreSQL service]
REDIS_URL=[Auto-filled from Redis service]
API_SECRET_KEY=[Generate with: openssl rand -hex 32]
ALLOWED_ORIGINS=https://your-app.vercel.app
```

**AI Configuration (Choose one):**
```
# Option 1: Anthropic (recommended for quality)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Option 2: Local Ollama (recommended for reliability)
OLLAMA_BASE_URL=http://your-ollama-server:11434
OLLAMA_MODEL=llama3.1:8b

# Option 3: Both (Anthropic primary, Ollama fallback)
ANTHROPIC_API_KEY=sk-ant-api03-...
OLLAMA_BASE_URL=http://your-ollama-server:11434
OLLAMA_MODEL=llama3.1:8b
```

**Optional (for enhanced features):**
```
GOOGLE_CUSTOM_SEARCH_API_KEY=AIza...
GOOGLE_CUSTOM_SEARCH_CX=your-cx-id
GITHUB_TOKEN=ghp_...
ENABLE_AI_EXPLANATIONS=true
MAX_BULK_LINKS=100
```

### 1.4 Get Your API URL
Once deployed, note your Render API service URL (e.g., `https://linkrevive-api.onrender.com`)

## Step 2: Deploy Frontend to Vercel

### 2.1 Create Vercel Account
1. Go to [vercel.com](https://vercel.com) and sign up
2. Connect your GitHub account

### 2.2 Deploy Frontend
1. In Vercel dashboard: "Add New..." → "Project"
2. Import your LinkRevive repository
3. Framework Preset: Next.js
4. Root Directory: `frontend`
5. Build Command: `npm run build` (auto-detected)
6. Output Directory: `.next` (auto-detected)

### 2.3 Configure Environment Variables
In Vercel project settings → Environment Variables:

```
NEXT_PUBLIC_API_URL=https://your-render-api-url.onrender.com
```

### 2.4 Update CORS Settings
Go back to Render and update the `ALLOWED_ORIGINS` environment variable for your API service:
```
ALLOWED_ORIGINS=https://your-vercel-app.vercel.app
```

## Step 4: Optional - Deploy Ollama (Local AI Fallback)

For maximum reliability and to avoid rate limits entirely, you can deploy Ollama as a local AI fallback:

### 4.1 VPS Deployment (Recommended)
```bash
# On a separate VPS (4GB+ RAM recommended)
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve &
ollama pull llama3.1:8b

# Update your Render environment variables
OLLAMA_BASE_URL=http://your-vps-ip:11434
OLLAMA_MODEL=llama3.1:8b
```

### 4.2 Docker Deployment
```bash
# Add to your docker-compose.yml
services:
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    restart: unless-stopped
```

See `OLLAMA_SETUP.md` for detailed installation instructions.

## Step 5: Deploy Chrome Extension (Optional)

### 3.1 Update Extension Configuration
Edit `extension/manifest.json` to point to your production API:

```json
{
  "host_permissions": [
    "https://your-render-api-url.onrender.com/*"
  ]
}
```

### 3.2 Chrome Web Store
1. Zip the `extension/` folder
2. Go to [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
3. Upload and publish your extension

## Step 4: Verification

### 4.1 Test the Deployment
1. Visit your Vercel URL
2. Try analyzing a broken link
3. Check that all features work:
   - Link analysis
   - Archive retrieval
   - Alternative suggestions
   - AI explanations (if enabled)

### 4.2 Monitor Services
- **Render**: Check service logs in the dashboard
- **Vercel**: Check function logs and analytics
- **Health Check**: Visit `https://your-api-url.onrender.com/health`

## Troubleshooting

### Common Issues

**1. Database Connection Errors**
- Ensure `DATABASE_URL` is correctly set from PostgreSQL service
- Check that migrations ran successfully in API service logs

**2. Redis Connection Errors**
- Verify `REDIS_URL` is set from Redis service
- Ensure Redis service is running

**3. CORS Errors**
- Update `ALLOWED_ORIGINS` to include your Vercel domain
- Ensure no trailing slashes in URLs

**4. Build Failures**
- Check that all dependencies are in `package.json`
- Verify build scripts are correct
- Check Render build logs for specific errors

**5. Worker Not Processing Jobs**
- Ensure worker service is deployed and running
- Check that Redis connection is working
- Verify environment variables match API service

### Performance Optimization

**Render (Free Tier Limitations):**
- Services sleep after 15 minutes of inactivity
- First request after sleep takes ~30 seconds
- Consider upgrading to paid plan for production

**Vercel:**
- Automatic edge caching and CDN
- Serverless functions with global distribution
- No cold start issues for static content

## Cost Estimation

**Free Tier:**
- Vercel: Free (with usage limits)
- Render: Free (with sleep limitations)
- Total: $0/month

**Production Tier:**
- Vercel Pro: $20/month
- Render Starter: $7/month per service (API + Worker + DB + Redis = ~$28/month)
- Total: ~$48/month

## Security Considerations

1. **API Keys**: Store sensitive keys as environment variables, never in code
2. **CORS**: Restrict `ALLOWED_ORIGINS` to your actual domains
3. **Rate Limiting**: Built-in rate limiting is configured in the API
4. **SSRF Protection**: Built-in SSRF guards prevent internal network access
5. **Database**: Use connection pooling and prepared statements (handled by Prisma)

## Scaling

**Horizontal Scaling:**
- Render: Increase worker replicas in dashboard
- Vercel: Automatic scaling based on traffic

**Vertical Scaling:**
- Render: Upgrade service plans for more CPU/memory
- Database: Upgrade PostgreSQL plan for more connections/storage

## Monitoring

**Recommended Tools:**
- Render: Built-in metrics and logs
- Vercel: Analytics and Web Vitals
- External: Consider Sentry for error tracking
- Uptime: Use UptimeRobot or similar for health monitoring

---

## Quick Commands Reference

```bash
# Generate API secret key
openssl rand -hex 32

# Test API health
curl https://your-api-url.onrender.com/health

# Test link analysis
curl -X POST https://your-api-url.onrender.com/api/v1/links/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/broken-link"}'
```

Your LinkRevive application should now be fully deployed and accessible worldwide! 🚀
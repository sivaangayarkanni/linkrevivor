# Ollama Local AI Setup Guide

Ollama provides local AI inference as a fallback when external APIs (Anthropic, OpenAI) are rate limited or unavailable.

## Installation

### macOS
```bash
# Install via Homebrew
brew install ollama

# Or download from https://ollama.ai
```

### Linux
```bash
# Install script
curl -fsSL https://ollama.ai/install.sh | sh
```

### Windows
Download and install from [ollama.ai](https://ollama.ai)

### Docker
```bash
# Run Ollama in Docker
docker run -d -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama

# Pull a model
docker exec -it ollama ollama pull llama3.1:8b
```

## Model Setup

### Recommended Models for LinkRevive

**For Development (8GB+ RAM):**
```bash
ollama pull llama3.1:8b        # 4.7GB - Good balance of speed/quality
ollama pull mistral:7b         # 4.1GB - Fast and efficient
```

**For Production (16GB+ RAM):**
```bash
ollama pull llama3.1:70b       # 40GB - Best quality
ollama pull codellama:13b      # 7.3GB - Better for technical content
```

**For Low-Resource Systems (4GB+ RAM):**
```bash
ollama pull llama3.1:8b-instruct-q4_0  # 4.3GB - Quantized version
ollama pull phi3:mini          # 2.3GB - Microsoft's small model
```

### Start Ollama Service

```bash
# Start Ollama server
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b

# Make Anthropic optional
ANTHROPIC_API_KEY=  # Leave empty to use Ollama as primary
```

### Docker Compose Integration

Add Ollama to your `docker-compose.yml`:

```yaml
services:
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_KEEP_ALIVE=24h
    restart: unless-stopped
    # For GPU support (optional)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]

  api:
    # ... existing config
    environment:
      # ... existing vars
      OLLAMA_BASE_URL: http://ollama:11434
      OLLAMA_MODEL: llama3.1:8b
    depends_on:
      - ollama

volumes:
  ollama_data:
```

## Usage

### Automatic Fallback

LinkRevive will automatically use Ollama when:
- Anthropic API is rate limited
- Anthropic API key is missing/invalid
- External API calls fail

### Manual Testing

```bash
# Test Ollama directly
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Explain what a dead link is in 2 sentences.",
  "stream": false
}'

# Test via LinkRevive health endpoint
curl http://localhost:3001/health/ai
```

### Provider Status

Check which AI providers are available:

```bash
curl http://localhost:3001/health/ai
```

Response:
```json
{
  "providers": [
    {
      "name": "anthropic",
      "available": false,
      "circuitOpen": true,
      "failures": 3
    },
    {
      "name": "ollama", 
      "available": true,
      "circuitOpen": false,
      "failures": 0
    }
  ],
  "hasAvailable": true
}
```

## Performance Optimization

### Model Selection

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| `phi3:mini` | 2.3GB | ⚡⚡⚡ | ⭐⭐ | Development/Testing |
| `llama3.1:8b` | 4.7GB | ⚡⚡ | ⭐⭐⭐ | Production (Recommended) |
| `mistral:7b` | 4.1GB | ⚡⚡ | ⭐⭐⭐ | Fast Production |
| `codellama:13b` | 7.3GB | ⚡ | ⭐⭐⭐⭐ | Technical Content |
| `llama3.1:70b` | 40GB | ⚡ | ⭐⭐⭐⭐⭐ | High-End Production |

### Hardware Requirements

**Minimum:**
- 8GB RAM
- 4 CPU cores
- 10GB disk space

**Recommended:**
- 16GB+ RAM
- 8+ CPU cores
- 50GB+ disk space
- GPU (optional, for faster inference)

### GPU Acceleration (Optional)

For NVIDIA GPUs:
```bash
# Install NVIDIA Container Toolkit
# Then run with GPU support
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 ollama/ollama
```

## Troubleshooting

### Common Issues

**1. Ollama Not Starting**
```bash
# Check if port is in use
lsof -i :11434

# Kill existing process
pkill ollama

# Restart
ollama serve
```

**2. Model Not Found**
```bash
# List available models
ollama list

# Pull missing model
ollama pull llama3.1:8b
```

**3. Out of Memory**
```bash
# Use smaller model
ollama pull phi3:mini

# Or quantized version
ollama pull llama3.1:8b-instruct-q4_0
```

**4. Slow Performance**
```bash
# Check system resources
htop

# Use faster model
ollama pull mistral:7b

# Reduce context length in LinkRevive config
```

### Logs and Debugging

```bash
# Ollama logs
ollama logs

# LinkRevive AI provider logs
docker logs linkrevive-api | grep "AI provider"

# Test specific model
ollama run llama3.1:8b "Test prompt"
```

## Production Deployment

### Render.com with Ollama

Since Render doesn't support custom Docker images easily, consider:

1. **Use Anthropic as primary** (with proper rate limiting)
2. **Deploy Ollama separately** on a VPS/dedicated server
3. **Set OLLAMA_BASE_URL** to your Ollama server URL

### VPS Deployment

```bash
# On your VPS
curl -fsSL https://ollama.ai/install.sh | sh
ollama serve &
ollama pull llama3.1:8b

# In your LinkRevive .env
OLLAMA_BASE_URL=http://your-vps-ip:11434
```

### Security Considerations

- **Firewall**: Only expose port 11434 to your LinkRevive servers
- **Authentication**: Ollama doesn't have built-in auth, use VPN/private network
- **Resource Limits**: Set memory/CPU limits to prevent system overload

## Cost Comparison

| Provider | Cost | Speed | Quality | Availability |
|----------|------|-------|---------|--------------|
| Anthropic | $15/1M tokens | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Rate limited |
| Ollama | $0 (hardware) | ⚡⚡ | ⭐⭐⭐⭐ | Always available |

**Ollama Benefits:**
- ✅ No API costs
- ✅ No rate limits  
- ✅ Privacy (local processing)
- ✅ Always available
- ✅ Customizable models

**Ollama Drawbacks:**
- ❌ Requires local resources
- ❌ Slower than cloud APIs
- ❌ Setup complexity
- ❌ Model management overhead

---

With Ollama configured, LinkRevive becomes fully resilient to external API failures while maintaining all AI-powered features! 🚀
# Omnix Local AI Development

Omnix local AI runs through FastAPI and Ollama. The production-facing contract is the FastAPI API; Ollama is an internal model runtime.

## Architecture

```text
Next.js frontend
  -> FastAPI /chat or /chat/stream
  -> chat service
  -> retrieval/context layer
  -> Ollama OpenAI-compatible API
  -> gemma:2b
```

The service layer is designed so RAG, workspace memory, tools, and future agent orchestration can inject context before generation without changing frontend contracts.

## Environment

Backend `.env`:

```bash
ENV=dev
DEV_MODE=true

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_public_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_backend_only_service_role_key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json

REDIS_URL=redis://localhost:6379/0

MODEL_URL=http://localhost:11434/v1/chat/completions
AI_MODEL=gemma:2b
AI_REQUEST_TIMEOUT_SECONDS=60
AI_STREAM_TIMEOUT_SECONDS=120
AI_MAX_RETRIES=2
AI_MAX_OUTPUT_TOKENS=900
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=gemma:2b
```

Frontend `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_public_anon_key
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Local Startup

```bash
ollama serve
ollama pull gemma:2b
ollama run gemma:2b "Say hello from Omnix."
```

```bash
brew services start redis
```

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

## Health Checks

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
curl http://localhost:11434/api/tags
```

## API Testing

Direct Ollama:

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma:2b",
    "messages": [{"role": "user", "content": "Explain Omnix in one sentence."}],
    "stream": false
  }'
```

FastAPI protected generation:

```bash
export TOKEN="supabase-access-token"

curl http://localhost:8000/ai/generate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain the Omnix local AI architecture.",
    "temperature": 0.2
  }'
```

Chat persistence endpoint:

```bash
curl http://localhost:8000/chat \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a workspace summary.",
    "temperature": 0.2
  }'
```

Streaming endpoint:

```bash
curl -N http://localhost:8000/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Draft a launch checklist for Omnix.",
    "temperature": 0.2
  }'
```

## Engineering Workflow

```text
local branch
  -> focused implementation
  -> backend tests and frontend build
  -> GitHub pull request
  -> review and CI
  -> merge to main
  -> deploy to EC2
  -> health check
```

Recommended commands:

```bash
git checkout main
git pull origin main
git checkout -b codex/ollama-gemma-chat

cd backend && source venv/bin/activate && pytest
cd ../frontend && npm run lint && npm run build
```

## EC2 Deployment

```bash
ssh ubuntu@your-ec2
cd /opt/omnix
git fetch origin
git checkout main
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
./scripts/healthcheck.sh
```

Keep production variables separate from local variables. The frontend must never receive service role keys.

Current EC2 public IPv4 address:

```text
54.172.104.28
```

Temporary Vercel production API variable until DNS and SSL are ready:

```bash
NEXT_PUBLIC_API_BASE_URL=http://54.172.104.28
```

After `api.omni-x.co.in` is configured with HTTPS, switch Vercel to:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.omni-x.co.in
```

## Rollback

Use immutable git tags or Docker image tags:

```bash
git tag prod-good-YYYYMMDD
git checkout prod-good-YYYYMMDD
docker compose -f docker-compose.prod.yml up -d --build
./scripts/healthcheck.sh
```

## Future AI Expansion

The chat service should remain provider-neutral at the route boundary. Add future capabilities behind service interfaces:

- RAG context injection before generation.
- Workspace memory retrieval.
- Embedding provider routing.
- Tool calling.
- Multi-agent orchestration.
- GPU-backed Ollama, vLLM, or Kubernetes model serving.

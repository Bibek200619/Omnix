# Omnix

Omnix is an AI-native collaborative operating system built around workspace hierarchy, authenticated team access, document-aware chat, and operational continuity.

The current codebase is a full-stack app:

- Frontend: Next.js 15, React 19, TypeScript, Supabase Auth, Tailwind, Framer Motion
- Backend: FastAPI, Supabase/Postgres, pgvector, Redis-ready background jobs, streaming chat
- AI/RAG: workspace-scoped retrieval, local or OpenAI embeddings, Ollama/OpenAI-compatible runtime configuration
- Collaboration: workspaces, subspaces, members, invites, roles, presence, activity, tasks, initiatives, and continuity surfaces

This README reflects the current repository state. It intentionally avoids fake metrics, fake collaboration states, and admin-panel positioning.

## Current Status

Omnix is in active product development. The core workspace operating surface is implemented, with frontend routes and backend APIs for authenticated workspaces, chat, files, retrieval, collaboration, and continuity.

Live in the repo:

- Authenticated landing, login, register, callback, and invite flows
- Dashboard shell with workspace-aware navigation
- Workspace hierarchy with root workspaces and subspaces
- Workspace switching and persisted active workspace context
- Workspace onboarding gate
- Workspace member management, role assignment, invitations, and pending invite handling
- Workspace presence and activity feeds backed by real workspace data
- Workspace chat with streaming assistant responses and recovery-oriented client handling
- Conversation history and message persistence
- File upload and workspace-scoped document context
- RAG pipeline with chunking, embeddings, hybrid retrieval, pgvector migrations, and document context building
- Tasks, initiatives, operational timelines, and continuity memory surfaces
- Workspace intelligence settings and cognitive focus controls
- Automations, artifacts, insights, Google Drive integration routes, and runtime health endpoints
- Backend bootstrap for Redis, observability, vector store initialization, workers, and graceful shutdown

Still limited or environment-dependent:

- External connectors are not all fully active; some frontend source flows capture setup intent until backend ingestion is enabled.
- Email invitations require `RESEND_API_KEY` and sender configuration.
- Google Drive import requires provider credentials and the related migration/configuration.
- AI quality depends on the configured provider, model, embeddings provider, and available document corpus.
- Local development requires a configured Supabase project and applied migrations.
- Redis-backed workers are wired through bootstrap/compose, but production job behavior depends on deployment configuration.

## Repository Docs

Keep root markdown limited to active, useful documents:

- `README.md` for current product, architecture, setup, and operations.
- `AGENTS.md` for non-negotiable assistant and architecture rules.
- `OMNIX_CODEBASE_MAP.md` for detailed code navigation.
- `SECURITY.md` for security policy and reporting.

Put narrow technical notes under `docs/`, and update an existing canonical doc instead of adding another root `.md` file.

## Architecture Rules

Omnix has a few non-negotiable product and architecture constraints:

- Workspace hierarchy is the spine.
- Do not break the onboarding gate.
- Do not break streaming chat recovery.
- Preserve workspace switching.
- Preserve auth session persistence.
- Avoid admin-panel UI.
- Preserve the cinematic premium design language.
- Use truthful analytics only.
- Never fake collaboration states.

Critical areas:

- `frontend/lib/workspace-context.tsx`
- `frontend/lib/workspace-collaboration-context.tsx`
- `frontend/lib/workspace-continuity-context.tsx`
- `frontend/components/workspace/`
- `frontend/components/chat/ChatInterface.tsx`
- `backend/app/routers/workspaces.py`
- `backend/app/routers/messages.py`
- `backend/app/services/workspace_*`
- `backend/app/context/`
- `backend/app/rag/`
- `backend/app/retrieval/`

## System Shape

```text
Next.js app
  -> Supabase Auth session
  -> FastAPI API client with workspace header
  -> Workspace, chat, files, tasks, initiatives, continuity APIs
  -> Retrieval/context engine
  -> Supabase/Postgres + pgvector
  -> AI runtime provider
  -> Streaming response back to chat UI
```

The frontend stores the active workspace locally and sends it to the backend as `X-Omnix-Workspace`. Backend routes still validate access through authenticated user context and workspace permissions.

## Frontend

The frontend lives in `frontend/`.

Important routes:

- `/` landing experience
- `/login`, `/register`, `/auth/callback`
- `/dashboard`
- `/chat`
- `/workspace`
- `/conversations`
- `/files`
- `/sources`
- `/team`
- `/tasks`
- `/initiatives`
- `/analytics`
- `/history`
- `/settings`
- `/invite`

Important frontend modules:

- `frontend/lib/api.ts` handles authenticated API requests and streaming calls.
- `frontend/lib/auth-context.tsx` keeps Supabase auth state available to the app.
- `frontend/lib/workspace-context.tsx` owns workspace loading, switching, invite flows, and active workspace persistence.
- `frontend/lib/workspace-collaboration-context.tsx` owns activity and presence state.
- `frontend/components/workspace/WorkspaceOnboardingGate.tsx` protects the workspace-first experience.
- `frontend/components/chat/ChatInterface.tsx` handles chat state, streaming reads, aborts, timeouts, and conversation recovery.

## Backend

The backend lives in `backend/` and starts from `backend/app/main.py`.

Major backend areas:

- `backend/app/bootstrap/` app creation, middleware, Redis, observability, workers, vector store, shutdown
- `backend/app/core/` auth, config, RBAC
- `backend/app/db/` Supabase client access
- `backend/app/routers/` HTTP API routes
- `backend/app/services/` product services for chat, workspaces, collaboration, tasks, intelligence, email, and retrieval context
- `backend/app/context/` context engine, prompt building, memory, ranking, citations, token budgets
- `backend/app/rag/` ingestion, chunking, embeddings, pgvector store, startup contracts
- `backend/app/retrieval/` semantic, keyword, hybrid search, reranking, scoring
- `backend/app/observability/` metrics, traces, runtime diagnostics, streaming traces
- `backend/app/jobs/` ingestion, automation, re-embedding, queues, workers
- `backend/migrations/` SQL migrations through workspace, collaboration, pgvector, intelligence, and continuity features

Selected API surfaces:

- `GET /health/live`
- `GET /health/ready`
- `GET /health/runtime`
- `POST /chat`
- `POST /chat/stream`
- `GET /conversations`
- `POST /conversations`
- `GET /conversations/{conversation_id}`
- `GET /conversations/{conversation_id}/messages`
- `POST /files`
- `GET /files`
- `POST /upload`
- `GET /workspaces`
- `POST /workspaces`
- `GET /workspaces/hierarchy`
- `GET /workspaces/status`
- `GET /workspaces/{workspace_id}/presence`
- `POST /workspaces/{workspace_id}/presence/heartbeat`
- `GET /workspaces/{workspace_id}/activity`
- `GET /workspaces/{workspace_id}/members`
- `POST /workspaces/{workspace_id}/invites`
- `GET /workspaces/{workspace_id}/channels`
- `POST /workspaces/{workspace_id}/channels/{channel_id}/messages`
- `GET /workspaces/{workspace_id}/tasks`
- `POST /workspaces/{workspace_id}/tasks`
- `GET /workspaces/{workspace_id}/initiatives`
- `GET /workspaces/{workspace_id}/timeline`
- `POST /workspaces/{workspace_id}/insights/generate`
- `GET /integrations/google_drive/connect`
- `POST /integrations/google_drive/import`

## Data And Retrieval

Supabase is the source of truth for auth, profile data, workspaces, messages, files, tasks, invites, activity, and document chunks.

Retrieval currently supports:

- Document chunking and ingestion
- Local embedding provider and OpenAI embedding provider modules
- pgvector-backed vector search migrations
- Keyword search
- Hybrid retrieval
- Workspace-aware document filtering
- Context assembly with token budgeting and citations support

The older README described FAISS as the active vector store. The current repo has moved toward pgvector-backed retrieval and migration-managed embedding contracts.

## Environment

Use local `.env` files for secrets. Do not commit service role keys or real provider credentials.

Common backend variables:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWKS_URL=
ENV=dev
DEV_MODE=true
REDIS_URL=redis://localhost:6379/0
MODEL_URL=http://localhost:11434/v1/chat/completions
AI_MODEL=phi3:latest
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=phi3:latest
WEB_SEARCH_ENABLED=false
TAVILY_API_KEY=
RESEND_API_KEY=
RESEND_FROM_EMAIL=
OMNIX_APP_URL=http://localhost:3000
```

Common frontend variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

The repository includes example env files, but local values should be reviewed before use.

## Local Development

Install root tooling:

```bash
npm install
```

Install frontend dependencies:

```bash
npm --prefix frontend install
```

Install backend dependencies:

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

Run both apps from the repo root:

```bash
npm run dev
```

Or run them separately:

```bash
npm run backend
npm run frontend
```

Default local URLs:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`

## Docker

`docker-compose.yml` includes backend, Redis, and worker services. It does not run the Next.js frontend.

```bash
docker compose up --build
```

The compose setup expects Supabase variables in the environment.

## Migrations

SQL migrations live in `backend/migrations/`.

They include:

- Base schema alignment
- pgvector setup
- Workspaces and collaboration
- Artifacts and automations
- Google Drive tokens
- Jobs
- Local embedding contract
- Hybrid retrieval
- Workspace invites and roles
- Profiles
- Message metadata and payloads
- Workspace intelligence and memory
- Realtime enablement
- Operational continuity, conversations, tasks, and initiatives

Apply migrations to the configured Supabase/Postgres project before relying on workspace, retrieval, or collaboration features.

## Verification

Useful checks:

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

Backend verification depends on the local Python environment and configured services. At minimum, start the API and check:

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

## Security Notes

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Frontend code should only use the Supabase anon key.
- Backend routes must continue to validate JWTs and workspace access.
- Presence, activity, analytics, and collaboration UI must reflect real backend state.
- Do not bypass workspace permission checks for convenience.
- Be careful when editing env examples; rotate any credential that was exposed outside local development.

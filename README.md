<div align="center">

# Omnix

### AI-native workspace for teams, knowledge, collaboration, and operational continuity

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.138-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**Web:** [omni-x.co.in](https://omni-x.co.in)  
**Project board:** [Omnix Development Board](https://github.com/users/Bibek200619/projects/9)  
**CLI:** [Bibek200619/Omnix-CLI](https://github.com/Bibek200619/Omnix-CLI)

</div>

---

## Overview

Omnix is an AI-native collaborative operating system designed around a **workspace-first model**. It combines authenticated team collaboration, document-aware AI chat, workspace knowledge, tasks, initiatives, operational memory, and continuity tooling in one product surface.

The repository contains the main Omnix web platform:

- **Frontend:** Next.js 15, React 19, TypeScript, Supabase Auth, Tailwind CSS, Framer Motion
- **Backend:** FastAPI, Supabase/Postgres, pgvector, Redis-ready workers, streaming APIs
- **AI & retrieval:** workspace-scoped RAG, hybrid retrieval, local/OpenAI embeddings, Ollama/OpenAI-compatible model runtimes
- **Collaboration:** workspaces, subspaces, members, roles, invites, presence, activity, conversations, tasks, and initiatives
- **Continuity:** workspace timelines, memory, context assembly, intelligence settings, operational surfaces, and recovery-aware chat

Omnix is in **active development**. The README reflects the current repository rather than a future mockup or demo-only architecture.

## Core Product Capabilities

### Workspace-first collaboration

- Authenticated workspaces and subspaces
- Workspace switching with persisted active context
- Workspace onboarding gate
- Member management and role assignment
- Workspace invitations and pending invite handling
- Presence and activity feeds backed by real workspace data
- Workspace channels and collaboration surfaces

### AI chat and knowledge

- Streaming AI chat
- Persisted conversations and messages
- Workspace-scoped document context
- File upload and ingestion
- Chunking and embedding pipelines
- pgvector-backed semantic retrieval
- Keyword + hybrid retrieval
- Context assembly with token budgets and citation support
- Local or hosted AI provider configuration

### Work and continuity

- Tasks and initiatives
- Operational timelines
- Workspace intelligence settings
- Cognitive focus controls
- Continuity and memory surfaces
- Artifacts, automations, and insights
- Runtime health and observability endpoints

### Integrations

- Supabase authentication and database
- Google Drive connection/import routes
- Resend-powered workspace invitation email flow
- Redis-ready workers and background jobs
- Omnix CLI integration path

## Omnix CLI Integration

Omnix and [Omnix CLI](https://github.com/Bibek200619/Omnix-CLI) are separate repositories that are evolving toward a shared product experience.

The backend currently includes Omnix CLI as a pinned Git dependency, creating a technical integration path between the web platform and CLI. The long-term direction is to share authentication, workspace context, AI capabilities, and developer workflows without forcing both projects into the same repository prematurely.

```text
Omnix Web
   │
   ├── Workspace / Auth / Collaboration
   ├── Knowledge / RAG / AI Runtime
   │
   └──── shared product capabilities ──── Omnix CLI
```

The integration is still evolving, so CLI behavior should not be treated as a fully unified production surface yet.

## Architecture

```text
                         ┌─────────────────────┐
                         │     Omnix Web      │
                         │ Next.js + React 19 │
                         └──────────┬──────────┘
                                    │
                         Supabase Auth session
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │    FastAPI API      │
                         │ Workspace-aware    │
                         └──────────┬──────────┘
                                    │
                  ┌─────────────────┼──────────────────┐
                  │                 │                  │
                  ▼                 ▼                  ▼
            Workspace APIs    Chat / Context      Files / Jobs
                  │                 │                  │
                  └─────────────────┼──────────────────┘
                                    │
                                    ▼
                        Retrieval + Context Engine
                                    │
                     ┌──────────────┼──────────────┐
                     │              │              │
                     ▼              ▼              ▼
                 pgvector       Keyword       Embeddings
                     │              │              │
                     └──────────────┼──────────────┘
                                    │
                                    ▼
                       Supabase / PostgreSQL
                                    │
                                    ▼
                         Configured AI Runtime
                                    │
                                    ▼
                         Streaming response
```

The frontend sends the active workspace to the backend through `X-Omnix-Workspace`. Backend routes still validate the authenticated user and workspace permissions before serving workspace-scoped data.

## Repository Structure

```text
Omnix/
├── frontend/                 # Next.js application
├── backend/
│   ├── app/
│   │   ├── bootstrap/        # App startup, middleware, Redis, workers
│   │   ├── context/          # Context engine, prompts, memory, ranking
│   │   ├── core/             # Auth, config, RBAC
│   │   ├── db/               # Supabase access
│   │   ├── jobs/             # Background jobs and workers
│   │   ├── observability/    # Metrics, tracing, diagnostics
│   │   ├── rag/              # Ingestion, chunking, embeddings, vector store
│   │   ├── retrieval/        # Semantic, keyword and hybrid retrieval
│   │   ├── routers/          # FastAPI routes
│   │   └── services/         # Product/domain services
│   └── migrations/           # Database migrations
├── docs/                     # Focused technical documentation
├── supabase/                 # Supabase configuration
├── docker-compose.yml
├── nginx.conf
├── AGENTS.md
├── OMNIX_CODEBASE_MAP.md
├── SECURITY.md
└── README.md
```

## Important Frontend Areas

The frontend lives in `frontend/`.

Key routes include:

- `/` — landing experience
- `/login`, `/register`, `/auth/callback` — authentication
- `/dashboard` — workspace dashboard
- `/chat` — AI chat
- `/workspace` — workspace management
- `/conversations` — conversation history
- `/files` and `/sources` — knowledge sources
- `/team` — collaboration and members
- `/tasks` — tasks
- `/initiatives` — initiatives
- `/analytics` — analytics surfaces
- `/history` — operational history
- `/settings` — account/workspace settings
- `/invite` — invite flow

Important modules:

- `frontend/lib/api.ts`
- `frontend/lib/auth-context.tsx`
- `frontend/lib/workspace-context.tsx`
- `frontend/lib/workspace-collaboration-context.tsx`
- `frontend/lib/workspace-continuity-context.tsx`
- `frontend/components/workspace/WorkspaceOnboardingGate.tsx`
- `frontend/components/chat/ChatInterface.tsx`

## Important Backend Areas

The backend starts from `backend/app/main.py`.

Major areas:

- `backend/app/bootstrap/` — startup, middleware, Redis, vector store, workers, shutdown
- `backend/app/core/` — authentication, configuration, RBAC
- `backend/app/routers/` — HTTP API routes
- `backend/app/services/` — product/domain services
- `backend/app/context/` — context engine and prompt assembly
- `backend/app/rag/` — ingestion, chunking, embeddings, vector retrieval
- `backend/app/retrieval/` — semantic, keyword and hybrid search
- `backend/app/observability/` — metrics, traces and runtime diagnostics
- `backend/app/jobs/` — ingestion, automation, re-embedding and queues
- `backend/migrations/` — SQL migrations

Selected API surfaces:

```text
GET  /health/live
GET  /health/ready
GET  /health/runtime
POST /chat
POST /chat/stream
GET  /conversations
POST /conversations
GET  /files
POST /files
GET  /workspaces
POST /workspaces
GET  /workspaces/hierarchy
GET  /workspaces/status
GET  /workspaces/{workspace_id}/members
GET  /workspaces/{workspace_id}/presence
GET  /workspaces/{workspace_id}/activity
POST /workspaces/{workspace_id}/invites
GET  /workspaces/{workspace_id}/tasks
GET  /workspaces/{workspace_id}/initiatives
GET  /workspaces/{workspace_id}/timeline
POST /workspaces/{workspace_id}/insights/generate
GET  /integrations/google_drive/connect
POST /integrations/google_drive/import
```

## Local Development

### Prerequisites

You will need:

- Node.js and npm
- Python with virtual environment support
- A Supabase project
- PostgreSQL/pgvector through Supabase
- Redis for worker-backed features
- Ollama or another configured AI provider if running AI locally

### 1. Clone the repository

```bash
git clone https://github.com/Bibek200619/Omnix.git
cd Omnix
```

### 2. Install root tooling

```bash
npm install
```

### 3. Install frontend dependencies

```bash
npm --prefix frontend install
```

### 4. Install backend dependencies

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # macOS / Linux
# .venv\Scripts\activate    # Windows PowerShell
pip install -r requirements.txt
cd ..
```

> The backend requirements currently include the Omnix CLI repository as a pinned Git dependency, so Git access is required during installation.

### 5. Configure environment variables

Use the example files as the canonical starting point.

Backend:

```bash
cp backend/.env.example backend/.env
```

Common backend values:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWKS_URL=
DEV_MODE=true

MODEL_URL=http://localhost:11434/api/chat
AI_MODEL=phi3:mini
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=phi3:mini

WEB_SEARCH_ENABLED=false
TAVILY_API_KEY=

REDIS_URL=redis://localhost:6379/0

RESEND_API_KEY=
EMAIL_FROM=Omnix <noreply@omni-x.co.in>
OMNIX_APP_URL=http://localhost:3000
```

Frontend:

```bash
cp frontend/.env.example frontend/.env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_BASE_URL=/api
OMNIX_API_PROXY_TARGET=http://localhost:8000
```

Never commit real service-role keys, provider credentials, or production secrets.

### 6. Run Omnix

Run the frontend and backend together from the repository root:

```bash
npm run dev
```

Or separately:

```bash
npm run backend
npm run frontend
```

Default development URLs:

| Service | URL |
| --- | --- |
| Frontend | `http://localhost:3000` |
| Backend | `http://localhost:8000` |
| FastAPI docs | `http://localhost:8000/docs` |
| Health | `http://localhost:8000/health/live` |

## Docker

The root `docker-compose.yml` provides backend/worker infrastructure including Redis-oriented services. The Next.js frontend is developed separately.

```bash
docker compose up --build
```

The compose environment still requires valid Supabase and provider configuration.

## Database and Migrations

SQL migrations live in `backend/migrations/` and cover areas such as:

- Base schema alignment
- pgvector and embedding contracts
- Workspaces and collaboration
- Invites and roles
- Profiles
- Artifacts and automations
- Google Drive tokens
- Jobs
- Hybrid retrieval
- Message metadata and payloads
- Workspace intelligence and memory
- Realtime configuration
- Operational continuity
- Conversations, tasks, and initiatives

Apply the required migrations to the configured Supabase/Postgres project before relying on workspace, collaboration, or retrieval features.

## Verification

### Frontend

```bash
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix frontend run test:e2e
npm --prefix frontend run test:ui-audit
```

The deterministic Playwright suite uses controlled responses for repeatable UI, race, mobile, and accessibility testing.

A separate live E2E lane can validate the deployed application against authenticated backend and Supabase state:

```bash
OMNIX_E2E_BASE_URL=https://your-deployment.example \
OMNIX_E2E_STORAGE_STATE=/absolute/path/to/playwright-storage-state.json \
npm --prefix frontend run test:e2e:live
```

Keep Playwright storage-state files outside the repository and treat them as secrets.

### Backend

At minimum, verify the API starts and its health endpoints respond:

```bash
curl http://localhost:8000/health/live
curl http://localhost:8000/health/ready
```

## Deployment Shape

The repository contains deployment-oriented configuration for:

- Next.js frontend
- FastAPI backend
- `api.omni-x.co.in`
- Nginx reverse proxying
- Production CORS for `omni-x.co.in` and `www.omni-x.co.in`
- Redis/worker bootstrap
- Supabase-backed authentication and persistence

Production behavior still depends on the configured environment, credentials, migrations, model provider, Redis availability, and external integrations.

## Architecture Rules

These are core Omnix product constraints and should remain true as the codebase evolves:

1. **Workspace hierarchy is the spine.**
2. **Do not break the onboarding gate.**
3. **Do not break streaming chat recovery.**
4. **Preserve workspace switching and active context.**
5. **Preserve authentication session persistence.**
6. **Enforce real workspace authorization server-side.**
7. **Use truthful analytics and collaboration state.**
8. **Do not fake activity, presence, members, or operational data.**
9. **Preserve the premium/cinematic Omnix design language.**
10. **Avoid turning Omnix into a generic admin dashboard.**

## Development Workflow

For normal development:

```text
current main
   │
   └── feature/fix branch
            │
            └── Pull Request
                    │
                    └── review + tests
                            │
                            └── main
```

Recommended rules:

- Create new work from the **current `main`**.
- Keep each branch focused on one feature, fix, or milestone.
- Link PRs to their relevant issues.
- Run verification before merging.
- Prefer squash merging when a branch contains noisy intermediate commits.
- Never merge repository recovery/archive branches into `main`.
- Rebase or recreate stale branches that were created from obsolete history before opening a new PR.

## Documentation

Root documentation is intentionally limited:

- `README.md` — product overview, architecture, setup, and development workflow
- `AGENTS.md` — assistant and architecture rules
- `OMNIX_CODEBASE_MAP.md` — codebase navigation
- `SECURITY.md` — security policy and reporting

Focused technical notes belong under `docs/` rather than adding more root-level markdown files.

## Current Limitations

Some capabilities remain environment-dependent or under active development:

- External connectors are not all fully active end-to-end.
- Google Drive import requires provider credentials and supporting configuration.
- Email invitations require Resend configuration.
- AI quality depends on the configured model, embedding provider, retrieval corpus, and runtime resources.
- Local development requires a configured Supabase project and applied migrations.
- Redis-backed jobs depend on deployment/runtime configuration.
- Omnix CLI and Omnix Web are not yet one fully unified product surface.

## Security

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- The frontend should use only the Supabase anon key.
- Validate JWTs and workspace permissions on backend routes.
- Never trust workspace IDs supplied by the client without authorization checks.
- Do not expose Playwright storage-state files or provider secrets.
- Rotate credentials immediately if they are accidentally committed or shared.
- See [`SECURITY.md`](SECURITY.md) for the repository security policy.

## Roadmap Direction

Omnix is moving toward a unified workspace platform where the web experience and CLI share the same organizational context and intelligence layer.

Near-term direction includes:

- Deeper Omnix CLI integration
- Stronger workspace-aware developer workflows
- More reliable knowledge ingestion and retrieval
- Expanded connectors
- Richer operational continuity and memory
- Production hardening and observability
- Improved collaboration and automation surfaces

Track active work through the [Omnix Development Board](https://github.com/users/Bibek200619/projects/9) and repository issues.

---

<div align="center">

**Omnix — context, collaboration, and intelligence in one workspace.**

</div>

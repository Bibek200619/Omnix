# OMNIX — Complete Codebase Map

> This file is the single source of truth for navigating the Omnix codebase without searching.
> Read this before grepping, searching, or exploring the codebase.
> Keep this file updated when new files or patterns are added.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Root Structure](#2-repository-root-structure)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Data Flow & Request Lifecycle](#5-data-flow--request-lifecycle)
6. [Authentication & Security](#6-authentication--security)
7. [Workspace System](#7-workspace-system)
8. [AI & LLM System](#8-ai--llm-system)
9. [RAG Pipeline](#9-rag-pipeline)
10. [Realtime & Collaboration](#10-realtime--collaboration)
11. [Database & Supabase](#11-database--supabase)
12. [Environment Variables](#12-environment-variables)
13. [API Endpoint Reference](#13-api-endpoint-reference)
14. [Frontend Context Providers](#14-frontend-context-providers)
15. [Key Types & Models](#15-key-types--models)
16. [Critical Path Files](#16-critical-path-files)
17. [Dev & Infra](#17-dev--infra)

---

## 1. Project Overview

**Omnix** is an AI-native collaborative operating system — a unified workspace combining AI chat, project management, team collaboration, knowledge management, and workflow automation.

**Stack:**
- Frontend: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v3, Framer Motion
- Backend: Python FastAPI + uvicorn (async)
- Database: Supabase (PostgreSQL + pgvector + Realtime)
- Vector DB: pgvector (via Supabase RPC `search_documents_vector`)
- AI: Ollama (local, `phi3:mini` default), OpenAI fallback, LangChain/LangGraph
- Cache: Redis
- Auth: Supabase Auth (JWT RS256/ES256, PKCE flow)
- Email: Resend API (workspace invites)
- Deployment: EC2 (`18.204.231.209`), Vercel (frontend)

---

## 2. Repository Root Structure

```
Omnix/
├── frontend/              # Next.js 15 app
├── backend/               # FastAPI Python app
├── scripts/               # Utility scripts
├── docs/                  # Project documentation
├── uploads/               # Local file upload staging
├── docker-compose.yml     # Local dev compose
├── docker-compose.prod.yml
├── nginx.conf             # Production reverse proxy config
├── Makefile               # Dev task shortcuts
├── AGENTS.md              # Core architecture rules (Omnix-specific)
├── GEMINI.md              # Full project mandate for AI assistants
├── CODEX.md               # Coding behavior guidelines
├── CLAUDE.md              # Identical to CODEX.md (Claude-specific copy)
├── ANTIGRAVITY.md         # Antigravity-specific guidelines (this AI)
├── OMNIX_CODEBASE_MAP.md  # THIS FILE — complete codebase map
├── DEVELOPER.md           # Developer onboarding notes
├── REPOSITORY_STRUCTURE.md# High-level repo structure doc
├── README.md              # Public-facing README
└── .env.example           # Root env template
```

---

## 3. Frontend Architecture

**Root:** `frontend/`

### Directory Map

```
frontend/
├── app/                   # Next.js App Router
│   ├── layout.tsx         # Root layout — wraps all providers
│   ├── page.tsx           # Root redirect to /dashboard or /auth
│   ├── (auth)/            # Auth route group (login, signup, password reset)
│   ├── (dashboard)/       # Main app route group
│   │   ├── layout.tsx     # Dashboard layout shell
│   │   ├── chat/          # AI chat page
│   │   ├── conversations/ # Workspace conversations
│   │   ├── dashboard/     # Dashboard/home
│   │   ├── decisions/     # Workspace decisions
│   │   ├── files/         # File management
│   │   ├── history/       # Chat history
│   │   ├── initiatives/   # Workspace initiatives
│   │   ├── mentions/      # Backwards-compatible mentions route rendering notification center
│   │   ├── notifications/ # In-app mention notification center
│   │   ├── settings/      # User/workspace settings
│   │   ├── sources/       # Knowledge sources
│   │   ├── tasks/         # Workspace tasks
│   │   ├── team/          # Team management
│   │   ├── workspace/     # Workspace hub
│   │   └── analytics/     # Analytics dashboard
│   ├── auth/              # Auth callback/confirm routes
│   └── invite/            # Workspace invite acceptance flow
├── components/            # Reusable components
│   ├── chat/              # Chat UI components
│   │   ├── ChatInterface.tsx   # MAIN chat component (47KB) — do not break
│   │   ├── ChatInput.tsx       # Message input with file attach
│   │   ├── MessageBubble.tsx   # AI/user message rendering
│   │   ├── MessageList.tsx     # Virtualized message list
│   │   ├── MarkdownRenderer.tsx# AI response markdown
│   │   ├── HistoryList.tsx     # Conversation history sidebar
│   │   ├── TypingIndicator.tsx # Typing animation
│   │   └── types.ts            # Chat-local types
│   ├── workspace/
│   │   ├── WorkspaceOnboardingGate.tsx  # CRITICAL — first-run gate
│   │   ├── WorkspaceAccessPanel.tsx     # Members/invites management
│   │   ├── WorkspaceIntelligencePanel.tsx # AI config for workspace
│   │   ├── WorkspaceActivityFeed.tsx    # Live activity stream
│   │   ├── WorkspacePresenceCluster.tsx # Online members indicator
│   │   ├── WorkspaceOperationalTimeline.tsx
│   │   ├── InviteNotifications.tsx
│   │   ├── PendingWorkspaceInvites.tsx
│   │   ├── WorkspaceAssignmentModal.tsx
│   │   ├── WorkspaceMemberStack.tsx
│   │   └── WorkspaceInviteModal.tsx
│   ├── layout/
│   │   ├── Sidebar.tsx          # MAIN sidebar (68KB) — workspace switcher + nav
│   │   ├── AppShell.tsx         # Page shell wrapper
│   │   ├── Header.tsx           # Top header bar
│   │   ├── CommandPalette.tsx   # Global Ctrl/Cmd+K command palette
│   │   ├── WorkspaceSearch.tsx  # Header workspace-scoped search UI
│   │   ├── ProfileMenu.tsx      # User profile dropdown
│   │   ├── MobileDock.tsx       # Mobile bottom navigation with "More" drawer trigger
│   │   └── PageTransition.tsx   # Route transition animation
│   ├── auth/                    # Auth forms
│   ├── brand/                   # Logo/brand assets
│   ├── conversations/           # Workspace channel/conversation components
│   ├── decisions/               # Decision tracking components
│   ├── mentions/                # Mention text rendering, @ member picker, inbox surface
│   ├── notifications/           # Header notification bell + notification center
│   ├── initiatives/             # Initiative/project components
│   ├── tasks/                   # Task management components
│   ├── profile/                 # User profile components
│   ├── settings/                # Settings panels
│   ├── upload/                  # File upload components
│   ├── actions/                 # Action extraction components
│   └── ui/                      # Generic UI primitives (Button, Modal, etc.)
├── lib/                         # Client-side utilities and contexts
│   ├── api.ts                   # ApiClient class — ALL HTTP requests go here
│   ├── supabase.ts              # Supabase client singleton
│   ├── auth-context.tsx         # AuthProvider + useAuth hook
│   ├── workspace-context.tsx    # WorkspaceProvider + useWorkspace hook (45KB)
│   ├── workspace-collaboration-context.tsx # Presence + realtime (17KB)
│   ├── workspace-notifications-context.tsx # Mention notification state, unread count, read actions, realtime refresh
│   ├── workspace-continuity-context.tsx    # Memory/continuity context
│   ├── conversation-history-context.tsx    # Chat history context (9KB)
│   ├── profile-context.tsx      # User profile context
│   ├── realtime-registry.ts     # Supabase Realtime channel manager
│   ├── workspace-types.ts       # ALL workspace TypeScript types (13KB)
│   ├── workspace-roles.ts       # Role hierarchy utilities
│   ├── auth-redirects.ts        # Auth redirect logic
│   ├── errors.ts                # Error logging utilities
│   └── utils.ts                 # Generic utilities
└── styles/                      # Global CSS
```

### Key Frontend Files by Purpose

| Purpose | File |
|---------|------|
| All API calls | `lib/api.ts` → `apiClient` singleton |
| Auth state | `lib/auth-context.tsx` → `useAuth()` |
| Workspace state | `lib/workspace-context.tsx` → `useWorkspace()` |
| Realtime/presence | `lib/workspace-collaboration-context.tsx` → `useCollaboration()` |
| Supabase channels | `lib/realtime-registry.ts` → `realtimeRegistry` |
| All TS types | `lib/workspace-types.ts` |
| Main chat UI | `components/chat/ChatInterface.tsx` |
| Sidebar nav | `components/layout/Sidebar.tsx` |
| Command palette | `components/layout/CommandPalette.tsx` |
| Workspace search UI | `components/layout/WorkspaceSearch.tsx` |
| Mention picker/rendering | `components/mentions/MentionTextarea.tsx`, `components/mentions/MentionText.tsx` |
| Notification bell/center | `components/notifications/NotificationBell.tsx`, `components/notifications/NotificationCenterSurface.tsx`, `app/(dashboard)/notifications/page.tsx`, `app/(dashboard)/settings/notifications/page.tsx` |
| Mentions compatibility route | `app/(dashboard)/mentions/page.tsx` renders `NotificationCenterSurface` |
| Mobile refinement surfaces | `components/settings/SettingsShell.tsx`, `components/layout/CommandPalette.tsx`, `components/layout/WorkspaceSearch.tsx`, `components/workspace/WorkspaceAccessPanel.tsx`, `app/(dashboard)/team/page.tsx`, `app/(dashboard)/files/page.tsx` |
| Onboarding gate | `components/workspace/WorkspaceOnboardingGate.tsx` |

---

## 4. Backend Architecture

**Root:** `backend/`

```
backend/
├── app/
│   ├── main.py              # Entry point — imports create_app()
│   ├── bootstrap/           # App factory + startup
│   │   ├── app.py           # create_app() — FastAPI app factory
│   │   ├── middleware.py     # API logging middleware
│   │   ├── redis.py         # Redis connection init
│   │   ├── vector_store.py  # pgvector init
│   │   ├── workers.py       # Background worker init
│   │   └── shutdown.py      # Graceful shutdown handler
│   ├── routers/             # FastAPI route handlers (API surface)
│   │   ├── messages.py      # AI chat + streaming (50KB — CRITICAL)
│   │   ├── workspaces.py    # Workspace CRUD + members (53KB — CRITICAL)
│   │   ├── conversations.py # Personal AI conversation CRUD
│   │   ├── workspace_conversations.py # Workspace channel messages
│   │   ├── workspace_tasks.py         # Task CRUD
│   │   ├── workspace_decisions.py     # Decision CRUD
│   │   ├── workspace_search.py        # Workspace-scoped keyword search
│   │   ├── workspace_mentions.py      # Workspace-scoped mention notifications + read state
│   │   ├── files.py                   # File metadata
│   │   ├── upload.py                  # File upload + RAG ingestion trigger
│   │   ├── artifacts.py               # AI artifact storage
│   │   ├── actions.py                 # AI action extraction
│   │   ├── automations.py             # Automation rules
│   │   ├── insights.py                # AI-generated insights
│   │   ├── connectors.py              # External data connectors
│   │   ├── google_drive.py            # Google Drive integration
│   │   ├── continuity.py              # Workspace continuity/memory
│   │   ├── profile.py                 # User profile
│   │   ├── cache.py                   # Cache management
│   │   └── admin.py                   # Admin endpoints
│   ├── services/            # Business logic layer
│   │   ├── supabase_service.py        # ALL Supabase DB operations (38KB)
│   │   ├── workspace_service.py       # Workspace business logic (48KB)
│   │   ├── workspace_collaboration_service.py # Presence/activity (20KB)
│   │   ├── workspace_conversation_service.py  # Channel conversations (16KB)
│   │   ├── workspace_task_service.py          # Task business logic (18KB)
│   │   ├── workspace_decision_service.py      # Decision logic (13KB)
│   │   ├── workspace_initiative_service.py    # Initiative logic (20KB)
│   │   ├── workspace_search_service.py        # ILIKE workspace search over conversations/tasks/initiatives/decisions
│   │   ├── workspace_mention_service.py       # Structured mention validation, persistence, inbox hydration
│   │   ├── workspace_intelligence_service.py  # AI workspace profile (14KB)
│   │   ├── workspace_connector_service.py     # Source connectors (26KB)
│   │   ├── workspace_schema_health_service.py # Schema validation (12KB)
│   │   ├── workspace_permissions.py           # Permission checks (7KB)
│   │   ├── workspace_continuity_service.py    # Memory service (2KB)
│   │   ├── workspace_cognition.py             # AI cognition (9KB)
│   │   ├── chat_service.py                    # Ollama chat client (15KB)
│   │   ├── document_context_service.py        # Document RAG context (12KB)
│   │   ├── profile_service.py                 # User profile service (13KB)
│   │   ├── email_service.py                   # Resend invite emails (6KB)
│   │   ├── realtime_service.py                # Realtime helpers (1KB)
│   │   ├── web_search.py                      # Tavily web search (10KB)
│   │   ├── query_classifier.py                # Query routing (4KB)
│   │   └── llm/                               # LLM provider system
│   │       ├── manager.py                     # ProviderManager singleton
│   │       ├── config.py                      # LLMSettings (pydantic)
│   │       ├── schemas.py                     # LLM request/response types
│   │       ├── utils.py                       # LLM utilities
│   │       └── providers/
│   │           ├── base.py                    # BaseLLMProvider interface
│   │           ├── ollama.py                  # Ollama provider
│   │           ├── openai.py                  # OpenAI provider
│   │           ├── local_model.py             # Local model provider
│   │           └── placeholder.py             # Fallback placeholder provider
│   ├── core/
│   │   ├── security.py      # JWT auth middleware + get_current_user (9KB)
│   │   ├── rbac.py          # Role-based access control
│   │   └── config.py        # get_settings() factory
│   ├── db/
│   │   └── supabase_client.py # get_supabase() / get_async_supabase()
│   ├── settings/
│   │   ├── __init__.py      # Exports AppSettings (composed)
│   │   ├── base.py          # BaseAppSettings — Supabase/env config
│   │   ├── providers.py     # ProviderSettings — AI model config
│   │   ├── retrieval.py     # RAG retrieval settings
│   │   ├── observability.py # Logging/metrics settings
│   │   └── runtime.py       # Runtime mode settings
│   ├── rag/                 # RAG pipeline
│   │   ├── ingestion.py     # RAGIngestionPipeline (11KB)
│   │   ├── chunking.py      # Text chunking (7KB)
│   │   ├── embedding.py     # Embedding generation
│   │   ├── pgvector_store.py # pgvector VectorStore implementation
│   │   ├── vector_store_base.py # Abstract VectorStore
│   │   ├── keyword_retrieval.py # BM25 keyword search
│   │   ├── ingestion_service.py # Ingestion orchestration
│   │   ├── token_utils.py       # Tiktoken token counting
│   │   ├── models.py            # RAG data models
│   │   └── parsers/             # File parsers (PDF, DOCX, etc.)
│   ├── embeddings/          # Embedding dimension management
│   ├── retrieval/           # Hybrid retrieval (semantic + keyword)
│   ├── context/             # Context assembly for prompts
│   ├── actions/             # AI action extraction logic
│   ├── automation/          # Automation engine
│   ├── insights/            # AI insights generation
│   ├── integrations/        # External integrations
│   ├── observability/       # Metrics + tracing
│   ├── jobs/                # Background jobs
│   ├── runtime/             # RuntimeManager (system status)
│   ├── schemas/             # Pydantic response schemas, including workspace_search.py and workspace_mentions.py
│   └── health/              # Health check endpoint
├── migrations/              # DB migration scripts
├── tests/                   # pytest test suite
└── requirements.txt         # Python dependencies
```

---

## 5. Data Flow & Request Lifecycle

### Frontend → Backend HTTP Request

```
User Action
  → Component calls apiClient.get/post/patch/delete (lib/api.ts)
  → ApiClient reads Supabase JWT (supabase.auth.getSession())
  → ApiClient reads activeWorkspaceId from localStorage
  → Sets headers: Authorization: Bearer {jwt}, X-Omnix-Workspace: {workspaceId}
  → HTTP request to API_BASE_URL (NEXT_PUBLIC_API_BASE_URL)
  → FastAPI auth_context_middleware validates JWT (RS256/ES256 via JWKS)
  → FastAPI route handler calls service layer
  → Service layer queries Supabase via supabase_service.py
  → Response JSON returned to frontend
```

### AI Chat Streaming Request

```
User types message → ChatInterface.tsx
  → apiClient.stream('/messages/{conversation_id}', {method: POST, body: {message, model, ...}})
  → Backend: messages.py router receives request
  → Builds prompt with RAG context (document_context_service.py)
  → Optional: web search via web_search.py (if TAVILY_API_KEY set)
  → Sends to OllamaChatService.generate_stream() or LLM ProviderManager
  → Streams SSE/text chunks back as HTTP streaming response
  → Frontend reads response.body as ReadableStream
  → ChatInterface renders tokens progressively
```

### File Upload → RAG Ingestion

```
User uploads file → upload.py router
  → Parses file (PDF/DOCX/TXT via rag/parsers/)
  → Chunks text (rag/chunking.py)
  → Generates embeddings (rag/embedding.py → sentence-transformers)
  → Stores chunks in Supabase (document_chunks table)
  → Stores embeddings in pgvector (rag/pgvector_store.py)
  → File metadata saved to files table
```

### Command Palette & Workspace Search Request

```
Ctrl/Cmd+K or mobile command icon (components/layout/CommandPalette.tsx)
  → apiClient.searchWorkspace(workspaceId, q)
  → GET /workspaces/{workspace_id}/search?q=...
  → workspace_search.py router authenticates user
  → workspace_search_service.py calls require_workspace_access()
  → Supabase ILIKE queries stay scoped to workspace_id
  → Results return grouped as conversations/tasks/initiatives/decisions
```

### Workspace Mention Request

```
User types @ in conversation/task/decision text input
  → MentionTextarea filters useWorkspace().activeMembers client-side
  → Selected member inserts a visible @label and sends structured mentions: [{user_id}]
  → Backend validates targets with list_workspace_members() for the active workspace
  → Source record stores mention metadata in JSON where available
  → workspace_mention_service.sync_mentions_for_source() replaces workspace_mentions rows for that source
  → /notifications calls GET /workspaces/{workspace_id}/mentions for current user's mention notification list
  → Header bell calls GET /workspaces/{workspace_id}/mentions/unread-count for workspace-scoped unread count
  → Read actions call PATCH /workspaces/{workspace_id}/mentions/{mention_id}/read or PATCH /workspaces/{workspace_id}/mentions/read-all
```

---

## 6. Authentication & Security

### Flow
1. Frontend: Supabase PKCE auth flow (email/password or OAuth)
2. Supabase issues JWT signed RS256 or ES256
3. All API calls: `Authorization: Bearer {access_token}`
4. Backend: `auth_context_middleware` in `core/security.py` validates JWT
5. JWKS URL: `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`
6. On 401: frontend auto-calls `supabase.auth.signOut()`

### Exempt Auth Paths (no JWT required)
- `/health`, `/docs`, `/openapi.json`, `/redoc`
- `/integrations/google_drive/callback`

### Backend Auth Helpers
- `get_current_user(request)` — dependency injection for authenticated routes
- `check_workspace_access(user_id, workspace_id)` — workspace permission check
- `get_supabase_auth_client()` — auth admin client (service role)

### Frontend Auth
- Provider: `AuthProvider` in `lib/auth-context.tsx`
- Hook: `useAuth()` → `{ user, session, accessToken, loading, signOut }`
- Supabase client: `lib/supabase.ts` (singleton, nullable if env missing)
- Session persistence: Supabase handles via localStorage (PKCE flow)

---

## 7. Workspace System

### Workspace Types
```typescript
type WorkspaceType = "super_workspace" | "subworkspace" | "global_workspace"
```

- `super_workspace` — root-level workspace (created by user)
- `subworkspace` — child of a super_workspace
- `global_workspace` — shared org-wide workspace

### Workspace Roles (hierarchy: highest → lowest)
```
super_founder > founder > owner > co_owner > team_lead > sub_leader > member > sub_member
```

### Frontend Workspace State
- Provider: `WorkspaceProvider` in `lib/workspace-context.tsx`
- Hook: `useWorkspace()` — returns workspaces tree, active workspace, members, invites
- Active workspace persisted to: `localStorage['omnix.activeWorkspaceId']`
- Header sent to API: `X-Omnix-Workspace: {activeWorkspaceId}`
- Refresh throttle: 15s minimum between silent refreshes

### Key API Endpoints (Workspace)
| Action | Endpoint |
|--------|----------|
| Get hierarchy | `GET /workspaces/hierarchy` |
| Get single workspace tree | `GET /workspaces/{id}/hierarchy` |
| Get subspaces | `GET /workspaces/{id}/subspaces` |
| Create workspace | `POST /workspaces` |
| Rename workspace | `PATCH /workspaces/{id}` |
| Delete workspace | `DELETE /workspaces/{id}` |
| Get members | `GET /workspaces/{id}/members` |
| Invite member | `POST /workspaces/{id}/invites` |
| Get invites | `GET /workspaces/{id}/invites` |
| Revoke invite | `DELETE /workspaces/{id}/invites/{invite_id}` |
| Get intelligence | `GET /workspaces/{id}/intelligence` |
| Update intelligence | `PATCH /workspaces/{id}/intelligence` |
| Search workspace knowledge | `GET /workspaces/{id}/search?q=...` |
| Mention notifications | `GET /workspaces/{id}/mentions`, `GET /workspaces/{id}/mentions/unread-count`, `PATCH /workspaces/{id}/mentions/{mention_id}/read`, `PATCH /workspaces/{id}/mentions/read-all` |

### Workspace Search MVP
- Backend router: `backend/app/routers/workspace_search.py`
- Backend service: `backend/app/services/workspace_search_service.py`
- Response schema: `backend/app/schemas/workspace_search.py`
- Frontend UI: `frontend/components/layout/CommandPalette.tsx` for active header use; `WorkspaceSearch.tsx` remains the standalone search surface
- Mobile UX: `WorkspaceSearch.tsx` uses a bottom-sheet search surface, grouped result counts, and guided empty/no-result states
- API helper/types: `frontend/lib/api.ts` (`apiClient.searchWorkspace`) and `frontend/lib/workspace-types.ts`
- Scope: active workspace only; no global/cross-workspace search
- Sources: workspace channels/messages, tasks, initiatives, decisions
- Excluded by design: files, connectors, semantic/vector search, embeddings, AI search, RAG
- Query method: bounded Supabase `ILIKE` field searches after `require_workspace_access`
- Conversation privacy: private channel messages are searched only after visible channel filtering
- Result navigation: `/tasks?id=...`, `/decisions?id=...`, `/initiatives?id=...`, `/conversations?channel=...`

### Command Palette MVP
- Component: `frontend/components/layout/CommandPalette.tsx`
- Activation: desktop `Ctrl+K` / `Cmd+K`; mobile command icon in the authenticated header
- Sections: quick actions, grouped workspace search, recent destinations
- Mobile UX: bottom-sheet command surface with larger touch targets, focused search affordance, and denser scan-friendly result rows
- Quick create actions route to existing flows with `?create=task`, `?create=decision`, or `?create=initiative`
- Existing create surfaces read those query params in task, decision, and initiative pages; no new entity creation logic exists in the palette
- Recent destinations are stored locally per active workspace under `omnix.commandPalette.recent.{workspaceId}`
- Keyboard support: arrow up/down, Enter, Escape, and Tab cycling inside the palette

### Workspace Mentions MVP
- Backend router: `backend/app/routers/workspace_mentions.py`
- Backend service: `backend/app/services/workspace_mention_service.py`
- Pydantic schema: `backend/app/schemas/workspace_mentions.py`
- Migration: `backend/migrations/0037_workspace_mentions.sql`
- Table: `workspace_mentions(id, workspace_id, mentioned_user_id, mentioned_by_user_id, source_type, source_id, created_at, read_at)`
- Supported source types: `conversation_message`, `task`, `decision`
- Frontend picker/rendering: `frontend/components/mentions/MentionTextarea.tsx` and `MentionText.tsx`
- Frontend notification center: `frontend/app/(dashboard)/notifications/page.tsx` via `NotificationCenterSurface.tsx`
- Backwards-compatible mentions route/component: `frontend/app/(dashboard)/mentions/page.tsx` and `components/mentions/MentionsInboxSurface.tsx` render `NotificationCenterSurface.tsx`
- Header unread bell: `frontend/components/notifications/NotificationBell.tsx`
- Notification settings surface: `frontend/app/(dashboard)/settings/notifications/page.tsx` documents in-app mentions and workspace invitations only
- Notification state/context: `frontend/lib/workspace-notifications-context.tsx`
- Mobile UX: notification rows expose unread state, source context, and direct source navigation with touch-sized actions
- Read state: unread when `read_at IS NULL`; read when `read_at IS NOT NULL`
- Read actions: individual `PATCH /workspaces/{id}/mentions/{mention_id}/read`; bulk `PATCH /workspaces/{id}/mentions/read-all`
- Unread count: `GET /workspaces/{id}/mentions/unread-count`
- Scope: active workspace only; mention targets must be visible workspace members
- Conversation privacy: inbox hydration only exposes private channel details to users who can read that channel
- Realtime: `workspace_mentions` table changes refresh the active workspace notification context through `realtimeRegistry`
- Excluded by design: email, push, SMS, Slack/Discord, activity-feed notifications, workflow automation, AI notifications/mentions, cross-workspace notifications

### Onboarding Gate
- Component: `WorkspaceOnboardingGate.tsx`
- Guards all dashboard pages
- If user has no workspace → shows creation wizard
- **Critical:** Do not break this gate — it is the entry point for all new users

---

## 8. AI & LLM System

### LLM Provider Architecture

```
ProviderManager (backend/app/services/llm/manager.py)
├── Providers registered:
│   ├── "ollama"       → OllamaProvider (default)
│   ├── "openai"       → OpenAIProvider (if OPENAI_API_KEY set)
│   ├── "local"        → LocalModelProvider (if LOCAL_MODEL_PATH set)
│   └── "placeholder"  → PlaceholderProvider (always registered, fallback)
└── Default: env DEFAULT_PROVIDER (default: "placeholder" in llm/config.py)
    Fallback: env FALLBACK_PROVIDER (default: "placeholder")
```

### Primary Chat Service
- `OllamaChatService` in `backend/app/services/chat_service.py`
- Uses native Ollama `/api/chat` endpoint
- Default model: `phi3:mini`
- Streaming: yes (async generator)
- Config: `AI_REQUEST_TIMEOUT_SECONDS`, `AI_STREAM_TIMEOUT_SECONDS`, `AI_MAX_RETRIES`

### AI System Prompt
Defined in `settings/providers.py` → `AI_SYSTEM_PROMPT`:
> "You are Omnix, a precise AI workspace assistant. Answer clearly using the provided uploaded document, workspace, and live web context when available..."

### Context Building (per chat message)
1. RAG retrieval: hybrid (semantic + keyword) from pgvector
2. Document context: `document_context_service.py`
3. Workspace cognition: `workspace_cognition.py`
4. Optional web search: `web_search.py` (Tavily, if enabled)
5. Assembled into prompt with token budget constraints

### Web Search
- Provider: Tavily (`TAVILY_API_KEY`)
- Toggle: `WEB_SEARCH_ENABLED` env var (default: false)
- Max results: `WEB_SEARCH_MAX_RESULTS` (default: 5)

---

## 9. RAG Pipeline

### Flow
```
Document Upload
  → File parsed (rag/parsers/ — PDF, DOCX, TXT, etc.)
  → Text chunked (rag/chunking.py — overlap-aware splitter)
  → Embeddings generated (rag/embedding.py → sentence-transformers)
  → Chunks + embeddings stored in Supabase
     - document_chunks table (text + metadata)
     - pgvector column on chunks (embeddings)
  → On query: PgVectorStore.search() calls `search_documents_vector` RPC
```

### Key RAG Settings
| Setting | Default | Purpose |
|---------|---------|---------|
| `HYBRID_TOP_K` | 3 | Semantic search results |
| `HYBRID_POOL_SIZE` | 6 | Candidate pool size |
| `HYBRID_CONTEXT_TOKEN_BUDGET` | 2200 | Max tokens in context |
| `HYBRID_MAX_CHUNK_TOKENS` | 520 | Max tokens per chunk |

### Embedding Model
- Library: `sentence-transformers`
- Stored in pgvector column on `document_chunks` table
- Supabase RPC: `search_documents_vector(q, p_top_k, p_user, p_workspace_ids)`

### RAG Files
| File | Purpose |
|------|---------|
| `rag/ingestion.py` | `RAGIngestionPipeline` — main pipeline class |
| `rag/chunking.py` | Text chunking with overlap |
| `rag/embedding.py` | Async embedding generation |
| `rag/pgvector_store.py` | `PgVectorStore` — vector DB adapter |
| `rag/keyword_retrieval.py` | BM25/keyword search |
| `rag/token_utils.py` | Tiktoken-based token counting |
| `retrieval/` | Hybrid retrieval orchestration |

---

## 10. Realtime & Collaboration

### Supabase Realtime Channels

Frontend channel management: `lib/realtime-registry.ts` → `RealtimeSubscriptionRegistry`

| Channel Type | Key Pattern | Purpose |
|-------------|-------------|---------|
| `presence` | `presence:{workspaceId}:none` | Online member tracking |
| `activity` | `activity:{workspaceId}:none` | Workspace activity events |
| `status` | `status:{workspaceId}:none` | Workspace live status |
| `typing` | `typing:{workspaceId}:{conversationId}` | Typing indicators |
| `revocation` | `revocation:{workspaceId}:none` | Access revocation events |
| `channels` | `channels:{workspaceId}:none` | Channel list updates |
| `channel_messages` | `channel_messages:{workspaceId}:{conversationId}` | Live messages |
| `tasks` | `tasks:{workspaceId}:none` | Task updates |
| `initiatives` | `initiatives:{workspaceId}:none` | Initiative updates |
| `workspace_mentions` | `workspace_mentions:{workspaceId}:none` | Mention notification list/unread count refresh |

### Collaboration Context
- Provider: `WorkspaceCollaborationProvider` in `lib/workspace-collaboration-context.tsx`
- Hook: `useCollaboration()`
- Features: presence snapshot, activity feed, typing signals, workspace live status
- Heartbeat: every 60s
- Status poll: every 90s
- Typing throttle: 3s, timeout: 8s
- Automatic reconnect: exponential backoff, max 15s delay

### Notification Context
- Provider: `WorkspaceNotificationsProvider` in `lib/workspace-notifications-context.tsx`
- Hook: `useWorkspaceNotifications()`
- Features: current workspace mention notifications, unread count, individual mark-read, mark-all-read
- Error handling: classifies unreachable API, missing deployed endpoints, auth failures, and missing `workspace_mentions` storage for actionable UI messages
- Realtime: subscribes through `realtimeRegistry` to `workspace_mentions` changes for the active workspace
- Scope: in-app mentions only; no email, push, SMS, Slack/Discord, AI notifications, or workflow automation

### Backend Realtime Service
- `backend/app/services/realtime_service.py`
- `backend/app/services/workspace_collaboration_service.py`

---

## 11. Database & Supabase

### Database Access Pattern
- All DB operations go through: `backend/app/services/supabase_service.py`
- Supabase client factory: `backend/app/db/supabase_client.py`
  - `get_supabase()` — sync client (service role)
  - `get_async_supabase()` — async client (service role)

### Key Supabase Tables (inferred from code)
| Table | Purpose |
|-------|---------|
| `workspaces` | Workspace records (super + sub) |
| `workspace_members` | User↔workspace membership |
| `workspace_invites` | Email invitations |
| `workspace_channels` | Team conversation channels |
| `workspace_channel_messages` | Channel messages |
| `workspace_mentions` | Structured @mention records for conversations, tasks, and decisions |
| `workspace_tasks` | Tasks |
| `workspace_decisions` | Decisions |
| `workspace_initiatives` | Initiatives/projects |
| `workspace_continuity_memories` | AI workspace memory |
| `conversations` | Personal AI conversations |
| `messages` | AI conversation messages |
| `files` | Uploaded file metadata |
| `document_chunks` | RAG text chunks + pgvector embeddings |
| `profiles` | User profile data |
| `workspace_actions` | AI-extracted actions |
| `workspace_automations` | Automation rules |
| `workspace_artifacts` | AI-generated artifacts |
| `workspace_insights` | AI insights |

### Supabase RPCs
| RPC | Purpose |
|-----|---------|
| `search_documents_vector` | Semantic vector search (pgvector) |

### Retry Logic
`supabase_service.py` implements:
- Sync retry: `_execute_with_retry()` — 3 attempts, exponential backoff from 0.5s
- Async retry: `_execute_with_retry_async()`
- Infrastructure pressure detection: `check_infrastructure_pressure()` — 60s cooldown

---

## 12. Environment Variables

### Frontend (`frontend/.env`)
```bash
NEXT_PUBLIC_API_BASE_URL=http://18.204.231.209   # Backend API URL
NEXT_PUBLIC_SUPABASE_URL=https://...              # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...             # Supabase anon key
```

### Backend (`backend/.env`)
```bash
# Supabase
SUPABASE_URL=NEXT_PUBLIC_SUPABASE_URL_REDACTED
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWKS_URL=https://.../.well-known/jwks.json  # Optional, auto-derived

# AI Model
MODEL_URL=http://localhost:11434/api/chat
AI_MODEL=phi3:mini
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_DEFAULT_MODEL=phi3:mini
AI_REQUEST_TIMEOUT_SECONDS=60
AI_STREAM_TIMEOUT_SECONDS=120
AI_MAX_RETRIES=2
AI_MAX_OUTPUT_TOKENS=384
AI_MAX_CONTEXT_MESSAGES=4

# RAG / Retrieval
HYBRID_TOP_K=3
HYBRID_POOL_SIZE=6
HYBRID_CONTEXT_TOKEN_BUDGET=2200
HYBRID_MAX_CHUNK_TOKENS=520

# Web Search (optional)
WEB_SEARCH_ENABLED=false
TAVILY_API_KEY=
WEB_SEARCH_MAX_RESULTS=5

# OpenAI (optional)
OPENAI_API_KEY=

# Email (invites)
RESEND_API_KEY=
RESEND_FROM_EMAIL=Omnix <invites@omnix.app>
OMNIX_APP_URL=http://localhost:3000

# Dev
DEV_MODE=true
```

### Env File Load Order (Backend)
Backend loads from: `repo_root/.env` → `backend/.env` → `backend/.env.local`

---

## 13. API Endpoint Reference

### Base URL
`http://18.204.231.209` (production) | `http://localhost:8000` (local dev)

### Auth Header
`Authorization: Bearer {supabase_access_token}`

### Workspace Header
`X-Omnix-Workspace: {workspace_id}` (auto-set by `ApiClient`)

### Endpoints by Router

**Health**
- `GET /health`

**Conversations (personal AI chat)**
- `GET /conversations` — list user's conversations
- `POST /conversations` — create new conversation
- `DELETE /conversations/{id}`

**Messages (AI streaming)**
- `POST /messages/{conversation_id}` — send message, stream response
- `GET /messages/{conversation_id}` — get message history

**Workspaces**
- `GET /workspaces/hierarchy` — full workspace tree
- `GET /workspaces/{id}/hierarchy` — single workspace tree
- `GET /workspaces/{id}/subspaces`
- `POST /workspaces` — create
- `PATCH /workspaces/{id}` — update
- `DELETE /workspaces/{id}`
- `GET /workspaces/{id}/members`
- `POST /workspaces/{id}/invites`
- `GET /workspaces/{id}/invites`
- `DELETE /workspaces/{id}/invites/{invite_id}`
- `GET /workspaces/{id}/intelligence`
- `PATCH /workspaces/{id}/intelligence`
- `GET /workspaces/{id}/presence`
- `POST /workspaces/{id}/heartbeat`
- `GET /workspaces/{id}/activity`
- `GET /workspaces/{id}/live-status`

**Workspace Invites (pending)**
- `GET /workspace-invites` — pending invites for current user
- `POST /workspace-invites/{id}/accept`
- `POST /workspace-invites/{id}/decline`

**Workspace Conversations (channels)**
- `GET /workspaces/{id}/channels`
- `POST /workspaces/{id}/channels`
- `GET /workspaces/{id}/channels/{channel_id}/messages`
- `POST /workspaces/{id}/channels/{channel_id}/messages`
- `POST /workspaces/{id}/channels/{channel_id}/assist`

**Workspace Search**
- `GET /workspaces/{id}/search?q=...` — grouped workspace keyword results for conversations, tasks, initiatives, and decisions

**Workspace Mentions**
- `GET /workspaces/{id}/mentions` — current user's workspace-scoped mention notifications
- `GET /workspaces/{id}/mentions/unread-count` — current user's workspace-scoped unread mention count
- `PATCH /workspaces/{id}/mentions/{mention_id}/read` — mark one mention notification read
- `PATCH /workspaces/{id}/mentions/read-all` — mark all current user's workspace mention notifications read

**Workspace Tasks**
- `GET /workspaces/{id}/tasks`
- `POST /workspaces/{id}/tasks`
- `PATCH /workspaces/{id}/tasks/{task_id}`

**Workspace Decisions**
- `GET /workspaces/{id}/decisions`
- `POST /workspaces/{id}/decisions`
- `GET /workspaces/{id}/decisions/{decision_id}`
- `PATCH /workspaces/{id}/decisions/{decision_id}/status`

**Files & Upload**
- `GET /files` — user's files
- `POST /upload` — upload file (multipart)
- `DELETE /files/{id}`

**Actions, Artifacts, Insights, Automations**
- Standard CRUD under `/workspaces/{id}/actions`, `/artifacts`, `/insights`, `/automations`

**Profile**
- `GET /profile`
- `PATCH /profile`

**Continuity**
- `GET /workspaces/{id}/continuity`

---

## 14. Frontend Context Providers

Provider tree order (root → leaf):
```
AuthProvider (lib/auth-context.tsx)
  → WorkspaceProvider (lib/workspace-context.tsx)
    → WorkspaceCollaborationProvider (lib/workspace-collaboration-context.tsx)
      → WorkspaceNotificationsProvider (lib/workspace-notifications-context.tsx)
        → WorkspaceContinuityProvider (lib/workspace-continuity-context.tsx)
          → ProfileProvider (lib/profile-context.tsx)
            → ConversationHistoryProvider (lib/conversation-history-context.tsx)
              → [App UI]
```

### Hooks Reference
| Hook | Import from | Returns |
|------|-------------|---------|
| `useAuth()` | `lib/auth-context` | `{ user, session, accessToken, loading, signOut }` |
| `useWorkspace()` | `lib/workspace-context` | Full workspace state + actions |
| `useCollaboration()` | `lib/workspace-collaboration-context` | Presence, activity, typing |
| `useWorkspaceNotifications()` | `lib/workspace-notifications-context` | Mention notifications, unread count, read actions |
| `useProfile()` | `lib/profile-context` | User profile data |
| `useConversationHistory()` | `lib/conversation-history-context` | Chat conversation list |

---

## 15. Key Types & Models

All frontend types are in `lib/workspace-types.ts`. Key ones:

```typescript
// Core workspace
Workspace { id, name, workspace_type, workspace_focus, parent_workspace_id, subspaces[], ... }
WorkspaceRole = "founder" | "owner" | "co_owner" | "member" | "sub_leader" | "team_lead" | "sub_member"
WorkspaceType = "super_workspace" | "subworkspace" | "global_workspace"
WorkspaceFocus = "general" | "engineering" | "design" | "research" | "strategy"

// Members & Invites
WorkspaceMember { workspace_id, user_id, role, email, full_name, avatar_url, ... }
WorkspaceInvite { invite_id, workspace_id, email, role, status, ... }
WorkspaceInviteStatus = "pending" | "accepted" | "declined" | "revoked"

// Collaboration
WorkspacePresenceMember { user_id, status, is_online, is_typing, ... }
WorkspacePresenceSnapshot { workspace_id, online_count, online_members[], ... }
WorkspaceLiveStatus { workspace_id, online_count, ai_status, health, ... }
TypingSignal { userId, conversationId, isTyping, sentAt }

// Operational
WorkspaceTask { id, title, status, owner_user_id, due_date, blockers[], ... }
WorkspaceDecision { id, title, status, decision_reason, ... }
WorkspaceInitiative { id, title, status, linked_tasks[], momentum, ... }
WorkspaceChannel { id, name, channel_type, message_count, ... }
WorkspaceChannelMessage { id, content, author_user_id, context_links[], ... }
WorkspaceSearchResponse { conversations[], tasks[], initiatives[], decisions[] }
WorkspaceSearchResult { id, workspace_id, type, title, preview, context, url, ... }
WorkspaceMentionMetadata { user_id, label, display_name, avatar_label, operational_label, ... }
WorkspaceMentionInboxItem { id, source_type, source_id, source_title, source_preview, source_url, ... }
WorkspaceMentionUnreadCount { unread_count }
WorkspaceMentionMarkReadResponse { mention_id, read_at }
WorkspaceMentionMarkAllReadResponse { updated_count, read_at }

// Task/Decision status enums
WorkspaceTaskStatus = "idea" | "planned" | "active" | "review" | "complete"
WorkspaceDecisionStatus = "proposed" | "accepted" | "rejected" | "superseded"
WorkspaceInitiativeStatus = "draft" | "active" | "focused" | "at_risk" | "complete"
```

Backend Pydantic models are in `backend/app/schemas/`.

---

## 16. Critical Path Files

Files that, if broken, will take down core functionality:

| File | Breaks If Broken |
|------|-----------------|
| `frontend/lib/workspace-context.tsx` | All workspace state — nothing works |
| `frontend/lib/auth-context.tsx` | Authentication — app is locked out |
| `frontend/lib/api.ts` | All HTTP communication |
| `frontend/lib/realtime-registry.ts` | All realtime/presence features |
| `frontend/components/workspace/WorkspaceOnboardingGate.tsx` | New user onboarding |
| `frontend/components/chat/ChatInterface.tsx` | Main AI chat |
| `backend/app/bootstrap/app.py` | App cannot start |
| `backend/app/core/security.py` | All auth middleware — everyone gets 401 |
| `backend/app/routers/messages.py` | AI streaming — chat broken |
| `backend/app/routers/workspaces.py` | Workspace API — all workspace ops fail |
| `backend/app/services/supabase_service.py` | All DB operations |
| `backend/app/db/supabase_client.py` | No DB connection possible |

---

## 17. Dev & Infra

### Local Dev Commands
```bash
# Frontend
cd frontend && npm run dev              # Next.js on port 3000

# Backend
cd backend && uvicorn app.main:app --reload --port 8000

# Full stack
docker-compose up                       # Uses docker-compose.yml
```

### Production
- Backend: EC2 instance at `18.204.231.209`
- Frontend: Vercel (configured in `frontend/vercel.json`)
- Reverse proxy: nginx (`nginx.conf`)
- Backend Dockerfile: `backend/Dockerfile.backend`

### Key Dev Notes
- Backend loads `.env` from both repo root AND `backend/` directory
- `DEV_MODE=true` enables relaxed settings (e.g., CORS `*`)
- Redis is required for production — initialized in `bootstrap/redis.py`
- pgvector extension must be enabled in Supabase project
- Supabase project ID: `qsaaipuaxcreiljnwcgs`

### Running Tests
```bash
cd backend && pytest                    # All backend tests
pytest tests/                          # Specific test directory
```

---

*Last updated: 2026-06-03. Update this file when adding new routers, services, major components, or env variables.*

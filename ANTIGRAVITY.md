# Antigravity — Coding Behavior Guidelines for Omnix

> Behavioral guidelines for Antigravity (AI coding assistant) working in the Omnix codebase.
> These rules reduce hallucination, prevent token waste, and enforce surgical discipline.

---

## 1. Think Before Coding

Do not assume. Do not hide confusion. Surface tradeoffs.

Before implementing:

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them; do not pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what is confusing. Ask.
- Always consult `OMNIX_CODEBASE_MAP.md` before searching the codebase.

---

## 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that was not requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

---

## 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:

- Do not improve adjacent code, comments, or formatting.
- Do not refactor things that are not broken.
- Match existing style, even if you would do it differently.
- If you notice unrelated dead code, mention it; do not delete it.

When your changes create orphans:

- Remove imports, variables, and functions that your changes made unused.
- Do not remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

---

## 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]

Strong success criteria let you loop independently. Weak criteria, such as "make it work", require constant clarification.

---

## 5. Omnix-Specific Rules

Rules specific to the Omnix AI-native collaborative OS:

### Architecture Preservation
- **Never** break the onboarding gate (`WorkspaceOnboardingGate.tsx`).
- **Never** break stream recovery in the messages router or chat components.
- **Always** preserve workspace switching and `activeWorkspaceId` session persistence.
- **Always** preserve auth session persistence through Supabase.

### Design Mandates
- **No admin-panel UI** — Omnix is not an admin dashboard.
- **Preserve cinematic premium design** — Framer Motion, dark glassmorphism, premium typography.
- **Never fake collaboration states** — All presence, typing, and activity signals must be real.
- **Use truthful analytics only** — No hardcoded or mock data.

### Critical Systems — Touch with Care
| System | Location |
|--------|----------|
| Workspace hierarchy | `frontend/lib/workspace-context.tsx` |
| Backend workspace API | `backend/app/routers/workspaces.py` |
| AI message streaming | `backend/app/routers/messages.py` |
| RAG pipeline | `backend/app/rag/` |
| Supabase Realtime | `frontend/lib/realtime-registry.ts` |
| Auth middleware | `backend/app/core/security.py` |
| Collaboration context | `frontend/lib/workspace-collaboration-context.tsx` |

### Token Efficiency
- Before searching the codebase, read `OMNIX_CODEBASE_MAP.md`.
- File locations for all major features are documented there.
- Do not grep for things the map already documents.

---

## 6. Frontend Rules

- Framework: **Next.js 15 App Router**, React 19, TypeScript strict mode.
- Styling: **Tailwind CSS v3** + custom global styles in `frontend/styles/`.
- Animations: **Framer Motion** only — do not add CSS-only animations unless very simple.
- Icons: **Lucide React** — do not introduce other icon libraries.
- API calls: Always use `apiClient` from `frontend/lib/api.ts` — never raw `fetch`.
- Context: Use existing contexts (`useWorkspace`, `useAuth`, `useCollaboration`) before creating new ones.
- Storage key for active workspace: `omnix.activeWorkspaceId` (localStorage).
- API base URL env: `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://18.204.231.209`).
- Supabase env keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## 7. Backend Rules

- Framework: **FastAPI** + **uvicorn**, Python async-first.
- Database: **Supabase (PostgreSQL + pgvector)** — all DB access through `supabase_service.py`.
- Auth: JWT (RS256/ES256) verified via Supabase JWKS — all routes require `get_current_user`.
- AI: Primarily **Ollama** (`phi3:mini` default), with OpenAI fallback. LLM routing in `ProviderManager`.
- RAG: `sentence-transformers` embeddings → pgvector via `search_documents_vector` RPC.
- Never bypass `auth_context_middleware` — it sets the user context for all requests.
- Redis is used for caching — initialized in bootstrap, accessed via `bootstrap/redis.py`.

---

## 8. Common Mistakes to Avoid

- Do not add `console.log` in production paths — use existing debug logging patterns.
- Do not call `/workspaces/hierarchy` more than needed — it's rate-limited by `WORKSPACE_SILENT_REFRESH_MIN_MS = 15s`.
- Do not assume workspace type — always use `normalizeWorkspaceType()` from workspace-context.
- Do not skip the `X-Omnix-Workspace` header — the API client sets it automatically from localStorage.
- Do not create new Supabase clients — use `get_supabase()` / `get_async_supabase()` from `db/supabase_client.py`.
- Do not mutate workspace state directly — always use the context setters.

---

These guidelines are working if there are fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

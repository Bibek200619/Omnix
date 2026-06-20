# Omnix Release Readiness Report

Date: 2026-06-21

## Status

P1 release blockers from the platform and frontend audits are resolved and covered by tests. Omnix is materially closer to release readiness, with security, upload reliability, command palette accessibility, frontend E2E/axe coverage, search breadth, provenance, AI evals, sensitive logging, and module boundaries all improved.

Not every P2 maturity item is fully complete. The largest remaining risks are `workspace_service.py`, the landing experience component, incomplete server-state modernization, and large-list pagination/virtualization beyond the tested critical flows.

## Fixed

- Locked down `/admin/runtime/*` behind elevated runtime admin authorization.
- Made backend dependencies reproducible for clean test collection and execution.
- Hardened connector URL fetch against SSRF, redirect bypasses, private DNS targets, and oversized downloads.
- Moved upload extraction/chunking/embedding out of the request path into durable queued ingestion jobs.
- Exposed file processing status through backend APIs and frontend file/upload UI.
- Refactored command palette keyboard accessibility: labelled input, tabbable results, Escape/Enter/Arrow navigation.
- Added Playwright + axe coverage for public auth pages, authenticated shell, command palette, workspace switch, task creation, file upload shell, and mobile navigation.
- Replaced global frontend 401 signout with scoped refresh/retry and typed session error handling.
- Expanded workspace search across conversations, tasks, initiatives, decisions, files, document chunks, connectors/sources, members, mentions, notifications, and workspace metadata with result groups and limits.
- Added provenance panels for tasks, decisions, and initiatives.
- Split workspace invite routing out of the large workspaces router.
- Split message payload/retrieval helpers out of the large messages router.
- Split Supabase query helper logic out of the large Supabase service.
- Split workspace provider responsibilities into separate active-workspace storage, destructive-confirmation, context-value, and effect modules.
- Split files page model helpers, shared portal, and connector setup modal out of the large files page.
- Added deterministic AI eval coverage for retrieval relevance, citations, workspace isolation, prompt injection resistance, document context, and decision extraction.
- Redacted prompt/source/user-query previews and provider error bodies in production logs.
- Removed duplicate/malformed generated CSS token block, added touch-target standards, and expanded reduced-motion handling.
- Stabilized observability tests under explicit development logging and removed local observability deprecation warnings.

## Key Files Changed

- Backend auth/security: `backend/app/core/admin_auth.py`, `backend/app/routers/admin.py`, `backend/app/services/workspace_connector_service.py`
- Backend upload/jobs: `backend/app/routers/upload.py`, `backend/app/jobs/ingestion_jobs.py`, `backend/app/routers/files.py`, `supabase/migrations/0042_file_processing_status.sql`
- Backend search/provenance/AI/logging/architecture: `backend/app/services/workspace_search_service.py`, `backend/app/schemas/workspace_search.py`, `backend/app/observability/safe_logging.py`, `backend/app/observability/prompt_trace.py`, `backend/app/observability/retrieval_trace.py`, `backend/app/routers/workspace_invites.py`, `backend/app/services/message_payload_service.py`, `backend/app/services/message_retrieval_service.py`, `backend/app/services/supabase_query_helpers.py`
- Frontend UX/accessibility/architecture: `frontend/components/layout/CommandPalette.tsx`, `frontend/lib/api.ts`, `frontend/components/provenance/RecordTraceabilityPanel.tsx`, `frontend/components/files/filesPageModel.ts`, `frontend/components/files/ConnectorSetupModal.tsx`, `frontend/components/files/DocumentPortal.tsx`, `frontend/lib/workspace-context-values.ts`, `frontend/lib/workspace-provider-effects.ts`
- Frontend design/mobile: `frontend/styles/globals.css`, `frontend/components/upload/UploadDropzone.tsx`, `frontend/components/layout/PageTransition.tsx`, `frontend/components/ui/Button.tsx`, `frontend/components/ui/Toggle.tsx`
- Tests: `backend/tests/routers/test_admin_runtime.py`, `backend/tests/services/test_workspace_connector_service.py`, `backend/tests/jobs/test_ingestion_file_processing.py`, `backend/tests/routers/test_upload_async_processing.py`, `backend/tests/frontend/*`, `backend/tests/routers/test_messages_modularity.py`, `backend/tests/services/test_supabase_query_helpers.py`, `backend/tests/retrieval/test_ai_eval_harness.py`, `backend/tests/observability/test_safe_logging.py`, `frontend/e2e/omnix-release.spec.ts`

## Verification Evidence

Backend:

- Clean dependency install from `backend/requirements.txt` into `/private/tmp/omnix_backend_req_target`: passed.
- `python -m pytest --collect-only backend/tests -q`: collected successfully after dependency fix.
- `python -m pytest backend/tests -q`: `285 passed`, with 17 remaining FastAPI/Starlette deprecation warnings.
- Admin runtime authorization tests: passed.
- Connector SSRF/streaming tests: passed.
- Upload/job tests: passed.
- Search access/coverage tests: passed.
- AI eval harness: passed.
- Observability safe logging tests: passed.

Supabase:

- `npx supabase db push`: applied `0042_file_processing_status.sql` successfully. The CLI reported only a Docker catalog-cache warning.

Frontend:

- `npm --prefix frontend run typecheck`: passed.
- `npm --prefix frontend run lint`: passed.
- `npm --prefix frontend run test:e2e`: `25 passed`, `1 skipped` desktop skip for the mobile-only scenario.
- `npm --prefix frontend run build`: passed when run alone. A first run executed in parallel with Playwright's dev server failed during `.next` page-data collection with `PageNotFoundError: /_document`; rerunning after E2E completed passed.
- `npm --prefix frontend audit --audit-level=high --omit=dev`: `0 vulnerabilities`.
- Axe coverage in Playwright: no critical or serious violations on dashboard, files, tasks, decisions, notifications, and command palette across desktop/mobile projects.

Security:

- Runtime admin route tests cover unauthenticated, normal authenticated, claim-admin, founder/owner, and member-denied paths.
- SSRF tests cover localhost, private IP, DNS-to-private, redirect-to-private, oversized response, and valid public URL paths.
- Upload tests cover metadata creation and enqueue behavior.
- Tracked-file secret scan found only placeholders, env indirections, and test fixture values for `SUPABASE_SERVICE_ROLE_KEY`/`OPENAI_API_KEY`; no real tracked secret was identified.

Performance/Scale:

- Upload request path no longer performs extraction/chunking/OCR/embedding before response.
- Workspace search has bounded result groups and result limits.
- Large router/service/component risk is reduced: `workspaces.py` 1,505 -> 990 lines, `messages.py` 1,433 -> 938 lines, `supabase_service.py` 1,042 -> 964 lines, `workspace-provider.tsx` 1,093 -> 992 lines, `files/page.tsx` 1,476 -> 838 lines.
- Frontend E2E verifies key workflows under desktop and mobile viewports.
- Remaining scale gap: large data surfaces still need fuller pagination/virtualization pass.

## Commits

- `f22c29d` Lock down runtime admin endpoints
- `15f2c68` Harden connector URL fetching
- `c7b2790` Move file ingestion to background processing
- `1c7c695` Fix command palette keyboard accessibility
- `a1c06b7` Add frontend E2E accessibility coverage
- `2ca80d3` Scope frontend auth recovery on 401
- `7f9a2fd` Expand workspace search coverage
- `f36f487` Add record traceability panels
- `c5b1865` Split workspace provider responsibilities
- `59af9e0` Add AI retrieval eval harness
- `d006ea8` Redact sensitive AI logging
- `0b33390` Harden design tokens and motion accessibility
- `403a241` Stabilize observability logging tests
- `6114469` Document release readiness evidence
- `c228f28` Extract workspace invite router
- `056aa54` Extract files page model helpers
- `231b39a` Extract message retrieval services
- `5877268` Extract Supabase query helpers
- `0cdbd99` Extract workspace provider hooks
- `811175b` Extract files connector setup modal

## Scorecard

| Area | Expected Score | Evidence |
| --- | ---: | --- |
| Architecture | 8/10 | P1 boundaries and major module splits landed; `workspace_service.py` and landing experience remain oversized but routers/provider/files/Supabase are below threshold. |
| AI Systems | 8.5/10 | Retrieval eval harness, prompt-injection test, citation/source tests, document context handling, production-safe logging. |
| Reliability | 8.5/10 | Async upload lifecycle, durable statuses, full backend tests passing, frontend E2E passing. |
| Security | 8.5/10 | Admin auth lock, SSRF hardening, upload validation/enqueue tests, secret scan review, sensitive log redaction. |
| UX | 8/10 | Command palette a11y, provenance panels, upload status, search result type labels, E2E workflows. |
| Mobile | 8/10 | Mobile Playwright workflows, mobile nav, command palette checks, 44px coarse-pointer touch targets. |
| Scalability | 7.5/10 | Upload off request path and search limits landed; list pagination/virtualization remains incomplete. |
| Product Maturity | 8/10 | Search covers core memory objects; provenance panels connect tasks/decisions/initiatives to evidence. |
| Frontend Architecture | 8/10 | Workspace provider and files page are split with guardrail tests; landing experience remains large. |
| Performance | 8/10 | Build passes; upload latency risk reduced; remaining list-size bottlenecks documented. |
| Accessibility | 8.5/10 | Command palette keyboard fixes, axe coverage, reduced motion, touch targets. |
| Visual Consistency | 8/10 | Duplicate/malformed generated tokens removed; shared motion/touch primitives improved. |
| UX Friction | 8/10 | Scoped auth recovery avoids destructive global signout; upload/search/palette flows improved. |
| Mobile Responsiveness | 8/10 | Mobile route workflow coverage and coarse-pointer targets. |
| State Management | 7.5/10 | Scoped 401 recovery and workspace active/context/effect extraction landed; full server-state/query model remains pending. |
| Design System Maturity | 8/10 | Token cleanup, reduced-motion standards, Button/Toggle primitive improvements, static regression tests. |

## Remaining Risks

- Backend modules still above 1,000 lines: `backend/app/services/workspace_service.py`.
- Frontend modules still above 1,000 lines: `frontend/components/landing/LandingExperience.tsx`.
- Server-state handling is improved but not yet migrated to a full query/cache invalidation model.
- Large-list pagination/virtualization needs a dedicated pass across files, tasks, initiatives, decisions, team, notifications, mentions, and search.
- Full backend test run still reports FastAPI/Starlette deprecation warnings around `on_event`/TestClient.

## Release Recommendation

Proceed to a release-candidate hardening cycle only after deciding whether the remaining P2 architecture/scale items are launch-blocking for the first real-user cohort. The P1 security and reliability gates are covered by passing tests.

# Omnix Audit Remediation Plan

## Scope and safeguards

- Preserve pre-existing worktree changes and do not modify audit source documents.
- Work one finding at a time: trace the complete path, make the smallest root-cause fix, add focused coverage, run narrow checks, review the diff, then commit locally.
- Remediate all P1 findings before P2/P3 findings. Do not push.
- Delete this temporary file only after all audit remediation, Top 10 feature work, and final verification are complete.

## Phase 1 — Baseline and worktree safety (complete)

- [x] Record worktree status, branch, recent commits, and tracked status of audit documents.
  - Branch: `phase4-final-product` at `f6507552`; audit documents are untracked user files.
  - Pre-existing changes include `.idea/`, repository instruction files, multiple backend routers/services/tests, deletion of `RELEASE_READINESS_REPORT.md`, and untracked `src/`. They must remain outside remediation commits.
- [x] Identify backend/frontend test, lint, typecheck, build, E2E, and migration commands.
    - Backend: `backend/venv/bin/pytest` (or `pytest`), `backend/venv/bin/ruff check .`.
  - Frontend: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:e2e` from `frontend/`.
  - Migration command, if a migration becomes necessary: `npx supabase db push`.
- [x] Record baseline finding state without changing unrelated code.
  - The production worker-topology P1 remains reproducible: `scripts/start_workers.sh` scales `worker`, but `docker-compose.prod.yml` exposes `ingestion-worker`.

## Phase 2 — P1 reliability and storage

1. [x] Worker topology mismatch: aligned the production scaling script with `ingestion-worker` and added production topology/static role verification. Local commit: `2b366c1`.
2. [x] Non-shared production storage: restored explicit shared production volume topology and made unsafe production-local storage fail readiness. Local commit: `bde60dc`.
3. [x] Partial ingestion state: explicit extraction/chunking/embedding/partial states, idempotent retry coverage, migration verification, and local commit `a0849d5`.
4. [x] OCR occupies ingestion workers: dedicated PDF/OCR queue and bounded worker capacity with queue-safe retries/recovery. Local commit: `9e3eaf1`.

## Phase 3 — P1 AI trust and retrieval

1. [x] Untrusted-content boundary for context and decision-candidate prompts. Local commits: `f85b46b`, `52c2a2b`.
2. [x] Explicit retrieval/context failure propagation and user-visible unsupported-context state. Local commit: `f666058`.
3. [x] Stable, workspace-scoped evidence binding and source validation for decision candidates. Local commit: `cceaf0c`.

## Phase 4 — P1 authorization, search, and frontend/mobile

1. [x] Verify and harden service-role authorization preconditions and workspace isolation coverage. Local commits: `b004ce6`, `25243f1`, `58dd07e`, `4a8a34f`, `cde3cf27`, `1c5a4ca1`, `aebbb569`, `c0daacdb`, `17b0ed49`, `cfc8187e`, `ce4a4f5a`, `448d8887`, `8baf8e75`, `127d9b89`, `29df0720`.
2. [x] Batch channel visibility checks and constrain/fix fallback search behavior. Local commit: `81a9427`.
3. [x] Reduce global provider coupling without changing active-workspace semantics. Local commits: `c0ab5d6`, `aef2d9ab`.
4. [x] Make core mobile domains directly discoverable at small breakpoints. Local commit: `06778d3`.

## Phase 5 — P2/P3 audit findings

- [ ] Address remaining confirmed P2/P3 findings incrementally after every P1 has focused verification and a local commit. (in progress)

## Phase 6 — Integration verification

- [ ] Backend suite; frontend lint, typecheck, build, E2E, accessibility; security isolation; worker/queue/storage/AI retrieval verification.
- [ ] Record blocked infrastructure-dependent checks accurately.

## Phase 7 — Top 10 features

- [ ] Implement each listed feature in audit order using the same inspect → focused plan → implement → test → commit workflow, only after Phase 6 passes.

## Current finding

**P1 — Worker topology mismatch**

- Affected path to trace: `scripts/start_workers.sh` → `docker-compose.prod.yml` → worker runtime/health/queue lifecycle.
- Failure model: scale/start commands target a nonexistent Compose service, so a production scaling action can silently fail or leave ingestion capacity unchanged.
- Intended behavior: every production scale target exists in Compose; a focused static/regression test prevents drift.
- Source of truth: the `ingestion-worker` Compose service, whose `OMNIX_ROLE` is `ingestion_worker` and whose command starts `app.jobs.worker`. The runtime separately registers `ingestion_worker_main` as an ingestion worker; this is an in-process instance identifier, not a Compose service name.
- Smallest coherent change: correct only the script's `--scale` and requested service target, then add a production-topology static test that reads Compose, the script, and the existing systemd unit to catch future name drift.
- Focused verification: run the new production-topology test plus the existing worker recovery tests; run shell syntax checking and review the isolated diff before committing.

## Completed finding record

### P1 — Worker topology mismatch

- Changed: `scripts/start_workers.sh`, `backend/tests/test_production_worker_topology.py`.
- Verified: `pytest backend/tests/test_production_worker_topology.py -q` (2 passed); `pytest backend/tests/test_ingestion_worker_recovery.py -q` (35 passed); `pytest backend/tests/test_dev_worker_topology.py -q` (1 passed); `bash -n scripts/start_workers.sh`; `python3 -m py_compile backend/tests/test_production_worker_topology.py`.
- Blocked narrow check: `ruff` is not installed in the available environment.

### P1 — Non-shared production storage

- Changed: `.env.example`, `backend/app/services/file_storage.py`, `backend/app/health/checks.py`, `docker-compose.prod.yml`, `backend/tests/health/test_operational_health.py`, `backend/tests/test_production_upload_volume.py`.
- Verified: `pytest backend/tests/health/test_operational_health.py -q` (12 passed); `pytest backend/tests/test_production_upload_volume.py -q` (1 passed); `pytest backend/tests/services/test_file_storage.py -q` (4 passed); `pytest backend/tests/routers/test_files_storage_missing.py -q` (4 passed); `pytest backend/tests/routers/test_upload_async_processing.py -q` (2 passed); `pytest backend/tests/jobs/test_ingestion_file_processing.py -q` (6 passed); Python compilation; staged whitespace check.
- Blocked deployment verification: `docker compose -f docker-compose.prod.yml config --quiet` cannot run because the intentionally absent `.env.production` is required by the Compose file. No substitute production file was created.

## Current finding

**P1 — Non-shared production storage**

- Affected path: `upload.py` and Google Drive ingestion call `file_storage.save_bytes_to_user_upload` → a `files.storage_path` is persisted → `ingestion_jobs.py` reads that path in a distinct worker → `files.py` reads/deletes it later. `docker-compose.prod.yml` currently gives the API and ingestion worker isolated container filesystems.
- Threat/failure model: a scaled or restarted worker cannot find the API container's locally written object, producing failed ingestion or missing downloads; ephemeral container storage also creates availability and durability loss. The local backend's health result is currently only a warning and is omitted from public readiness entirely.
- Security assessment: uploaded source files are availability- and confidentiality-sensitive assets. The existing storage abstraction provides path sanitization and scoped file access, but the container-storage boundary lacks an explicit shared-data control. An explicit named Compose volume is an acceptable single-host shared control; local storage without that declaration remains unsafe for multi-replica/multi-host production.
- Source of truth after the change: `docker-compose.prod.yml` declares `omnix_uploads` and mounts it at the same `OMNIX_UPLOAD_DIR` for API and ingestion-worker; `OMNIX_FILE_STORAGE_SHARED=true` is the explicit local-volume contract. `check_file_storage` reports this configuration, and `run_all_checks` feeds it into `/health/ready`.
- Smallest coherent change: restore the shared volume and consistent settings, add a small `storage_is_shared` configuration helper, change unsafe production-local status from warning to failed, include storage in readiness checks, document the setting, and add focused deployment/readiness tests. No schema migration is needed.
- Verification: storage service round trips, upload/download/deletion tests, operational health/readiness tests, production Compose static test, and `docker compose -f docker-compose.prod.yml config` when the local production env file permits it.

## Current finding

**P1 — Prompt injection through untrusted content**

- Affected path to trace: context prompt assembly, retrieval/chunk formatting, web/document content, and decision-candidate prompt construction.
- Failure model: user-controlled and retrieved source text can resemble system instructions or tool commands and alter AI behavior if it is not separated as untrusted data.
- Required outcome: clear instruction hierarchy and untrusted-data delimiters across chat and decision-candidate flows, with adversarial regression tests and no reliance on prompt formatting for authorization.
- Chosen design: add a neutral `prompt_trust` helper for the shared untrusted-content policy and structured untrusted-data records. Apply it at the provider system-message boundary, context prompt assembly, retrieval/web/document context assembly, and decision-candidate extraction.
- Source of truth: authorization remains in workspace services and retrieval filters; prompt formatting is a model-safety boundary only and does not replace authorization.
- Verification: focused adversarial prompt-builder, decision-candidate, retrieval, web-context, LLM payload, document retrieval, AI policy, hybrid retrieval, and platform integrity tests passed.

## Completed finding record

### P1 — Prompt injection through untrusted content

- Local commit: `f85b46b fix(ai): mark prompt source data as untrusted`.
- Changed: `backend/app/services/prompt_trust.py`, `backend/app/context/citations.py`, `backend/app/context/prompt_builder.py`, `backend/app/retrieval/context_builder.py`, `backend/app/services/chat_service.py`, `backend/app/services/decision_candidate_service.py`, `backend/tests/context/test_prompt_trust_boundaries.py`, `backend/tests/services/test_decision_candidate_service.py`, `backend/tests/retrieval/test_ai_eval_harness.py`, `backend/tests/retrieval/test_web_search_context.py`, `backend/tests/llm/test_llm.py`.
- Behavior: model system prompts now receive an idempotent untrusted-content policy; user queries, retrieved chunks, workspace intelligence, web snippets, document chunks, and decision-candidate sources are serialized as explicitly classified untrusted data with post-source reminders. Authorization and workspace isolation remain outside prompt formatting.
- Verified: `backend/.venv/bin/pytest backend/tests/context/test_prompt_trust_boundaries.py -q` (1 passed); `backend/.venv/bin/pytest backend/tests/services/test_decision_candidate_service.py -q` (4 passed); `backend/.venv/bin/pytest backend/tests/retrieval/test_ai_eval_harness.py backend/tests/retrieval/test_web_search_context.py -q` (12 passed); `backend/.venv/bin/pytest backend/tests/llm/test_llm.py -q` (11 passed); `backend/.venv/bin/pytest backend/tests/retrieval/test_hybrid_retrieval.py -q` (5 passed); `backend/.venv/bin/pytest backend/tests/routers/test_document_retrieval_safety.py -q` (3 passed); `backend/.venv/bin/pytest backend/tests/routers/test_messages_ai_policy.py -q` (4 passed); `backend/.venv/bin/pytest backend/tests/test_platform_integrity.py -q` (1 passed); Python compilation; scoped `ruff check` passed.
- Blocked broad whitespace check: uncommitted pre-existing instruction-file edits contain trailing whitespace, so only scoped/staged whitespace checks are valid for this finding.

### P1 — Live chat and assistance prompt-boundary completion

- Local commit: `52c2a2b fix(ai): harden live prompt trust boundaries`.
- Changed: the live retrieval context builder, fallback chat prompt construction, public generation, provider history normalization, task/channel/initiative assistance prompts, and prompt-boundary tests.
- Behavior: direct user requests, historical conversation text, task records, channel messages, initiative evidence, and fallback prompts are structured as untrusted records. Only the explicit server-side `system_prompt` can create a system-role model message. Source records escape delimiter-like characters and marker text so content cannot syntactically close the prompt framing.
- Verified: 36 focused prompt-boundary tests, then a 40-test retrieval/AI/platform suite and 27 message-policy/payload tests; Python compilation and staged whitespace check passed. Scoped Ruff remains unavailable in this environment.

## Current finding

**P1 — Silent retrieval/context degradation**

- Affected path to trace: `context/retrieval.py` → `context/engine.py`; live chat independently routes through `message_retrieval_service.py` and hybrid retrieval before calling the model.
- Failure model: vector, keyword, routing, document-context, or timeout errors are currently converted into empty/partial context and can allow an apparently source-backed AI answer.
- Intended behavior: distinguish no relevant sources from degraded/failed retrieval in telemetry and response payloads, and prevent source-backed generation when required retrieval fails.
- Next step: map all retrieval call sites and existing response/UI seams before changing error semantics; add vector, keyword, both-failure, timeout, and genuine-empty-context tests.

### Active micro-plan — retrieval failure semantics

- [x] Preserve semantic, keyword, reranker, and timeout outcomes in hybrid retrieval without exposing raw errors.
- [x] Carry a safe outcome through chat context, persisted assistant payloads, synchronous chat, SSE, and the chat UI.
- [x] Make context-engine callers fail closed when workspace retrieval is unavailable; preserve explicit diagnostics for telemetry.
- [x] Add focused vector, keyword, both-channel, timeout, empty-context, chat-payload, and context-engine regression tests.
- [x] Run the focused backend/frontend verification, review the isolated diff, then commit only this finding.

## Completed finding record

### P1 — Silent retrieval/context degradation

- Local commit: `f666058 fix(ai): make retrieval failures explicit`.
- Changed: hybrid semantic/keyword routing, vector failure propagation, bounded channel deadlines, context-engine outcomes, action/insight fail-closed handling, safe chat payload/SSE contract, and a visible chat retrieval-state banner.
- Behavior: a retrieval request now reports `sources_found`, `no_relevant_sources`, `partial`, `failed`, or `source_unavailable`. Channel failures and timeouts are logged safely, persisted with assistant messages, returned by synchronous chat, and sent in the stream. Fully failed retrieval receives a server-generated retry response instead of calling the model; partial retrieval is explicitly constrained to the sources that remain available.
- Verified: focused retrieval/context/chat/action suite (69 passed); `npm run typecheck --prefix frontend`; `npm run lint --prefix frontend`; Python compilation; staged whitespace check. Scoped Ruff could not run because the executable is absent from the available environment.
- No migration was required.

## Completion directive ledger

- User directive: finish every remaining confirmed audit finding, run Phase 6 integration, implement all Top 10 features in order, run final integration, remove this temporary file, then push only when fully verified.
- Remaining audit closure begins with the mention-only notification center, followed by draft-preserving error recovery, explicit empty/inaccessible/error states, bounded undo for consequential client mutations, theme-token cleanup, compact-label scanability, and narrow-header competition. Findings that are the same product gap as Top 10 Features 4, 6, or 7 will be closed by those feature implementations rather than duplicated.

## Current finding

**P2 — Notifications are a mention list rather than a workspace event inbox**

- Affected path: `WorkspaceNotificationsProvider` owns mention read state while `WorkspaceCollaborationProvider` already owns the authoritative workspace activity feed; `NotificationCenterSurface` consumes only mentions.
- Smallest coherent outcome: compose mentions and existing workspace activity in the notification surface with explicit All/Mentions/Activity filters, preserve unread semantics only for mentions, use event-aware destinations, and refresh both providers without inventing another persistence model.
- Verification: focused feed-model/source contracts and mocked desktop/mobile browser behavior, then React review, accessibility/UI audit, lint, typecheck, build, and isolated commit.

### P2 — Residual visual dialogs bypass the shared modal boundary

- Local commit: `a190d5b7 fix(accessibility): route residual overlays through modal`.
- Team role updates/removals and workspace/subworkspace creation now use the shared named, focus-trapped, background-isolating modal boundary. Member removal is an `alertdialog`; pending actions disable Escape, backdrop, close, and cancel dismissal; workspace forms keep their original name-field initial focus and fixed footer actions around a scrollable body.
- Verified: focused source contract (6 passed), live workspace dialog keyboard/focus/axe coverage (2 passed), final combined focused modal matrix (8 passed), typecheck, lint, UI audit, and 39-route production build. The broader modal/release matrix passed 124 tests with 29 intentional skips but reported one existing mobile navigation timeout; that exact navigation case then passed twice consecutively in isolation.
- No migration was required.

## Current finding

**P2 — Residual visual dialogs bypass the shared modal boundary**

- Affected path: member role/removal actions in `frontend/app/(dashboard)/team/page.tsx` and workspace/subworkspace creation in `frontend/app/(dashboard)/workspace/page.tsx` render directly through `Portal`, bypassing the shared dialog, focus-trap, background isolation, Escape/backdrop, focus-return, naming, and bounded-body behavior.
- Failure model: the earlier shared-modal remediation does not protect these four visual overlays; keyboard and assistive-technology users can reach background content or receive no dialog semantics.
- Intended behavior: every visual modal uses the shared semantic boundary, destructive removal is an `alertdialog`, busy submissions cannot be dismissed mid-request, and short viewports retain independently scrollable bodies with visible controls.

### Active micro-plan — close the residual modal boundary

- [x] Enumerate every remaining portal/dialog/modal overlay and trace the four raw member/workspace flows.
- [x] Convert only those four overlays to the shared `Modal` primitive while preserving forms, busy-state dismissal rules, and visual content.
- [x] Extend focused modal contracts, run them first, fix failures, then run frontend typecheck/lint/UI audit/build and the relevant browser matrix before an isolated commit.

### P1 — OCR occupies ingestion workers

- Local commit: `9e3eaf1 fix(ingestion): isolate OCR worker capacity`.
- Changed: queue routing/recovery and worker runtime configuration, direct-upload and Google Drive enqueue paths, development and production Compose topologies, worker startup/systemd files, OCR runtime dependency, queue configuration documentation, and focused worker/route tests.
- Behavior: PDF jobs persist an internal queue marker and are consumed by the `ocr_worker` role, which defaults to one concurrent job and a 30-minute timeout. Retry and recovery use that marker, so OCR jobs cannot be requeued onto ordinary ingestion capacity. Non-PDF ingestion remains on the primary queue.
- Verified: OCR isolation/queue tests (7 passed); worker recovery, upload async-processing, platform integration, document intelligence, ingestion-state, and worker topology tests (61 passed total); Python compilation; worker-script syntax; development Compose validation. Production Compose validation remains blocked solely by the intentionally absent `.env.production` file.

### P1 — Partial ingestion state

- Local commit: `a0849d5 fix(ingestion): expose partial vector indexing state`.
- Changed: `backend/app/jobs/ingestion_jobs.py`, `backend/app/schemas/chat.py`, `frontend/components/chat/types.ts`, `frontend/components/files/filesPageModel.ts`, `frontend/components/files/SourceHealthConsole.tsx`, `supabase/migrations/0047_file_processing_embedding_state.sql`, and focused ingestion/frontend/migration tests.
- State contract: successful runs transition `extracting` → `chunking` → `embedding` → `searchable`. A failure after fallback text chunks persist transitions to `partially_searchable`, returns a failed/retryable job result, and records `vector_index_status=failed`; an earlier chunk persistence failure remains `failed`.
- Migration verification: `npx supabase db push` applied `0047_file_processing_embedding_state.sql` successfully to the remote database. Docker Desktop being unavailable only prevented the CLI's optional migration-catalog cache from updating.
- Verified: partial-state tests (3 passed), existing ingestion-file tests (6 passed), migration static test (1 passed), RAG replacement/scope and document-context scope tests, frontend modularity test, frontend `npm run typecheck`, frontend `npm run lint`, Python compilation, and whitespace check. `ruff` remains unavailable in this environment.

- Affected path: `ingestion_jobs.handle_ingest_file` extracts bytes → persists fallback text chunks via `store_extracted_text_chunks` → invokes `RAGIngestionPipeline` for embeddings/replacement rows. The file page derives visible labels from `processing_status` in `frontend/components/files/filesPageModel.ts`.
- Failure model: current code writes fallback chunks and marks the source `searchable` before vector indexing begins. An embedding/setup failure can therefore expose a fully-searchable label despite only keyword/fallback chunks existing. Retry has scoped replacement logic, but state transitions do not make the partial condition explicit.
- Chosen design: add `chunking` and `embedding` status values through a forward-only constraint migration and shared backend/frontend types. Move the success state update until after vector insertion. If vector indexing fails after chunks persist, retain those scoped fallback chunks as `partially_searchable`, return a retryable failed job result, and never write `searchable`. Failure before chunk persistence remains `failed`.
- Data integrity: every retry already calls `store_extracted_text_chunks(..., replace_existing=True)` and vector ingestion replaces file-scoped rows. Focused tests will assert scoped replacement remains enabled, never report full searchability on failure, and preserve only current-attempt fallback chunks.
- Required verification: focused ingestion stage-failure tests; RAG replacement/scope tests; frontend typecheck; migration static test; `npx supabase db push` immediately after adding the migration, with its exact result recorded.

## Current finding

**P1 — Weak decision evidence binding**

- Affected path: conversation/document candidate extraction → candidate review UI → decision creation → durable decision traceability records.
- Failure model: candidate evidence is currently plain text without a stable message or document locator. The create endpoint receives only a broad source type/id, so the server cannot prove that an accepted candidate quote belongs to the cited workspace source.
- Required outcome: candidate evidence must retain workspace-scoped source identifiers; conversation evidence must include channel/message IDs; document evidence must include document chunk IDs/indexes and character spans where available; acceptance must revalidate every quote and source boundary before it is persisted.

### Active micro-plan — decision evidence binding

- [x] Build server-generated source-anchor records for conversation messages and document chunks; accept only exact, validated quote references returned by the candidate model.
- [x] Carry typed evidence references through the candidate schema and both candidate-to-decision UI flows.
- [x] Persist validated evidence snapshots and stable locators atomically with the decision, bounded and immutable at the database layer.
- [x] Revalidate all evidence references under the decision workspace/source before insert; reject cross-workspace, source-mismatched, or stale/altered quotes.
- [x] Add focused candidate extraction, decision-service authorization/persistence, router/schema, and migration tests; run the migration push, focused suite, frontend checks, then commit only this finding.

## Completed finding record

### P1 — Weak decision evidence binding

- Local commit: `cceaf0c fix(decisions): bind candidates to source evidence`.
- Changed: candidate extraction now sends opaque prompt record references and accepts only direct quote matches from workspace-scoped conversation messages or document chunks. Candidate acceptance is a dedicated endpoint that reloads and verifies every channel/message or file/chunk anchor, content hash, chunk index, page (when available), and character span before persistence.
- Persistence: `workspace_decisions.source_evidence` stores a bounded (five-item) immutable JSONB snapshot together with the decision. It includes quote and source hashes, message/channel or file/chunk locators, chunk index/page where available, and character offsets. Existing broad source pointers remain intact for legacy decisions.
- UI: candidate evidence now renders verified message/chunk locators and links. Both conversation and document candidate flows send typed evidence to the dedicated acceptance route; acceptance telemetry is emitted only after a successful decision write.
- Migration: `0048_workspace_decision_evidence.sql` applied successfully with `npx supabase db push`; `npx supabase migration list` confirms local and remote history through `0048`. Docker Desktop was unavailable only for the CLI's optional migration-catalog cache.
- Verified: focused candidate/decision/migration/schema/router/retrieval/platform/traceability suite (41 passed); Python compilation; frontend typecheck, lint, and production build; scoped whitespace check.
- Blocked narrow check: `ruff` is not installed in the available environment.

## Current finding

**P1 — Search fan-out, private-channel N+1 visibility, and operational-result exposure**

- Affected path: `WorkspaceSearch`/`CommandPalette` → `GET /workspaces/{workspace_id}/search` → `search_workspace` → ranked Supabase RPC plus conversation visibility, membership, and mention lookups.
- Failure model: every private channel incurs one trusted service-role membership read; a ranked-RPC exception activates concurrent leading-wildcard field queries across every domain; the ordinary search contract exposes job result/error/payload-derived output.
- Intended behavior: one batched membership read protects private-channel visibility; ordinary search uses the indexed, workspace-authenticated ranked RPC or returns an explicit safe availability error; operational jobs are not returned through the user search endpoint or direct authenticated RPC.

### Active micro-plan — search safety and scale

- [x] Trace browser, router, service-role, RPC, fallback, and UI error paths; confirm the existing workspace-access precondition and direct-RPC membership boundary.
- [x] Batch private-channel membership reads and retain creator/workspace-visible channel semantics.
- [x] Remove the broad wildcard fallback in favor of an explicit safe ranked-search availability failure.
- [x] Restrict ordinary search types and redefine the direct authenticated RPC so it cannot return job payload/error/result records.
- [x] Add focused service, router/static-migration, and frontend contract tests; push and verify the migration; run focused backend/frontend checks; review and commit only this finding.

## Completed finding record

### P1 — Search fan-out, private-channel N+1 visibility, and operational-result exposure

- Local commit: `81a9427 fix(search): eliminate fanout and operational leaks`.
- Changed: ordinary search now uses the workspace-authorized indexed RPC or returns a safe 503 instead of launching the broad fallback; private-channel visibility fetches memberships in one scoped batch and retains workspace-visible/creator semantics; job results are filtered in the service and omitted from the direct RPC.
- Migrations: `0049_workspace_search_safe_results.sql` and `0050_workspace_search_rpc_role_grants.sql` both applied successfully to the remote database. Catalog verification confirms the deployed RPC no longer references `public.jobs`, `anon_execute=false`, and authenticated/service-role execution remains enabled. Docker Desktop was unavailable only for the CLI migration-catalog cache.
- Verified: focused search service/router/migration suite (12 passed); Python compilation; scoped Ruff; staged whitespace check; remote migration history matches local through `0050`.

## Current finding

**P1 — Direct Supabase file/document and retrieval-RPC authorization boundary**

- Affected path: browser anon-key client → PostgREST/RPC → `files`/`documents` RLS → workspace membership helper; backend retrieval uses the same tables/functions through the service role.
- Confirmed deployed drift: public `Scoped Document/File Visibility` policies only test for a workspace row, and public `documents_own`/`files_own` policies let an original uploader retain access to a workspace record after revocation. The tables and all retrieval RPC overloads also have public/anon/authenticated grants.
- Intended behavior: anonymous callers cannot read or mutate files/documents or execute retrieval RPCs; authenticated direct reads are restricted to private owner rows or active workspace membership; browser callers cannot use retrieval RPCs; backend service-role paths retain their required access.

### Active micro-plan — document storage RLS

- [x] Trace frontend/client, backend retrieval, RLS policy, table-grant, and RPC-overload paths; capture the live catalog drift.
- [x] Replace drifted policies with explicit authenticated private-owner and workspace-member SELECT policies; remove direct anonymous/authenticated mutation grants.
- [x] Revoke public/anon/authenticated execution for all retrieval and match-document RPC overloads; preserve service-role execution.
- [x] Add static migration coverage and live catalog/RLS checks for anonymous, nonmember, member, and revoked-owner paths; push/verify the migration, run focused tests, review, and commit only this finding.

## Completed finding record

### P1 — Direct Supabase file/document and retrieval-RPC authorization boundary

- Local commit: `b004ce6 fix(security): restrict document storage access`.
- Changed: `0051_document_storage_rls_boundary.sql` replaces the drifted public policies with authenticated SELECT-only private-owner and active-workspace-member policies, removes direct mutations from untrusted roles, and restricts all known retrieval RPCs to `service_role`. The function ACL loop safely skips remote-only overloads during a clean local rebuild. `0052_document_storage_rls_policy_hardening.sql` removes an explicit inherited `anon` grant from the workspace-access helper and uses cached-auth policy expressions.
- Migration verification: `npx supabase db push` applied both migrations; `npx supabase migration list` confirms local/remote history through `0052`. The dynamic overload ACL block was also executed inside a rolled-back remote transaction to validate its syntax. Docker Desktop remains unavailable only for the optional migration-catalog cache.
- Live boundary verification: catalog checks confirm `anon` cannot read/mutate documents/files or execute any retrieval RPC; authenticated is read-only and `service_role` retains required access. An actual workspace owner could read 15 documents and 2 files; a synthetic nonmember saw zero. No historical revoked-uploader row exists in the linked data to exercise that exact case, but the former `FOR ALL` owner policies are absent and only the membership helper remains for workspace rows.
- Verified: focused migration/retrieval/document-context/ingestion/files/artifacts suite (33 passed); Python compilation; scoped Ruff; whitespace checks.

## Current finding

**P1 — Frontend global provider coupling**

- Affected path: `DashboardProviders` → `WorkspaceProvider` → tree/membership/intelligence state → global collaboration/onboarding/surface consumers.
- Failure model: the global provider stack mounts continuity data even though it has one consumer: the workspace page. Each active-workspace change therefore initiates three unrelated continuity requests (initiatives, timeline, unresolved continuity) on chat, files, and other dashboard routes.
- Intended behavior: preserve the existing state ownership, active-workspace lifecycle, request deduplication, and workspace-page behavior while mounting continuity only around its sole consumer. Do not add a global state library or duplicate network requests.

### Active micro-plan — workspace context boundaries

- [x] Trace `DashboardProviders`, workspace state partitions, the aggregate context, every legacy consumer, and existing frontend test seams. The smallest safe boundary is `WorkspaceContinuityProvider`, which has one consumer but performs three requests on every global workspace switch.
- [x] Remove `WorkspaceContinuityProvider` from the global provider stack and scope it around the workspace page only.
- [x] Add a focused architecture regression check preserving the page-scoped continuity boundary and required global provider composition.
- [x] Run focused frontend check, typecheck, lint, build, review only the scoped diff, and commit locally.

## Completed finding record

### P1 — Frontend global provider coupling

- Local commit: `c0ab5d6 fix(frontend): scope continuity data to workspace page`.
- Changed: the continuity provider now mounts only around the workspace page, its sole consumer. The global shell no longer starts continuity’s initiatives, timeline, and unresolved-continuity fetches whenever a user visits or switches workspaces on unrelated routes.
- Preserved: workspace state ownership, workspace-switch race protection, active-workspace behavior, and all other shell-wide providers remain unchanged.
- Verified: `backend/tests/frontend/test_workspace_context_split.py` (11 passed); frontend typecheck; frontend lint; frontend production build; scoped whitespace check.

## Current finding

**P1 — Mobile navigation coverage**

- Affected path: `MobileDock` → `AppShell` → sidebar navigation and responsive dashboard routes.
- Failure model: initiatives, decisions, and settings are available only after an extra “More”/sidebar action, despite being core mobile domains. Eight primary tabs would make each target too narrow at 375px.
- Intended behavior: retain a seven-column, safe-area-aware dock with 48px targets, while directly exposing Home, Chat, Tasks, Files, Decisions, Initiatives, and Settings. Existing explicit header/sidebar controls retain search, alerts, team, and analytics access.

### Active micro-plan — mobile navigation coverage

- [x] Trace dock, app shell, header/sidebar routes, current mobile test coverage, and touch/focus/safe-area constraints.
- [x] Replace indirect dock items with direct Decisions, Initiatives, and Settings links without reducing target size or safe-area handling.
- [x] Add focused static and responsive E2E coverage for the new direct routes and retained team/analytics access.
- [x] Run focused UI checks, typecheck, lint, build, review only the scoped diff, and commit locally.

## Completed finding record

### P1 — Mobile navigation coverage

- Local commit: `06778d3 fix(mobile): expose core workspace navigation`.
- Changed: the seven-slot mobile dock now directly exposes Home, Chat, Tasks, Files, Decisions, Initiatives, and Settings. Header controls retain search and alerts; the explicit navigation drawer retains Team and Analytics. The dock uses a 48px important minimum height to override the project-wide 44px flex-link baseline, safe-area padding, touch handling, focus-visible rings, and truncation for narrow screens.
- Verified: `npm run test:ui-audit --prefix frontend`; focused real Playwright browser test at 375px, 390px, and 768px (1 passed); frontend typecheck; frontend lint; frontend production build; scoped whitespace check. The first Playwright invocation was invalid because the RTK parser selected zero tests; the raw passthrough run was then used. The initial real run caught the 44px CSS override, which was fixed and rerun green.

## Current finding

**P1 — Redis dependency is a queue availability point**

- Affected path: upload/Google Drive/re-embed enqueue → durable `jobs` row → Redis wake-up queue → ingestion/OCR worker → job handler/retry path.
- Failure model: a Redis `LPUSH` or worker poll can wait without a bounded client timeout; jobs persisted during a Redis outage wait for a Redis-based recovery scan; duplicate Redis/recovery delivery can execute the same handler twice because the worker does not atomically claim the queued row.
- Intended behavior: Postgres remains the authoritative job queue and Redis is a bounded low-latency wake-up path. Workers must poll their own queue's durable jobs when Redis is unavailable or idle, atomically claim a `queued` row before execution, retain legacy normal-queue routing, and avoid cross-pool OCR work.

### Active micro-plan — durable queue fallback

- [x] Centralize the lazy and application Redis client construction with socket/connect timeouts, and bound queue Redis operations.
- [x] Add a queue-specific, indexed, bounded Postgres fallback selector; process it on idle/error polling while retaining legacy normal-queue jobs.
- [x] Claim jobs conditionally from `queued` to `processing` before handler execution so duplicate delivery is harmless and runtime metrics remain accurate.
- [x] Add focused tests for Redis command timeout, single handler execution after duplicate delivery, and database fallback processing; add/push/verify the supporting queue index migration.
- [x] Run focused worker/queue tests and relevant regression suite, inspect the isolated diff, then commit only this finding.

## Completed finding record

### P1 — Redis dependency is a queue availability point

- Local commit: `1ab01f59 fix(jobs): make database queue durable fallback`.
- Changed: Redis client construction is centralized and bounded for lazy workers as well as application startup; enqueue, retry, and recovery Redis commands now have command deadlines. The worker periodically polls the queue-specific durable job rows and immediately does so after a Redis poll failure, while preserving legacy no-marker jobs only for normal ingestion.
- Safety: every worker conditionally transitions `queued` → `processing` before invoking a handler. Redis/recovery/database duplicate delivery now skips the lost claim without running the handler or inflating job-failure metrics.
- Migration: `0053_jobs_durable_queue_fallback_index.sql` was applied successfully with `npx supabase db push`; remote migration history confirms local/remote through `0053`. The partial expression index covers `(payload->>'_queue'), created_at` for live queued rows.
- Verified: focused queue availability suite (7 passed); worker/recovery/OCR/upload/Google Drive regression suite (55 passed); scoped Ruff; Python compilation; staged whitespace check. Docker Desktop remained unavailable only for Supabase's optional migration-catalog cache.

## Current finding

**P1 — Realtime conversation updates trigger full channel reloads**

- Affected path: `workspace_channel_messages` INSERT → database trigger updates `workspace_channels` → Supabase realtime `workspace_channels` event → `WorkspaceConversationSurface` → channel list and selected conversation state.
- Failure model: every message updates the parent channel, and the broad realtime callback calls `loadChannels()` for every channel INSERT/UPDATE/DELETE. The sender also reloads all channels after its own successful post, producing redundant requests and loading transitions despite having the message and realtime row locally.
- Intended behavior: reconcile channel INSERT/UPDATE rows incrementally with the same announcement-first/name sort as the backend; locally project a posted message into its channel summary without double-counting an already-arrived realtime update; keep the conservative full fetch only for rare delete/archive selection changes.

### Active micro-plan — incremental channel reconciliation

- [x] Add pure channel reconciliation and local message-summary helpers with deterministic backend-equivalent ordering.
- [x] Replace hot-path channel realtime and local-send reloads with those helpers, retaining full reload only for DELETE/archive recovery.
- [x] Harden the reconciliation boundary: reject stale-workspace callbacks, invalidate an older in-flight snapshot after accepted local/realtime changes, locally remove delete/archive rows before conservative recovery, and preserve authoritative message counts.
- [x] Add focused pure coverage for snapshot freshness and summary-count convergence plus static wiring assertions; run UI audit, targeted browser test, typecheck, lint, build, and inspect the scoped diff.
- [x] Commit only this finding after all checks pass.

#### Reconciliation invariants under review

- A callback may mutate channel state only when both its subscribed workspace and the event row belong to the active workspace.
- A channel-list response may replace state only when it is still the newest request for the active workspace and no local/realtime channel state has been accepted since it began. If a response is invalidated by a state change, one fresh snapshot is requested rather than applying stale data.
- Local message success updates presentation fields only; the database-triggered channel row remains the authority for `message_count`.

## Completed finding record

### P1 — Realtime conversation updates trigger full channel reloads

- Local commit: `0de00c9 fix(realtime): reconcile channel updates incrementally`.
- Changed: channel INSERT/UPDATE events now reconcile locally using the backend's announcement-first/name ordering, successful sends project only a newer preview, and full channel fetches are retained only for delete/archive recovery or a superseded initial snapshot.
- Safety: stale callbacks must match both the subscribed and active workspace; a revision guard rejects stale channel snapshots and issues one fresh request, including when the stale request failed. Delete/archive events remove the row locally before the conservative recovery fetch. `message_count` stays authoritative from the database-triggered channel event, preventing out-of-order local post completions from inflating it.
- Verified: `npm run test:ui-audit --prefix frontend`; `npm run typecheck --prefix frontend`; `npm run lint --prefix frontend`; focused Chromium Playwright reconciliation test (1 passed); `npm run build --prefix frontend`; scoped whitespace check. The initial browser invocation from repository root did not load the frontend Playwright config; the rerun from `frontend/` passed.

## Current finding

**P1 — Framer Motion is loaded into the authenticated global shell**

- Affected path: authenticated dashboard layout → `AppShell` → `AmbientParticles`, `PageTransition`, and `Sidebar` → `WorkspaceSelector`/`WorkspaceTreeNode`/`SidebarModals`; plus `AppShell` → `Header` → `InviteNotifications`. All six paths statically import Framer Motion, making its runtime part of every authenticated route.
- Failure model: these shell effects are predetermined entry, popover, expand, and decorative transform/opacity animations, but their JavaScript animation runtime and reduced-motion hook are loaded globally. The feature-level motion imports can remain route-scoped; this finding is specifically the shell dependency.
- Intended behavior: preserve purposeful shell feedback with CSS transform/opacity entry effects, keep static/compact particles on coarse and small displays, explicitly disable all shell motion for `prefers-reduced-motion`, and remove every Framer import reachable from the authenticated shell.

### Active micro-plan — CSS-only shell motion

- [x] Trace the authenticated layout, shell imports, particle/page-transition behavior, reusable reduced-motion rules, and all remaining route-level Framer imports.
- [x] Convert the six shell-only motion modules to CSS transform/opacity entry effects; preserve their visual semantics and leave feature-level Framer interactions untouched.
- [x] Add static dependency checks and a focused browser reduced-motion assertion; run UI audit, typecheck, lint, targeted browser test, build, inspect the scoped diff, and commit locally.

## Completed finding record

### P1 — Framer Motion is loaded into the authenticated global shell

- Local commit: `f4080ea fix(perf): remove motion runtime from shell`.
- Changed: all six static authenticated-shell paths (`AmbientParticles`, `PageTransition`, sidebar selector/tree/modals, and invite notifications) now use short CSS-only transform/opacity entry effects. Framer Motion remains in feature-level and route-scoped components where it serves dedicated interactions.
- Accessibility and device behavior: the new effects use `ease-out` and stay at or below 220ms; all are explicitly disabled for `prefers-reduced-motion`. Shell particles remain static and are capped at eight visible elements on coarse-pointer/small displays.
- Verified: no `framer-motion` import remains under the static layout shell; `npm run test:ui-audit --prefix frontend`; `npm run typecheck --prefix frontend`; `npm run lint --prefix frontend`; focused reduced-motion Chromium shell test (1 passed); `npm run build --prefix frontend`; scoped whitespace check.

## Current finding

**P1 — Chat markdown eagerly includes syntax highlighting**

- Affected path: `ChatInterface` → `MessageList` → `MessageBubble` → `MarkdownRenderer`. The static Prism and theme imports currently load whenever the chat surface renders, even when every message is plain Markdown.
- Failure model: ordinary chat traffic pays the parsing, transfer, and execution cost of the syntax-highlighter runtime and Prism theme despite never rendering a fenced code block.
- Intended behavior: preserve accessible code rendering and copy behavior while loading the highlighter only after a code-block renderer mounts. A lightweight, styled `<pre><code>` fallback must render immediately and remain usable if the optional runtime cannot load.
- Source of truth: Markdown parsing remains owned by `react-markdown`; only `CodeBlock` owns its optional highlighting state. Regular inline-code and prose rendering must stay free of a highlighter dependency.

### Active micro-plan — on-demand syntax highlighting

- [x] Trace the chat route, message normalization/rendering chain, static dependency, and E2E mock-data seams.
- [x] Replace the static highlighter/theme imports with code-block-local dynamic imports and an immediate plain-code fallback.
- [x] Add focused static dependency assertions and a mocked-chat browser regression that renders a fenced code block and preserves its copy control.
- [x] Run UI audit, targeted browser test, typecheck, lint, production build, bundle-boundary and scoped diff checks, then commit only this finding.

## Completed finding record

### P1 — Chat markdown eagerly includes syntax highlighting

- Local commit: `623b2d1a fix(perf): defer chat syntax highlighting`.
- Changed: `MarkdownRenderer` keeps code-block presentation and clipboard behavior local, but dynamically imports the Prism runtime and theme only from a mounted code block. The shared loader prevents duplicate optional imports; an immediate wrapped plain-code fallback remains visible if that optional import cannot complete.
- Coverage: the UI audit rejects eager highlighter imports and requires the code-block loader/fallback; the authenticated browser fixture loads an actual assistant fenced-code message through the normal chat API path and asserts its code/copy control render.
- Verified: `npm run test:ui-audit --prefix frontend`; `npm run typecheck --prefix frontend`; `npm run lint --prefix frontend`; focused Chromium Playwright chat-code test (1 passed); `npm run build --prefix frontend`; built `ChatInterface` loadable entry checked across 10 initial chunks with no syntax-highlighter marker; scoped whitespace and staged-diff checks.

## Current finding

**P1 — Core record creation is not consistently discoverable or repeatable**

- Affected path: global `CommandPalette` quick actions → `hrefWithFreshCreateToken` → `/tasks|decisions|initiatives?create=…&palette=…` → each domain surface's URL-driven create state → the existing form/modal → its domain API. Contextual message actions remain shortcuts into source-preserving task/decision forms.
- Confirmed state: tasks have a direct `Record Task` control and an empty-state create action; decisions have a direct `New Decision` control; message actions are visible 44px controls, not hover-only/overflow actions. The normal initiative-page control is ambiguously labelled `Open` even though it opens its create form.
- Failure model: `hrefWithFreshCreateToken` deliberately emits a new `palette` request token for every command-palette create activation, but task and initiative effects watch only a boolean `create` flag. After a cancel, a second canonical palette activation preserves that boolean and fails to reopen the form.
- Source of truth: `create=<domain>` authorizes the route-driven form; the optional `palette` token is an event identity only. No new creation state, backend endpoint, or duplicate form is needed.
- Smallest coherent change: label the existing initiative control `Create Initiative`; make task and initiative create-open effects react to the fresh palette token while retaining their existing direct-route behavior; add focused browser/static coverage for direct initiative creation and repeated command-palette creation. Do not move or duplicate the existing message actions.

### Active micro-plan — canonical creation entry points

- [x] Trace every task, decision, initiative, command-palette, and contextual-message creation path through form/modal and backend ownership.
- [x] Make the initiative CTA explicit and honor each fresh command-palette create token in task/initiative route effects.
- [x] Add focused UI audit assertions and Chromium coverage for the normal initiative CTA plus repeated command-palette creation.
- [x] Run UI audit, targeted browser test, typecheck, lint, production build, scoped diff checks, then commit only this finding.

## Completed finding record

### P1 — Core record creation is not consistently discoverable or repeatable

- Local commit: `91f1952e fix(ux): make core creation paths repeatable`.
- Changed: the existing initiative-page toggle is now labelled `Create Initiative`; task and initiative surfaces treat the command palette's fresh `palette` query token as a new open-form request while retaining their `create=<domain>` route contract. Decision creation already reacts to route changes and remains unchanged.
- Preserved: task/decision message actions stay visible, source-preserving contextual shortcuts; canonical form/modal ownership and backend create endpoints remain unchanged.
- Verified: `npm run test:ui-audit --prefix frontend`; `npm run typecheck --prefix frontend`; `npm run lint --prefix frontend`; focused Chromium creation-flow test (1 passed) covering direct initiative creation, repeated task/initiative palette requests, and decision palette routing; `npm run build --prefix frontend`; scoped whitespace and staged-diff checks.

## Current finding

**P2 — Credentialed CORS permits arbitrary methods and request headers**

- Affected path: browser API client / upload XHR → FastAPI `CORSMiddleware` configured in `create_app` → preflight response. The authenticated client uses bearer tokens plus `Content-Type` and `X-Omnix-Workspace`; it does not use cookies or `credentials: include`.
- Confirmed state: origin handling is already explicit and rejects wildcards/unknown production origins, so that portion of the audit is stale. However, the middleware still sets `allow_credentials=True`, `allow_methods=["*"]`, and `allow_headers=["*"]`.
- Failure model: a permitted origin receives a broad cross-origin API capability surface that is wider than the browser client needs. This is defense-in-depth rather than an origin-reflection bypass because origins are server-controlled and allowlisted.
- Source of truth: the browser client’s header construction uses only `Authorization`, `Content-Type`, and `X-Omnix-Workspace`; all current API routes use GET, POST, PATCH, or DELETE.
- Smallest coherent change: make the CORS policy credentialless and explicitly list only the observed methods and headers. Preserve the existing configurable origin allowlist/regex, route auth, and same-origin Next proxy.

### Active micro-plan — explicit browser CORS contract

- [x] Trace frontend fetch/XHR headers, auth scheme, FastAPI middleware, origin configuration, route methods, and existing CORS coverage.
- [x] Add a focused trusted-origin preflight contract test that proves required headers/methods work and unneeded header/method/credential grants are absent.
- [x] Replace CORS wildcards with the observed explicit browser contract, preserving origin allowlisting.
- [x] Run focused backend tests and relevant security regressions, lint/compile checks, scoped diff checks, then commit only this finding.

## Completed finding record

### P2 — Credentialed CORS permits arbitrary methods and request headers

- Local commit: `25243f13 fix(security): narrow browser cors policy`.
- Changed: `backend/app/bootstrap/app.py`, `backend/tests/test_cors_policy.py`.
- Behavior: the browser CORS policy is credentialless and explicitly permits only the bearer-token client contract: `GET`, `POST`, `PATCH`, and `DELETE` with `Authorization`, `Content-Type`, and `X-Omnix-Workspace`. Origin allowlisting/regex configuration and route-level authorization remain unchanged.
- Verified: focused CORS preflight and security-hardening suite (10 passed); scoped Ruff; Python compilation; staged whitespace check.
- No migration was required. The focused test is force-tracked because the repository's broad `test_*.py` ignore rule would otherwise hide it.

## Current finding

**P2 — Public readiness responses expose internal health details**

- Affected path: unauthenticated `GET /health/ready` → `run_all_checks(include_internal=False)` → component health probes containing provider, endpoint, storage, dependency, and exception details → JSON response. The liveness probe remains a public constant status; `/health/operational` is already runtime-admin protected for detailed diagnostics.
- Failure model: an unauthenticated caller can learn internal endpoint names, dependency/provider configuration, installed models, storage posture, and raw failure strings even when readiness fails. Probe systems need the status code, not the diagnostic object.
- Intended behavior: public readiness remains unauthenticated and returns only a stable `ready` / `not_ready` status with its existing 200/503 semantics. Detailed diagnosis stays behind the current protected operational endpoints.
- Smallest coherent change: retain all checks for readiness decision-making but remove the `checks` object from both public response paths; add focused happy/degraded/failure response tests and ensure the internal checks remain invoked with `include_internal=False`.

### Active micro-plan — public readiness minimization

- [x] Trace public and authenticated health routes, health-check field shapes, security exemption, probe consumers, and existing coverage.
- [x] Add focused readiness contract tests that assert both success and failure public responses omit check details while preserving status codes.
- [x] Minimize public readiness responses without changing check execution or authenticated operational diagnostics.
- [x] Run focused health/security regression tests, lint/compile and scoped diff checks, then commit only this finding.

## Completed finding record

### P2 — Public readiness responses expose internal health details

- Local commit: `58dd07ec fix(security): minimize public readiness output`.
- Changed: `backend/app/health/router.py`, `backend/tests/health/test_operational_health.py`.
- Behavior: public `/health/ready` still performs the same checks and preserves its 200/503 semantics, but returns only `ready` or `not_ready`; the runtime-admin operational health route retains detailed diagnostics.
- Verified: focused operational-health suite (12 passed); security-hardening suite (7 passed); scoped Ruff; Python compilation; staged whitespace check.
- No migration was required. A repository-external monitor that parsed the former `checks` object must move to authenticated diagnostics or observability.

## Current finding

**P2 — API request logging deliberately drops events at its in-process backlog limit**

- Affected path: every FastAPI request → `api_logging_middleware` finally block → `_fire_and_forget_log` → one of up to 100 task-set entries → five-thread Supabase `api_logs` insert. The existing code returns early and increments `dropped_total` when the set is full.
- Failure model: high traffic or a slow telemetry database silently loses request audit/operational events exactly when they are most useful. The current health endpoint only reports loss after it has happened.
- Intended behavior: bound local log write concurrency/queue memory without deliberately discarding accepted request events. At capacity, await one existing write slot before scheduling the next log and report backpressure explicitly.
- Smallest coherent change: make dispatch asynchronous, replace the drop branch with bounded backpressure over the current task set, retain five-worker database writes and failure metrics, and expose backpressure rather than a false drop count in operational health. This intentionally trades bounded tail latency under a logging outage for event preservation while the process remains alive.

### Active micro-plan — bounded API-log backpressure

- [x] Trace middleware registration, task/executor lifecycle, database insert boundary, current health reporting, and existing observability coverage.
- [x] Add a focused saturation test proving a second log waits for capacity and is enqueued rather than dropped; preserve storage-failure coverage.
- [x] Replace the intentional drop path with bounded asynchronous backpressure and operational metrics that distinguish capacity pressure from write failure.
- [x] Run focused observability/health/bootstrap regression tests, lint/compile and scoped diff checks, then commit only this finding.

## Completed finding record

### P2 — API request logging deliberately drops events at its in-process backlog limit

- Local commit: `4a8a34fb fix(observability): backpressure api log writes`.
- Changed: `backend/app/bootstrap/middleware.py`, `backend/app/health/checks.py`, `backend/tests/observability/test_api_logging_health.py`, `backend/tests/health/test_operational_health.py`.
- Behavior: the 100-entry in-flight bound remains, but a saturated request waits for an existing write before scheduling its log instead of incrementing a drop counter and returning. Operational diagnostics now distinguish write failures (`degraded`) from capacity pressure (`warning`) with backpressure metrics.
- Verified: focused observability/operational-health/bootstrap suite (16 passed); scoped Ruff; Python compilation; staged whitespace check.
- No migration was required. This protects events while the API process remains alive; an abrupt process crash or a persistent telemetry-database failure still prevents a log write and is reported via the existing failure metric.

## Current finding

**P2 — Modal dialogs can lose their accessible name when a title is a React node**

- Affected path: any `Modal` caller supplies `title: ReactNode` → `ModalRoot` derives `aria-label` only when `typeof title === "string"` → the rendered `role="dialog"` has no programmatic name for a JSX/fragment title.
- Failure model: screen-reader users encounter an unnamed modal even though a visual header is present. Existing callers currently mostly pass strings, but the reusable component contract explicitly permits React nodes and must remain safe for them.
- Intended behavior: every open modal is named from its required title regardless of whether the title is text or JSX, without relying on visual header conventions at individual call sites.
- Smallest coherent change: generate a stable title ID, render the required title once in a screen-reader-only label node, and bind the dialog with `aria-labelledby`; keep visual children and close/focus behavior unchanged.

### Active micro-plan — modal accessible-name contract

- [x] Trace the reusable modal API, all callers, existing dialog browser assertions, and current static UI-audit seam.
- [x] Add focused static accessibility assertions for the generated label ID/binding and retain existing browser dialog-name coverage.
- [x] Bind each modal to a stable screen-reader title node for both string and React-node titles.
- [x] Run UI audit, targeted browser dialog regression, typecheck/lint/build and scoped diff checks, then commit only this finding.

## Completed finding record

### P2 — Modal dialogs can lose their accessible name when a title is a React node

- Local commit: `db6fc5a6 fix(a11y): name modal dialogs from titles`.
- Changed: `frontend/components/ui/Modal.tsx`, `frontend/scripts/verify-ui-audit.mjs`.
- Behavior: every `Modal` now has a stable `aria-labelledby` reference to a screen-reader-only rendering of its required title, so strings and JSX/fragment titles both produce a dialog name without changing visual headers or focus behavior.
- Verified: UI-audit script; frontend typecheck and lint; focused Chromium keyboard-shortcuts dialog/focus regression (1 passed); production build; staged whitespace check.
- No migration was required.

## Current finding

**P2 — Focus-trapped modal dialogs leave the background exposed to assistive technology**

- Affected path: `Modal`/`CommandPalette` portal roots → shared `useFocusTrap` → keyboard-only tab loop. The prior hook restores focus but leaves body siblings discoverable and operable through the accessibility tree while a `role="dialog"` is open.
- Failure model: screen-reader users can navigate into application content behind an active modal, contradicting the modal’s visual and keyboard interaction boundary.
- Intended behavior: portal-based modal dialogs preserve their focus loop and restoration while their body-sibling background is both inert and `aria-hidden`; nested isolated dialogs must restore each original state only after the final dialog closes.
- Smallest coherent change: add opt-in, reference-counted body-sibling isolation to the existing focus trap and enable it only for the two portal dialog consumers (`Modal` and `CommandPalette`), leaving ordinary popover focus traps unchanged.

### Active micro-plan — dialog background isolation

- [x] Trace focus-trap callers, portal topology, App Shell DOM boundary, existing dialog tests, and non-dialog popup callers.
- [x] Add static and Chromium coverage proving the dialog hides/inerts main-content ancestors while open and restores them after close.
- [x] Add opt-in reference-counted background isolation and enable it for portal dialogs without changing popup focus traps.
- [x] Run UI audit, focused modal/command-palette browser regressions, typecheck/lint/build and scoped diff checks, then commit only this finding.

## Completed finding record

### P2 — Focus-trapped modal dialogs leave the background exposed to assistive technology

- Local commit: `bc8e6b68 fix(a11y): isolate dialog backgrounds`.
- Changed: `frontend/lib/use-focus-trap.ts`, `frontend/components/ui/Modal.tsx`, `frontend/components/layout/CommandPalette.tsx`, `frontend/e2e/omnix-release.spec.ts`, `frontend/scripts/verify-ui-audit.mjs`.
- Behavior: modal and command-palette portal dialogs now make every body sibling inert and `aria-hidden` while open, restoring original states with reference counts for nested dialogs; non-modal popover focus traps remain unchanged.
- Verified: UI-audit script; frontend typecheck and lint; focused Chromium modal isolation/focus regression (1 passed) and command-palette navigation regression (1 passed); production build; staged whitespace check.
- No migration was required.

## Current finding

**P2 — API ingress lacks consistent CSP, Permissions-Policy, and transport/security headers**

- Affected path: client → direct/systemd FastAPI or production Compose Nginx → API/docs responses. Nginx supplies only older partial headers and the direct FastAPI path supplies none, so documented systemd deployment bypasses the proxy-only configuration entirely.
- Failure model: API documents and browser-rendered responses lack a consistent clickjacking, content-type, referrer, browser-feature, and CSP baseline. HSTS must never be asserted on cleartext-only ingress; the repository cannot prove the actual TLS terminator.
- Intended behavior: FastAPI and the bundled Nginx config apply equivalent conservative API security headers; FastAPI emits HSTS only when the request is securely terminated. API docs retain their required CDN/inline CSP exception, while normal API responses receive a restrictive `default-src 'none'` policy.
- Smallest coherent change: add a response-header middleware for direct FastAPI paths; harden the Nginx header block to the same baseline; test API/docs/HTTPS behavior plus static Nginx declarations. Do not include `includeSubDomains` or preload until all deployed hosts are confirmed HTTPS.

### Active micro-plan — API security-header baseline

- [x] Trace Compose, systemd/direct app, Nginx, frontend deployment, API docs CSP dependencies, and TLS termination constraints.
- [x] Add focused direct API/docs/HTTPS response tests plus static Nginx header coverage.
- [x] Apply compatible CSP, permissions, referrer/frame/content-type protections across direct app and Nginx; emit HSTS only for secure FastAPI requests.
- [x] Run focused security tests, lint/compile, Nginx syntax/config validation where locally available, and scoped diff checks before committing only this finding.

## Completed finding record

### P2 — API ingress lacks consistent CSP, Permissions-Policy, and transport/security headers

- Local commit: `93417099 fix(security): add api response headers`.
- Changed: `backend/app/bootstrap/app.py`, `backend/app/bootstrap/middleware.py`, `backend/tests/test_http_security_headers.py`, `nginx.conf`.
- Behavior: direct FastAPI and the bundled Nginx configuration now send CSP, Permissions-Policy, `DENY` frame protection, `nosniff`, modern referrer policy, and host-scoped HSTS. FastAPI uses a restrictive API CSP and a compatible Swagger/Redoc CSP exception; it sends HSTS only when the request scheme is HTTPS.
- Verified: API/docs/HTTPS/static-Nginx header suite plus CORS/security regressions (14 passed); scoped Ruff; Python compilation; staged whitespace check.
- No migration was required. `nginx -t` is blocked because the binary is not installed locally, and end-to-end HSTS verification remains blocked until the actual HTTPS terminator/deployed ingress can be inspected. The bundled config intentionally omits `includeSubDomains` and preload.

## Current finding

**P2 — Generated citations are prompt guidance, not verified evidence references**

- Affected path: retrieval/context prompt builders assign source labels → chat/streaming and ContextEngine action/insight generation → payload/artifact persistence → immediate and reloaded chat rendering.
- Failure model: the current payload marks every retrieved source as cited without inspecting the generated answer. A model can emit an unknown source label, omit citations entirely, or fabricate a label, and the UI has no distinct evidence-completeness signal.
- Intended behavior: verify post-generation citation labels against the assembled source set; remove unknown citation labels from the finalized answer; persist only labels actually used; distinguish supported, incomplete, unsupported, pending, and not-applicable evidence states without leaking source internals.

### Active micro-plan — post-generation citation validation

- [x] Add a pure, bounded citation validator with adversarial/edge-case unit coverage.
- [x] Persist pending validation before generation and validated citations/content after generation.
- [x] Return the sanitized final answer and validation state from both synchronous and streaming chat paths.
- [x] Apply the same contract to ContextEngine action/insight output and artifact persistence with stable, non-colliding prompt labels.
- [x] Render a visible, accessible incomplete/unsupported-evidence notice and reconcile it at stream completion.
- [x] Run focused backend/frontend/browser checks, review only scoped hunks, and commit locally without staging pre-existing work.

## Completed finding record

### P2 — Decision candidate scans silently exclude earlier, superseding, or later document context

- Local commit: `4e1eae56 fix(decisions): expose candidate source coverage`.
- Changed: decision-candidate API/schema/services, transcript and document-chunk window loaders, shared candidate-panel types/UI, and focused backend/browser/static tests.
- Behavior: each request now analyzes a bounded, offset-addressable source window instead of an opaque permanent `[-60:]` / `[:40]` slice. The service probes for another page, uses a stratified selector so early/middle/late records share the 9k prompt budget, returns source coverage and the next offset, and retains only server-verified evidence anchors. The review UI discloses source-window/context limits and can scan earlier conversation messages or the next document section without silently replacing prior candidates.
- Verified: backend decision/conversation/document/endpoint/platform suite (27 passed); scoped Ruff; Python compilation; frontend typecheck, lint, UI-audit, production build; focused Chromium continuation test (1 passed); staged whitespace check.
- No migration was required.
- Remaining product risk: one model call still evaluates a bounded source window. Stratified selection and explicit coverage prevent a false completeness claim, but automatic global reconciliation of a decision and a later supersession across multiple windows remains a larger decision-graph feature.

## Current finding

**P2 — Workspace conversation history is capped at 80 messages without visible pagination**

- Affected path: workspace conversation surface → channel/thread `GET /messages?limit=80` calls → backend offset pagination → visible message and thread panels → realtime/optimistic message reconciliation.
- Failure model: users cannot reach older root messages, and thread replies beyond the first 80 are silently unavailable. Reloads or realtime changes can also make a locally derived message count an unsafe pagination cursor.
- Intended behavior: preserve the existing bounded backend API, overfetch one record as a continuation probe, maintain server offsets independently of local/realtime state, merge pages chronologically without duplicate IDs/nonces, and provide keyboard-accessible controls for older channel messages and newer thread replies.
- Smallest coherent change: add frontend-only page state and dedicated continuation controls. Keep the existing channel newest-first backend query and thread oldest-first reply query unchanged, so main history loads earlier messages at the top while a thread loads newer replies at the bottom.

### Active micro-plan — conversation history pagination

- [x] Trace both backend pagination contracts, surface request lifecycle/realtime/optimistic flows, message/thread rendering, and existing E2E mock seams.
- [x] Add pure page-merge helpers and page state that overfetches one item, tracks server offsets separately, rejects stale responses, and resets correctly on channel/thread changes.
- [x] Add accessible continuation controls and live loading state to the main message and thread panels.
- [x] Add focused unit/static/browser coverage for root messages and thread replies, including offset correctness and no duplicate root/reply records.
- [x] Run focused frontend/backend/browser checks, review only scoped hunks, and commit locally without staging pre-existing work.

## Completed finding record

### P2 — Workspace conversation history is capped at 80 messages without visible pagination

- Local commit: `1188cf36 fix(conversations): paginate workspace history`.
- Changed: workspace conversation frontend page state, pagination controls, realtime/optimistic reconciliation, mock browser coverage, and stable `created_at`/`id` ordering for backend message windows.
- Behavior: root history now requests 81 records, retains the newest 80, and offers `Load Earlier Messages`; threads retain the oldest 80 replies and offer `Load Newer Replies`. The cursor remains server-offset based despite realtime/optimistic updates, page boundaries are deterministic when timestamps tie, and realtime replies merge without discarding already loaded pages.
- Verified: focused backend helper/conversation suite (9 passed); scoped Ruff and Python compilation; frontend typecheck, lint, UI audit, production build; focused Chromium pagination suite (2 passed); staged whitespace check.
- No migration was required.
- Remaining product risk: offset pagination can overlap while messages arrive between requests, but client deduplication and continued paging ensure the visible history converges. Cursor pagination would be a future scalability refinement for very high-volume channels.

## Current finding

**P2 — OCR coverage is bounded without a truthful source-coverage disclosure**

- Affected path: PDF extraction → bounded Tesseract pass → extraction diagnostics/metadata → ingestion state → Files status detail.
- Failure model: a PDF with more than `OMNIX_MAX_OCR_PAGES` can become `searchable` even though later image pages were never OCR’d; the UI currently implies the full `page_count` was extracted.
- Intended behavior: preserve the bounded OCR workload, but persist exact processed and omitted page counts and disclose that unprocessed pages are not searchable.
- Smallest coherent change: keep the metadata-only diagnostics contract (no schema migration), make the database-column payload explicit, calculate OCR coverage on successful bounded OCR, and render a truthful Files-page detail.

### Active micro-plan — OCR coverage truthfulness

- [x] Trace the OCR cap, extraction diagnostics, metadata/database persistence, ingestion state, API response, and Files status rendering.
- [x] Add OCR processed/omitted page metadata without attempting to write non-column fields to `files`.
- [x] Render a precise accessible status detail for partially OCR-covered documents.
- [x] Add focused extraction, ingestion-persistence, and Files-model/browser coverage for capped OCR.
- [x] Run scoped backend/frontend/browser checks, review only scoped hunks, and commit locally without staging pre-existing work.

### P2 — OCR coverage is bounded without a truthful source-coverage disclosure

- Local commit: `60c4fcd0 fix(ocr): disclose bounded source coverage`.
- Changed: extraction diagnostics now record exact OCR processed/omitted-page counts and completion state in existing file metadata; direct column writes are explicitly limited to the established schema; the Files status detail explains when later pages were not OCR-indexed.
- Behavior: a 25-page OCR pass over a 30-page scan remains bounded, but users now see that only the first 25 pages are searchable and that 5 pages were omitted. Older OCR imports without coverage metadata avoid claiming full page coverage.
- Verified: focused extraction and ingestion tests (15 passed); scoped Ruff and Python compilation; frontend typecheck, lint, UI audit, production build; focused Chromium Files disclosure regression (1 passed); scoped/staged whitespace checks.
- No migration was required: the new diagnostics live in the existing `files.metadata` JSON object. The existing OCR cap intentionally remains a capacity safeguard.

## Completed finding record

### P2 — Generated citations are prompt guidance, not verified evidence references

- Local commit: `877ceca4 fix(ai): validate generated source citations`.
- Changed: a bounded post-generation validator now accepts only assembled `S#`/`W#` labels, removes unknown labels without exposing them in public diagnostics, records verified citations only, and distinguishes pending, supported, incomplete, unsupported, and not-applicable states. It is applied to synchronous chat, stream completion, message persistence/fallback metadata, ContextEngine actions/insights, and generated artifacts/automation metadata.
- Context labels: the legacy ContextEngine now assigns stable labels once before splitting workspace and other source blocks, so prompt references and returned source records agree without duplicate label collisions.
- UI: the live stream replaces raw token output with the finalized content at `done`; reloaded messages parse the persisted validation contract; incomplete/unsupported evidence receives a visible accessible notice.
- Verified: focused backend/context/action/insight/router suite (49 passed); scoped Ruff; Python compilation; frontend typecheck, lint, UI-audit, focused Chromium stream-result test (1 passed), and production build; staged whitespace check passed.
- No migration was required.
- Blocked broader lint/check: the pre-existing unstaged `messages.py` hunk removes the `ModelServiceError as exc` binding while retaining `exc` references, and pre-existing instruction-file whitespace also makes a worktree-wide `git diff --check` fail. Neither was staged or changed by this commit.
- Remaining product risk: this validates citation identifiers and evidence availability, not semantic claim entailment or a claim-level coverage score; that richer analysis remains Top 10 Feature 3.

## Current finding

**P2 — Decision candidate scans silently exclude earlier, superseding, or later document context**

- Affected path: workspace decision-candidate endpoints → `conversation_decision_candidates` / `document_decision_candidates` → transcript/document loaders → bounded source catalog → model extraction → candidate panel.
- Failure model: conversation scans load only the newest 60 messages and then a 9k-character prompt catalog; document scans load up to 500 chunks but keep only the first 40. A result containing no candidates therefore looks complete even when relevant source material was never inspected.
- Intended behavior: retain a bounded model call, but make each source window explicit and navigable rather than permanently discarding earlier messages or later document sections; make prompt-budget exclusions visible in the API and review UI.
- Smallest coherent change: replace the two fixed source-record slices with offset-addressable scan windows that probe one extra record for continuation; use a stratified prompt selector so early/middle/late source context competes fairly for the bounded prompt; expose selected/prompt-included counts and a next window cursor, then let the review UI scan the next bounded window on demand.

### Active micro-plan — decision source coverage

- [x] Trace the endpoint, authorization, transcript/chunk ordering, prompt budget, candidate evidence normalization, response schema, and both candidate panels.
- [x] Add bounded, offset-addressable source windows rather than `[-60:]` / `[:40]`, with a coverage result that cannot claim complete inspection when capped.
- [x] Add focused backend tests for old conversation and late-document evidence, stratified prompt selection, partial-coverage behavior, and response validation.
- [x] Add typed, accessible UI coverage disclosure for both conversation and document candidate scans plus a focused Chromium continuation regression.
- [x] Run focused backend/frontend/browser checks, review only scoped hunks, and commit locally without staging pre-existing work.

## Current finding

**P2 — Dashboard loading skeletons provide no status announcement**

- Affected path: App Router loading/Suspense fallbacks → shared `PageSkeleton` → every dashboard route that dynamically waits for page content.
- Failure model: the visual skeleton is correctly decorative, but its `aria-hidden` root leaves screen-reader users with no indication that a dashboard route is loading.
- Intended behavior: retain the non-semantic visual skeleton while exposing one concise, polite, atomic loading status for every shared fallback use.
- Smallest coherent change: add a screen-reader-only `role="status"` announcement outside the hidden skeleton, with a semantic loading message and no per-page duplication.

### Active micro-plan — loading status semantics

- [x] Trace all shared `PageSkeleton` fallback call sites and existing live-region conventions.
- [x] Add an accessible, concise loading announcement while keeping placeholder geometry hidden.
- [x] Add focused static coverage, then run frontend checks, review scoped hunks, and commit only this finding.

### P2 — Dashboard loading skeletons provide no status announcement

- Local commit: `eb4b5c97 fix(a11y): announce dashboard loading`.
- Changed: the shared dashboard fallback now exposes a concise polite, atomic `Loading page…` status while retaining `aria-hidden` visual placeholder geometry; the UI-audit runner verifies both sides of that contract.
- Verified: frontend typecheck, lint, UI-audit, and production build; staged whitespace check.
- No migration was required. The shared fallback deliberately uses one generic route-loading message; individual in-surface asynchronous operations retain their own controls/statuses.

## Current finding

**P2 — Decorative ambient effects run on every authenticated route**

- Affected path: persistent dashboard `AppShell` → particle/blur/scanline nodes plus the authenticated-shell animated grid pseudo-element → all authenticated routes.
- Failure model: route transitions retain thirty particle nodes and continuous blur/grid/scanline animation even on focused productivity surfaces such as chat, files, and settings.
- Intended behavior: keep the command-center visual language on `/dashboard`, but make all other authenticated routes static while preserving reduced-motion behavior everywhere.
- Smallest coherent change: gate the decorative nodes and grid-drift class by `usePathname()`, using a dashboard-only class rather than a global motion preference or a new runtime dependency.

### Active micro-plan — route-scoped ambient work

- [x] Trace AppShell persistence, particle/ambient/grid CSS, reduced-motion behavior, and existing browser/static test seams.
- [x] Gate decorative nodes and grid drift to the dashboard route only.
- [x] Add dashboard/non-dashboard browser and static contract coverage; run frontend checks/build, review scoped hunks, and commit only this finding.

### P2 — Decorative ambient effects run on every authenticated route

- Local commit: `6559369b fix(perf): scope ambient shell effects`.
- Changed: persistent `AppShell` now renders particle, blur, scanline, and accent nodes only on `/dashboard`; the animated grid pseudo-element is likewise scoped to an explicit dashboard class, while reduced-motion support stays intact.
- Verified: frontend typecheck, lint, UI-audit, production build, and focused Chromium dashboard/non-dashboard plus reduced-motion regressions (2 passed); staged whitespace check.
- No migration was required. The dashboard intentionally retains its ambient treatment; the improvement removes continuous decorative work from the other authenticated productivity surfaces rather than eliminating the design system globally.

## Current finding

**P2 — Storage lifecycle leaves orphaned objects and non-retryable deletion failures**

- Affected path: direct uploads and Google Drive imports write physical storage before their `files` metadata row; file deletion currently removes the metadata row before physical storage.
- Failure model: a metadata-insert failure leaves an untracked object, while a storage deletion failure removes the row needed to retry cleanup. Derived document chunks can also outlive a deleted source.
- Intended behavior: compensate for failed final metadata registration, and make deletion retryable by removing physical storage before logical records, while retaining the established missing-object response behavior.
- Scope boundary: account/workspace retention, historical orphan reconciliation, versioning, and a durable cleanup outbox need a separate lifecycle policy and worker; this bounded fix does not claim to solve those cross-cutting cases.

### Active micro-plan — storage lifecycle safety

- [x] Trace upload/import registration, deletion order, document-chunk ownership, queue failure behavior, and existing dirty-file overlap.
- [x] Add best-effort rollback after a failed final metadata registration for direct uploads and Drive imports, without deleting retryable enqueue failures.
- [x] Delete physical objects before derived chunks, file metadata, and activity logging; preserve retryability if storage deletion fails.
- [x] Add focused rollback/order/error-path tests, run the scoped suite and lint/compile checks, then commit only these hunks.

### P2 — Storage lifecycle registration and deletion safety

- Local commit: `5f5a72de fix(storage): make file lifecycle retryable`.
- Changed: direct uploads and Google Drive imports now best-effort discard a newly written object only if final file-metadata registration fails; enqueue failures intentionally retain their file/object state for retry. File deletion now removes the physical object before scoped document chunks and file metadata, so a storage-backend error leaves the logical records available to retry. Existing missing-object behavior still responds with `200 {"storage_missing": true}` after logical cleanup.
- Scope safety: document cleanup matches existing storage scope—workspace chunks use `file_id + workspace_id`; personal chunks use `file_id + user_id + workspace_id is null`—so artifact documents that intentionally share the polymorphic `file_id` field are not deleted.
- Verified: rollback/order/error focused suite (24 passed); adjacent files/artifacts/document-context/ingestion integration suite (18 passed); scoped Ruff, Python compilation, and staged whitespace checks all passed.
- No migration was required.
- Remaining lifecycle risk: there is still no retention/versioning policy, durable cleanup outbox, historical orphan reconciler, account-deletion object cleanup, or tombstone/worker recheck to make deletion atomic with an already-running ingestion job. Those need an explicitly designed lifecycle policy and background cleanup flow rather than an unsafe inline expansion.

## Current finding

**P1 — The aggregate workspace context still couples independent frontend domains**

- Affected path: authenticated dashboard layout → `WorkspaceProvider` → memoized tree, membership, and intelligence contexts → merged `WorkspaceContext` / `useWorkspace()` → dashboard, collaboration, chat, workspace, team, onboarding, settings, access, and sidebar consumers.
- Failure model: any tree, membership, invite, or intelligence change creates a new aggregate context value and re-renders every remaining broad consumer, even when that consumer reads only one domain. This preserves the oversized global invalidation boundary identified by the audit despite the existing narrow contexts.
- Intended behavior: preserve one active-workspace owner, storage key, request-generation guard, and provider lifecycle, while making production consumers subscribe explicitly to only the tree, membership, and/or intelligence contexts they use.
- Smallest coherent change: migrate the remaining aggregate consumers to existing narrow hooks, remove only the merged context/value/export, and retain the current provider nesting and all active-workspace reconciliation logic.

### Active micro-plan — retire aggregate workspace context

- [x] Trace the provider graph, active-workspace lifecycle, narrow context values, aggregate consumers, and existing switching/static test seams with Graphify and source inspection.
- [x] Migrate each broad consumer to explicit tree, membership, and intelligence hooks without moving fetch ownership or changing mutation semantics.
- [x] Remove the aggregate context/value/type/export and add a source-contract regression that prevents its reintroduction.
- [x] Run focused context tests, active-workspace browser switching coverage, typecheck, lint, production build, and scoped diff checks; commit only after all pass.

### P1 — Aggregate workspace context invalidation boundary

- Local commit: `aef2d9ab fix(frontend): retire aggregate workspace context`.
- Changed: the merged `WorkspaceContext` / `WorkspaceContextType` / `useWorkspace()` API is removed. Dashboard, team, workspace, chat, collaboration, onboarding, settings, access, invite, and sidebar consumers now subscribe directly to only their existing tree, membership, and/or intelligence contexts. `WorkspaceProvider` retains the same active-selection owner, request-generation guards, polling, reconciliation, mutations, confirmation modal, and provider ordering.
- Architecture: this follows the React split-hook rule and avoids routing shell-wide providers differently; tree, membership, and intelligence values remain independently memoized, so a domain update no longer invalidates consumers solely through an aggregate object.
- Verified: focused workspace-context suite (12 passed after correcting one over-broad test assertion); frontend typecheck, lint, UI-audit, production build; focused Chromium workspace-switch persistence regression (1 passed); scoped/staged whitespace checks.
- No migration was required.

## Current finding

**P1 — Workspace authorization is coupled to the aggregate workspace service**

- Affected path: every workspace domain service imports access resolution, common models/constants, and membership hydration through the 869-line `workspace_service` facade; access resolution itself performs service-role reads that bypass RLS.
- Failure model: authorization or workspace-schema changes require synchronized edits across otherwise independent search, decision, task, initiative, conversation, collaboration, connector, mention, intelligence, and continuity paths. A future domain can also import a convenient trusted helper without making its access prerequisite explicit.
- Intended behavior: one narrow service owns workspace-record compatibility reads and hierarchy/membership authorization; domain services import authorization, common values, and membership hydration from their actual owning modules rather than the aggregate facade. Existing router/public imports remain compatible.
- Smallest coherent change: extract the existing access algorithm without changing its rules, keep compatibility exports in `workspace_service`, move service-to-service imports to narrow modules, and add architecture plus access-rule regressions. This does not add a schema migration.

### Active micro-plan — workspace authorization boundary

- [x] Trace workspace access resolution, trusted Supabase behavior, hierarchy rules, domain-service imports, dirty-file overlap, and existing isolation tests.
- [x] Extract a narrow access module while preserving private/global/founder/direct-membership semantics and sanitized failures.
- [x] Remove aggregate `workspace_service` dependencies from workspace domain services by importing access/common/membership owners directly.
- [x] Add focused access and architecture tests, then run hierarchy, membership, search, decision, task, initiative, conversation, connector, collaboration, continuity, and security regressions.
- [x] Run scoped Ruff/compile/diff checks and commit only the verified finding without staging pre-existing work.

### P1 — Workspace authorization boundary and service decoupling

- Local commit: `cde3cf27 fix(auth): isolate workspace access boundary`.
- Changed: one canonical `workspace_access_service` now owns workspace-record compatibility reads, private/global/founder/direct-membership access resolution, management checks, active-workspace header handling, and resource ownership checks. `workspace_service` retains identity-preserving compatibility exports, while workspace domain services import authorization, common values, and membership hydration from their narrow owners.
- Architecture: membership no longer dynamically imports the aggregate workspace service, and an AST regression prevents domain services from reintroducing aggregate imports for authorization/common/membership contracts. The access boundary continues to apply exact `{workspace_id, user_id}` membership filters before granting access and sanitizes trusted-query failures.
- Verified: focused boundary/modularity/hierarchy/subspace suite (22 passed); workspace domain service/router suite (104 passed); adjacent security/platform/retrieval/router suite (72 passed); scoped Ruff on the complete working files; Python compilation; staged whitespace and secret scans. Staged-only Ruff still reports three pre-existing dirty-file issues whose fixes remain intentionally unstaged with the user's work.
- No migration was required.
- Remaining P1 risk: trusted Supabase helpers still use the service role and bypass RLS. Domain reads/writes remain caller-scoped rather than capability-enforced, core workspace-table RLS/live Data API grants are not proven from local code, and real database isolation/advisor checks remain outstanding.

## Current finding

**P1 — Trusted Supabase helpers permit implicit unscoped operations**

- Affected path: backend service-role client → generic `select_*_trusted` / `update_*_trusted` / `delete_*_trusted` helpers → user-facing workspace services and system jobs. Supabase service/secret keys bypass RLS, so an empty or omitted filter reaches the full table.
- Failure model: a caller regression can turn a trusted read, update, or delete into an unbounded cross-tenant operation. Three legitimate system scans currently omit filters, but they are indistinguishable from an accidental omission.
- Intended behavior: every trusted read/mutation is filtered by default; unscoped multi-row reads require a named, reviewable system reason; trusted mutations and single-row reads never accept an empty filter. No raw filter values or credentials are logged.
- Smallest coherent change: enforce the contract in the shared sync/async helper boundary, annotate the three intentional system scans, and add runtime plus AST regressions that reject future implicit full-table calls.

### Active micro-plan — fail-closed trusted query scopes

- [x] Inventory every trusted read/mutation call and identify the only three intentional unscoped reads.
- [x] Add shared fail-closed filter validation to sync/async trusted single reads and mutations.
- [x] Require a non-empty system reason for unscoped trusted multi-row reads and annotate scheduler, re-embedding, and preflight scans.
- [x] Add focused helper and repository architecture tests, run affected job/scheduler/query/security suites, then lint/compile/diff-check and commit only after green.

### P1 — Fail-closed service-role query scopes

- Local commit: `1c5a4ca1 fix(security): reject unscoped trusted queries`.
- Changed: sync and async trusted single-row reads, updates, batch updates, and deletes now reject empty filters before creating a Supabase query. Trusted multi-row reads are also filtered by default; the only intentional full-system scans declare literal reasons for automation scheduler startup, re-embedding pagination, and the bounded startup embedding sample.
- Architecture: a repository-wide AST regression fails on any future implicit unscoped `select_all_trusted` call and inventories every explicit system reason. Rejected operations never reach the service-role client and log only the operation/table, not filters, row data, or credentials.
- Verified: trusted helper contract (16 passed); adjacent query, queue, ingestion, workspace-domain, storage, retrieval, automation, and security suite (220 passed); scoped Ruff; Python compilation; staged whitespace and secret scans.
- No migration was required.
- Remaining infrastructure risk: service/secret keys still bypass RLS by design. Real Supabase workspace isolation, Data API grants, advisors, and RLS policies require live integration verification; filtered application helpers reduce blast radius but are not a substitute for database enforcement.

## Current finding

**P1 — Connector service-role operations are not bound to an authorized workspace capability**

- Affected path: authenticated connector router → connector locator/full-row load → workspace source authorization → retry/activation/update/delete → setup-job and source-file cleanup.
- Failure model: connector lookup currently hydrates `config` and `last_error` by connector ID before workspace authorization, while create, retry, and activation updates use connector ID alone. Because trusted queries bypass RLS, a future authorization or ID-routing regression would expose or mutate cross-workspace connector state with a wider blast radius than necessary.
- Intended behavior: use an ID-only minimal locator to discover the workspace, authorize source access, then hydrate the connector with exact `{id, workspace_id}` filters; bind every trusted connector mutation to that same workspace scope.
- Smallest coherent change: add a minimal connector locator projection, re-fetch the full row only after authorization, centralize workspace-scoped connector filters, and apply them to create/retry/knowledge-link updates without changing router contracts or connector behavior.

### Active micro-plan — connector capability scope

- [x] Trace connector router entry points, access policy, lookup/hydration, setup jobs, retry, knowledge-link activation, source cleanup, serialization, and current tests.
- [x] Add the authorization-before-hydration boundary and workspace-bind every trusted connector mutation.
- [x] Add focused regressions for denied access, authorized re-fetch order/scope, and create/retry/activation mutation filters.
- [x] Run focused and adjacent connector/security suites, scoped Ruff/compile/diff checks, then commit only after green.

### P1 — Workspace-scoped connector capabilities

- Local commit: `aebbb569 fix(security): bind connectors to workspace scope`.
- Changed: connector-by-ID requests now load only `id,workspace_id`, authorize workspace source access, normalize denied/nonexistent resources to the same 404, and only then hydrate connector configuration with exact `{id, workspace_id}` filters. Listing, setup jobs, source cleanup, file/chunk creation, activity events, and every connector update/delete use the authorized `WorkspaceAccess.workspace_id` rather than trusting a previously hydrated row.
- Regression contract: a source-level AST test requires all eight trusted connector-row mutations to use the capability-derived workspace filter; runtime tests prove denied callers never hydrate configuration, authorized call order is locator → authorization → scoped hydration, and create/retry/activation mutations retain workspace scope.
- Verified: focused connector service suite (18 passed); connector/access/document-context/hierarchy/security suite (42 passed); scoped Ruff, Python compilation, and staged whitespace review.
- No migration was required.
- Remaining P1 risk: other ID-addressed service-role paths still hydrate resource content before authorization or mutate by ID alone (workspace bootstrap, conversations, files, artifacts, and invites). Live database RLS/Data API verification remains an infrastructure check.

## Current finding

**P1 — Artifact content is hydrated before tenant authorization**

- Affected path: authenticated artifact list/get/export → service-role artifact locator/full-row query → personal ownership or workspace membership authorization → response/download. Artifact mutation paths already use metadata-only locators and tenant-scoped writes.
- Failure model: get/export currently load full artifact content by ID before checking ownership or workspace access, and the personal list filters only by creator ID, so workspace artifacts authored by that user can bleed into the personal metadata view. Service-role access bypasses RLS.
- Intended behavior: personal lists require `workspace_id IS NULL`; ID-addressed reads load only `id,workspace_id,user_id`, authorize that tenant scope, normalize denied/nonexistent resources to the same 404, and then hydrate content with exact personal or workspace filters.
- Smallest coherent change: centralize a read-only artifact scope resolver and authorized hydrator, reuse it for get/export, and retain the existing scoped mutation behavior.

### Active micro-plan — artifact read capability scope

- [x] Trace personal/workspace list, create, get, export, update, delete, RAG ingestion/chunk cleanup, mutation policy, trusted filters, and focused security tests.
- [x] Add metadata-only locator authorization before content hydration and exclude workspace artifacts from the personal list.
- [x] Add focused denied-access, call-order, tenant-filter, and personal-list regressions.
- [x] Run focused and adjacent artifact/retrieval/security suites, scoped Ruff/compile/diff checks, then commit only after green.

### P1 — Authorized artifact content hydration

- Local commit: `c0daacdb fix(security): authorize artifact content hydration`.
- Changed: personal artifact lists now require both the current user and `workspace_id IS NULL`; artifact get/export first load only `id,workspace_id,user_id`, authorize personal ownership or workspace membership, normalize denied/nonexistent IDs to one 404, and re-fetch content with exact tenant filters. Update/delete continue using metadata-only locators and already-scoped writes, while inaccessible mutation locators now also avoid an existence oracle.
- Verified: focused artifact security suite (8 passed); artifact/error-sanitization/document-context/workspace-access/prompt-trust suite (24 passed); scoped Ruff, Python compilation, and staged whitespace review.
- No migration was required.
- Remaining P1 risk: other service-role ID locators (workspace conversations, files, workspace access bootstrap, and invite acceptance) still need capability-bound review; artifact RAG ingestion remains intentionally best-effort after an authorized write.

## Current finding

**P1 — Conversation rows and updates are not bound to an authorized tenant scope**

- Affected path: authenticated conversation list/get/update and file-conversation resolution → service-role conversation query → personal ownership or workspace membership authorization → title/metadata response or update.
- Failure model: conversation-by-ID currently hydrates the full row before authorization, workspace updates filter only by ID, and the personal list lacks `workspace_id IS NULL`, allowing workspace-authored conversations to enter personal history queries. Trusted workspace operations bypass RLS.
- Intended behavior: locate only `id,user_id,workspace_id`, authorize ownership or workspace membership, normalize denied/nonexistent IDs to one 404, re-fetch with exact tenant filters, and reuse that same scope for updates.
- Smallest coherent change: add a conversation locator projection and scope helper, use them in access resolution and updates, and make the personal list explicit.

### Active micro-plan — conversation tenant capability

- [x] Trace create/list/history preview/get/update, active-workspace resolution, file-conversation dependency, trusted/untrusted query paths, and available tests.
- [x] Add locator-before-hydration authorization, tenant-scoped re-fetch/update filters, and explicit personal-list scope.
- [x] Add focused denied-access, call-order, update-filter, and personal-list regressions in a new isolated router test.
- [x] Run focused and adjacent conversation/file/security suites, scoped Ruff/compile/diff checks, then commit only after green.

### P1 — Tenant-scoped conversation access

- Local commit: `17b0ed49 fix(security): scope conversation resource access`.
- Changed: conversation-by-ID access now locates only `id,user_id,workspace_id`, authorizes personal ownership or workspace membership, normalizes denied/nonexistent IDs to one 404, then hydrates with exact personal or workspace filters. Workspace and personal updates reuse the same tenant filters, and personal history explicitly requires `workspace_id IS NULL`.
- Verified: focused conversation security suite (4 passed); direct conversation/file/workspace-service suite (23 passed); message/upload/file dependent suite (27 passed); scoped Ruff, Python compilation, and staged whitespace review.
- No migration was required. The new focused test was force-added because the repository globally ignores new `test_*.py` files.
- Remaining P1 risk: file rows still expose storage/extraction fields before access and delete by ID alone; workspace access bootstrap still hydrates broad configuration before membership; invite acceptance remains non-atomic.

## Current finding

**P1 — File storage metadata and deletion are not bound to an authorized tenant scope**

- Affected path: file list/download/delete and conversation-scoped file resolution → service-role file query → personal ownership or workspace membership authorization → storage read/delete → document/file cleanup.
- Failure model: file-by-ID currently loads storage paths, metadata, extraction failures, and processing errors before authorization; final file deletion filters only by ID; and personal lists lack `workspace_id IS NULL`. A missed guard therefore has broader service-role and storage impact than necessary.
- Intended behavior: locate only `id,user_id,workspace_id`, authorize ownership or workspace membership, hydrate the full file with exact tenant filters, use that capability for document/file deletion and activity scope, and keep personal listings separate.
- Smallest coherent change: introduce locator and scope helpers, canonicalize effective workspace IDs from access, and update the clean API/lifecycle tests without modifying the user's dirty storage-missing test.

### Active micro-plan — file storage capability scope

- [x] Trace create/list/conversation resolution/download/delete, storage backends, document cleanup order, activity logging, trusted filters, lifecycle tests, and dirty-test overlap.
- [x] Add authorization-before-storage-metadata hydration, tenant-scoped final deletion, canonical workspace scope, and explicit personal-list scope.
- [x] Add focused denied-access, call-order/storage-read, personal-list, and workspace/personal deletion-filter regressions.
- [x] Run focused and adjacent file/upload/ingestion/security suites, scoped Ruff/compile/diff checks, then commit only after green.

### P1 — Tenant-scoped file and storage access

- Local commit: `cfc8187e fix(security): bind file access to tenant scope`.
- Changed: file-by-ID access now loads only `id,user_id,workspace_id`, authorizes ownership or workspace membership, then hydrates storage/extraction metadata with exact tenant filters. Denied/nonexistent resources share one 404; effective workspace IDs come from the authorization capability; personal file lists require `workspace_id IS NULL`; document cleanup, final file deletion, and activity logging use the authorized personal/workspace scope.
- Verified: focused file API/lifecycle/storage-missing suite (15 passed); adjacent file/upload/Drive/document-context/ingestion suite (64 passed); scoped Ruff, Python compilation, and staged whitespace review. The user's dirty `test_files_storage_missing.py` import cleanup remained unstaged and unchanged.
- No migration was required.
- Remaining P1 risk: workspace access itself still hydrates broad workspace configuration before membership; invitation acceptance remains non-atomic. Physical storage deletion and relational cleanup remain a retryable saga rather than one transaction by design.

## Current finding

**P1 — Workspace capability bootstrap hydrates broad configuration before membership**

- Affected path: every workspace-protected router/service → `resolve_workspace_access` → child/parent workspace reads → direct/parent membership resolution → returned `WorkspaceAccess`.
- Failure model: the service-role bootstrap currently reads full workspace rows—including AI instructions and intelligence preferences—before checking exact membership. Unauthorized callers do not receive the row today, but any missed guard or diagnostic regression has a larger in-process exposure surface.
- Intended behavior: read only authorization-relevant locator fields first, resolve exact direct/parent membership and hierarchy rules, then hydrate full workspace records only for an established capability; fail closed if authority fields change between locator and hydration.
- Smallest coherent change: add hierarchy/legacy locator fallbacks, reuse the existing full-record compatibility fallback only after preliminary authorization, and validate authority signatures before returning access.

### Active micro-plan — workspace bootstrap capability

- [x] Trace current/hierarchy/legacy schema fallbacks, direct/private/global/founder rules, parent validation, membership filters, compatibility exports, and hierarchy/access tests.
- [x] Add locator-only preliminary authorization and post-authorization full hydration with authority-field race validation.
- [x] Update fallback tests and add focused denied/no-hydration plus authorized call-order regressions.
- [x] Run focused hierarchy/subspace/domain/security suites, scoped Ruff/compile/diff checks, then commit only after green.

### P1 — Authorized workspace capability hydration

- Local commit: `ce4a4f5a fix(security): defer workspace hydration until authorized`.
- Changed: workspace access now uses hierarchy-aware or legacy `id,user_id` locators plus exact membership reads to resolve top-level, private child, global child, and parent-founder authority before selecting full workspace rows. Authorized hydration retains current/hierarchy/legacy schema compatibility and fails closed if owner, parent, type, or global authority fields change between locator and full read.
- Verified: focused access/hierarchy suite (14 passed); complete workspace service plus hierarchy/subspace/router suite (122 passed); cross-router/platform/security suite (59 passed, with existing FastAPI `on_event` deprecation warnings only); scoped Ruff, Python compilation, staged whitespace review, and the 233-line module remained under its 240-line architecture threshold.
- No migration was required.
- Remaining P1 risk: invitation acceptance/decline/revoke still need scoped reads/writes, and acceptance has a real membership-versus-revocation race that requires an atomic database function. Live Supabase RLS/Data API verification remains external.

## Current finding

**P1 — Workspace invite acceptance can race revocation and create unauthorized membership**

- Affected path: authenticated invite accept/decline and manager revoke → invite lookup/status check → membership insert → invite state update → workspace hydration/activity.
- Failure model: acceptance currently inserts membership and marks the invite accepted in separate service-role requests, so a concurrent revoke/decline can win between them while membership still persists. Accept/decline read by ID before email validation, and accept/decline/revoke updates are ID-only.
- Intended behavior: lock and validate the invite by ID plus authenticated email, create/idempotently preserve membership, and mark acceptance in one database transaction; all other transitions condition on exact invite capability plus `status=pending`.
- Smallest coherent change: add one service-role-only atomic acceptance RPC, replace the Python multi-write flow with its explicit outcome contract, and scope decline/revoke locators and conditional writes.

### Active micro-plan — atomic invitation transitions

- [x] Trace invite schemas, role normalization, create/list/accept/decline/revoke routes, membership uniqueness, activity/enrichment, RPC/grant conventions, and migration tests.
- [x] Add a row-locking acceptance RPC with idempotent membership insertion, fixed search path, and service-role-only execute grant.
- [x] Replace Python acceptance writes with the RPC and make decline/revoke exact pending-state transitions.
- [x] Add focused RPC outcome, race-contract, locator/filter, grant, and migration regressions.
- [x] Run focused/adjacent suites, SQL/static checks, mandatory `npx supabase db push`, then scoped Ruff/compile/diff checks and commit only after all green.

### P1 — Atomic workspace invitation transitions

- Local commit: `448d8887 fix(security): make invite acceptance atomic`.
- Changed: invite acceptance now calls a single `SECURITY INVOKER` RPC that binds the invite to the authenticated email, locks it, preserves an existing membership or inserts one once, and consumes the pending invite in the same transaction. Decline and revoke now use minimal locators plus exact workspace/email/pending-state conditional writes and report a lost race without logging success.
- Database: migration `0054_workspace_invite_atomic_acceptance.sql` was applied to the linked Omnix project. Live verification confirms invoker security, an empty function search path, no execute privilege for `anon` or `authenticated`, and execute privilege for `service_role`; linked `public` schema lint found no errors. The CLI's optional local migration-catalog cache refresh was blocked because Docker Desktop is not running, after the remote migration had completed successfully.
- Verified: focused invite/RPC/migration suite (22 passed); adjacent invite/hierarchy/access/security suite (63 passed); scoped Ruff, Python compilation, and staged whitespace review.
- Remaining P1 risk: live `workspace_invites` and `workspace_members` grants still give `anon` and `authenticated` direct table access. Existing live policies do not safely bind invite updates to the authenticated email and expose membership rows too broadly, so Data API access remains a separate P1 finding.

## Current finding

**P1 — Direct Data API grants bypass workspace invitation and membership isolation**

- Affected path: Supabase `anon`/`authenticated` Data API roles → direct `workspace_invites` and `workspace_members` table privileges → permissive live RLS policies.
- Failure model: the linked project currently grants broad table privileges to browser-facing roles. The invite update policy does not bind the invite email to the caller, and the membership SELECT policy effectively exposes all valid workspace membership rows. Repository clients use backend routes rather than direct access, so these grants create avoidable BOLA and membership-disclosure paths.
- Intended behavior: invitations and all membership mutations are backend-only. `PUBLIC` and `anon` have no collaboration-table privileges; `authenticated` retains only policy-filtered membership SELECT because existing browser-facing RLS policies depend on it; `service_role` retains trusted backend access.
- Smallest coherent change: revoke broad browser-facing grants, then restore only authenticated membership SELECT behind a tenant-scoped non-recursive policy and a hardened access helper.

### Active micro-plan — close collaboration Data API grants

- [x] Reconfirm every repository read/write/realtime dependency and capture the linked table grants and policies.
- [x] Add focused grant and RLS-dependency migrations with static regression tests.
- [x] Run affected collaboration/security tests, apply both migrations with `npx supabase db push`, and verify live privileges, authenticated-role dependency queries, and schema lint.
- [x] Run scoped quality checks and commit only after all checks are green.

### P1 — Collaboration Data API privilege boundary

- Local commit: `8baf8e75 fix(security): restrict collaboration table grants`.
- Changed: direct invitation-table access and all membership mutations are denied to `PUBLIC`, `anon`, and `authenticated`; `service_role` retains backend access. Authenticated membership SELECT is restored only through a tenant-scoped RLS policy because multiple browser-facing collaboration policies depend on membership reads. The shared access helper now has an empty search path and explicit execute grants.
- Database: migrations `0055_workspace_collaboration_backend_only.sql` and `0056_workspace_membership_rls_dependencies.sql` were applied to the linked Omnix project. Live ACL inspection confirms invitations are service-role-only, membership grants are service-role plus authenticated SELECT only, and no `PUBLIC`/`anon` collaboration privileges remain. Linked schema lint reports no errors.
- Live integration: an authenticated-role, read-only synthetic nonmember smoke correctly receives `42501` for invitations, sees zero membership rows, and successfully evaluates all dependent Realtime/read policies for channels, channel messages, activity events, tasks, initiatives, initiative channels, mentions, and presence without recursion.
- Verified: focused migration suite (2 passed); collaboration/invite/hierarchy/access/security suite (65 passed); scoped Ruff, format, Python compilation, and staged whitespace review.
- Operational note: each remote migration completed successfully; the CLI's optional local migration-catalog cache refresh remains unavailable because Docker Desktop is not running.
- Remaining P1 risk: Supabase security advisors still report explicit `anon` execution on several `SECURITY DEFINER` policy helpers and the schema-health RPC despite historical `PUBLIC` revokes. Those live grants require an explicit role-hardening pass.

## Current finding

**P1 — Anonymous callers can execute public SECURITY DEFINER helpers**

- Affected path: PostgREST `/rpc` exposure → explicit/default execute grants on public `SECURITY DEFINER` functions → workspace access predicates and schema metadata.
- Failure model: `anon` can currently execute conversation, channel, and decision access helpers plus the schema-health RPC with the function owner's privileges. The access predicates bind to `auth.uid()` and normally return false anonymously, but the grants unnecessarily expose privileged functions; schema health also reveals detailed table, column, foreign-key, and policy metadata. Three helpers retain a mutable `public` search path.
- Intended behavior: policy access predicates remain executable only by `authenticated` and `service_role`; schema health is backend-only; `anon` and `PUBLIC` execute are explicitly revoked; every affected definer function uses an empty search path.
- Smallest coherent change: one grant-hardening migration with an explicit role matrix and search-path alterations, followed by advisor, catalog, policy-smoke, and backend schema-health verification.

### Active micro-plan — harden definer function grants

- [x] Inventory every public SECURITY DEFINER function, live execute grants, policy dependencies, and direct RPC callers.
- [x] Add the explicit revoke/regrant and search-path migration with a focused static regression.
- [x] Apply the migration, verify the live role matrix and advisors, and rerun authenticated policy plus schema-health checks.
- [x] Run affected tests and scoped quality checks, then commit only after green.

### P1 — SECURITY DEFINER role and search-path hardening

- Local commit: `127d9b89 fix(security): harden definer function grants`.
- Changed: all five public definer functions now use an empty search path and explicit role grants. Conversation, channel, decision, and task access predicates are executable only by `authenticated` and `service_role` because RLS policies require them; schema health is service-role-only; `PUBLIC` and `anon` cannot execute any definer function.
- Database: migration `0057_security_definer_role_grants.sql` was applied to the linked Omnix project. Catalog verification confirms the exact role matrix, schema health still returns all 10 required table diagnostics for its trusted caller, and linked schema lint reports no errors.
- Live integration: authenticated policy reads for channels, channel messages, decisions, decision tasks, and tasks matched privileged baselines exactly. Security advisors no longer report anonymous definer execution or schema-health exposure. The four authenticated helper warnings are intentional policy dependencies and expose only caller-bound booleans.
- Verified: focused migration test (1 passed); affected workspace/schema-health/conversation/decision/task suite (74 passed, with existing FastAPI `on_event` deprecation warnings only); scoped Ruff, format, Python compilation, and staged whitespace review.
- Remaining P1 risk: the live `authority_revocations` insert policy applies to `PUBLIC` with `WITH CHECK (true)`, while `anon` and `authenticated` have INSERT privileges. Any browser caller can forge authority-revocation events for arbitrary users/workspaces.

## Current finding

**P1 — Browser roles can forge authority-revocation events**

- Affected path: direct Data API INSERT → `authority_revocations` public permissive policy → Realtime subscription → client authority invalidation.
- Failure model: `PUBLIC`, `anon`, and `authenticated` inherit a `WITH CHECK (true)` INSERT policy and browser roles have full table grants. A caller who knows user/workspace UUIDs can publish a fake membership/role/workspace revocation and force another client to discard trusted workspace state.
- Intended behavior: only the service-role backend can insert revocation events; authenticated users retain SELECT-only access to their own rows for Realtime delivery; anonymous callers have no table privilege; service-role insertion remains compatible with the trusted backend helper.
- Smallest coherent change: revoke broad grants, grant authenticated SELECT only and service-role SELECT/INSERT, recreate only the explicit authenticated own-row SELECT policy, and remove the unnecessary insert policy because service role bypasses RLS.

### Active micro-plan — make authority revocation backend-only

- [x] Trace the backend emitter, frontend Realtime consumer, schema constraints/publication, live grants, and policies.
- [x] Add a least-privilege grant/policy migration with a focused static regression.
- [x] Run emitter/collaboration tests, apply the migration, and verify live grants, advisors, authenticated Realtime reads, and denied browser inserts.
- [x] Run scoped quality checks and commit only after green.

### P1 — Backend-only authority revocation publishing

- Local commit: `29df0720 fix(security): restrict authority revocation publishing`.
- Changed: `authority_revocations` now grants authenticated users SELECT only, grants the service role SELECT/INSERT only, and grants nothing to `PUBLIC` or `anon`. The permissive public insert policy was removed; the remaining SELECT policy is explicitly authenticated and binds `(select auth.uid())` to `user_id`.
- Database: migration `0058_authority_revocation_role_boundary.sql` was applied to the linked Omnix project. Live ACL/policy inspection matches the intended matrix, schema lint is clean, and the Supabase permissive-policy advisor finding is gone.
- Live integration: synthetic authenticated and anonymous inserts fail with `42501`; a service-role insert using valid foreign keys succeeded inside an explicit rollback transaction; follow-up marker queries confirmed zero persisted verification rows; authenticated nonmember reads return zero rows; the table remains in `supabase_realtime`.
- Verified: focused migration test (1 passed); authority-emitter/invite/hierarchy/access suite (42 passed); scoped Ruff, format, Python compilation, and staged whitespace review.
- Operational note: migration application succeeded; only the optional Docker-backed local migration-catalog cache refresh remains unavailable.

## Current finding

**P2 — Mobile conversation threads are unreachable**

- Affected path: conversation channel selection → message list → thread-open state and `data-thread` surface attribute → responsive CSS for `.omnix-conversation-thread` → thread close/back control.
- Failure model: the base stylesheet hides the thread pane and only restores it at tablet/desktop breakpoints, so selecting a thread on a phone changes state without exposing the thread content or a usable return path.
- Intended behavior: below the tablet breakpoint, opening a thread replaces the message list with the thread pane; closing/back returns to the same channel message list. Desktop split-pane behavior must remain unchanged.
- Smallest coherent change: reuse the existing thread state and surface attribute to switch the two panes only at the mobile breakpoint, with no new navigation state or layout refactor.

### Active micro-plan — mobile conversation thread mode

- [x] Trace the complete open/close state, rendered controls, responsive rules, test fixtures, and current mobile navigation contract.
- [x] Add the smallest mobile-only pane switch and preserve desktop split-pane behavior.
- [x] Add focused static and mobile-browser regressions for open, visible thread, close/back, and restored message list.
- [x] Run the focused UI audit and mobile E2E, then typecheck, lint, build, diff review, and commit only after green.

### P2 — Mobile conversation thread mode

- Local commit: `f48c9732 fix(mobile): make conversation threads reachable`.
- Changed: the conversation workbench now switches from the channel message list to the thread pane below 48rem whenever the existing thread state is open. Closing the 44px thread control restores the same channel message list; tablet replacement and desktop three-pane behavior remain unchanged.
- Coverage: the mobile regression exercises open, loaded reply visibility, close, and restored channel context at 375px, 390px, and 768px. The existing paginated history/thread scenario now explicitly enters the selected channel when it runs in mobile Chromium.
- Verified: the focused test failed before the CSS fix with `data-thread="open"` while the message pane remained visible; `npm run test:ui-audit`; focused mobile thread E2E (1 passed); adjacent pagination/thread E2E in desktop and mobile Chromium (2 passed); `npm run typecheck`; `npm run lint`; `npm run build`; dev-server browser checks showed meaningful content, no framework overlay, and no captured console errors; scoped whitespace and diff review passed.
- No migration was required.

## Current finding

**P2 — File retention, versioning, replacement cleanup, and historical orphan reconciliation are absent**

- Affected path: every local/Supabase object write → `files` metadata registration → ingestion and derived document rows → storage-path replacement or file/account deletion → durable job worker and queue recovery.
- Failure model: the retryable inline delete fix covers explicit API deletion, but an out-of-band row cascade can still orphan bytes; replacing `storage_path` has no historical record or guaranteed old-object cleanup; there is no explicit retention expiry; and objects left by historical registration failures cannot be discovered.
- Intended behavior: every registered object has an immutable version record; replacement and row deletion create durable, deduplicated cleanup work in the same database transaction; explicit per-file retention can enqueue safe expiry; cleanup retries through the existing durable queue; and a bounded, grace-period orphan scan can reconcile both supported storage backends without deleting an object that has since become active.
- Smallest coherent design: use database triggers/backfill for source-independent version tracking and cleanup intents, reuse the existing jobs/recovery worker instead of adding a second queue, expose only authorized retention/version metadata, and keep physical object enumeration in the storage abstraction. The database trigger avoids modifying the user's dirty Google Drive router.

### Active micro-plan — durable file lifecycle

- [x] Finish tracing file/account/workspace cascades, storage backends, job claim/retry semantics, grants/RLS, and every dirty-file overlap.
- [x] Add forward-only migrations for version records, retention state, transactional replacement/delete cleanup intents, safe deduplication, atomic expired-file enqueue, and dead-letter resumption.
- [x] Add bounded local/Supabase object enumeration, lifecycle job handlers, active-reference rechecks, worker maintenance scheduling, and retry-safe logical cleanup.
- [x] Add authorized, paginated file-version and retention endpoints without exposing version storage paths or trusted lifecycle tables.
- [x] Add focused migration, storage, handler, worker, API, race, replacement, expiry-retry, and orphan tests.
- [x] Run focused and adjacent suites, mandatory `npx supabase db push`, live catalog/RPC/grant checks, lint/compile/diff review, then commit only after green.

### P2 — Durable file version, retention, and orphan lifecycle

- Database: the two CLI-created migrations were applied to the linked Omnix project. Existing stored files were backfilled one-for-one into backend-only immutable version history. Insert, replacement, deletion, orphan deduplication, expiry queuing, dead-letter expiry resumption, service-role execution, and rollback cleanliness passed live transactional verification.
- Runtime: replacement/deletion triggers create deduplicated durable jobs containing only version identifiers and SHA-256 cleanup keys. The primary worker retries physical cleanup, rechecks active references immediately before deletion, schedules due retention, and performs bounded grace-period orphan scans for local and Supabase storage. Failed expiry jobs can be resumed after their active attempt leaves the queue.
- API: authorized callers can read paginated version metadata without storage paths. Uploaders and workspace managers can set or clear timezone-aware future retention while an in-progress expiry is protected by an atomic lifecycle-state filter.
- Security: `file_versions` and `jobs` have no browser-role table privileges; lifecycle RPCs use empty search paths and explicit service-role-only grants. The only new advisor item is the intentional informational “RLS enabled, no policy” notice for the backend-only version table; new indexes are unused immediately after creation as expected.
- Verified: 94 focused/adjacent backend tests; scoped Ruff and Python compilation; two mandatory remote `npx supabase db push` runs; live catalog, ACL, RLS, function, trigger, backfill, service-role, transactional lifecycle, retry, advisor, and rollback checks. Docker Desktop remains unavailable only for the CLI's optional local migration-catalog cache.
- Local commit: `d72e7c85 fix(storage): make file lifecycle durable`.

## Current finding

**P2 — API shutdown hook pretends to drain workers**

- Affected path: process termination signal → Uvicorn connection/task drain → FastAPI shutdown event → API-log background tasks → vector/Supabase/Redis cleanup → container stop deadline.
- Failure model: the shutdown hook logs that it is draining workers but only sleeps for 500 ms. API workers do not own the separately deployed ingestion/OCR processes, so that message is false; meanwhile real app-owned API-log tasks are not awaited and the Redis client initialized at startup is never closed. Production Compose also relies on Docker's short default stop deadline instead of giving Uvicorn an explicit bounded request/SSE drain.
- Intended behavior: Uvicorn stops admission and drains active HTTP/SSE work within a documented limit; once lifespan shutdown starts, the API waits a bounded interval for its own queued log writes, closes every initialized async client independently, and reaches `terminated` even when one cleanup fails. Standalone job workers retain their separate, already-tested in-flight drain.
- Smallest coherent change: remove the fake worker sleep, add a bounded API-log drain and Redis close primitive, orchestrate those with existing vector/Supabase cleanup, and align the Uvicorn and container grace windows without touching the dirty streaming router.

### Active micro-plan — bounded API process shutdown

- [x] Trace Uvicorn/FastAPI shutdown ordering, streaming-response lifetime, API-log task ownership, Redis/Supabase/vector resources, worker-process isolation, and deployment stop timing.
- [x] Add bounded app-owned task draining and idempotent Redis cleanup; replace placeholder orchestration while keeping cleanup failures isolated.
- [x] Configure explicit Uvicorn and container grace windows that leave time for lifespan cleanup.
- [x] Add focused drain, timeout, cleanup-order/failure, client-close, and deployment-contract tests.
- [x] Run focused and adjacent bootstrap/observability/health tests, Compose/static validation, scoped Ruff/compile/diff checks, then commit only after green.

### P2 — Bounded API process shutdown

- Runtime: Uvicorn remains responsible for stopping admission and draining active HTTP/SSE connections. The FastAPI shutdown hook now waits up to the configured 10 seconds for its own API-log writes, cancels only unfinished wrappers at the deadline, closes vector state, the async Supabase pool, and the cached Redis client independently, then publishes a terminal runtime state.
- Deployment: both the image default and production override set a 30-second Uvicorn graceful-shutdown limit. Compose grants the container 45 seconds, leaving 10 seconds for app-owned log work and a 5-second cleanup margin after request draining.
- Isolation: ingestion/OCR jobs continue to use their standalone worker signal and in-flight job drain; the API no longer claims to drain processes it does not own. The dirty chat streaming router was not changed.
- Verified: focused shutdown/logging suite (8 passed); adjacent bootstrap, health, observability, runtime, and production topology suite (68 passed); Compose canonical validation; scoped Ruff, Python compilation, staged whitespace and diff review.
- No migration was required.
- Local commit: `919df8ef fix(reliability): drain api shutdown work`.

## Current finding

**P2 — Schema compatibility reads hide unapplied migrations**

- Affected path: workspace list/access queries → shared async/sync Supabase selectors → missing-column/schema-cache error → automatic column removal or empty-result substitution → legacy workspace column retry → normalized defaults.
- Failure model: missing required workspace columns can be silently removed from reads, and trusted reads can convert a schema error into `[]`/`None`. Workspace authorization then retries progressively older shapes and normalizes absent hierarchy/authority fields, making a partially migrated deployment look like valid legacy data instead of an operational failure.
- Intended behavior: selectors execute the requested projection exactly once. Missing required columns remain database errors, are sanitized at the service boundary, and are visible to readiness/schema-health diagnostics. Workspace authority and hydration use only the current schema.
- Smallest coherent change: remove automatic missing-column recovery from shared selectors, remove current→hierarchy→legacy workspace retries in the clean access module, retain unrelated explicit feature-specific compatibility paths, and convert the existing recovery tests into fail-closed regressions.

### Active micro-plan — fail closed on schema drift

- [x] Trace workspace access/list hydration, selector recovery behavior, schema-health coverage, migration ownership, explicit legacy consumers, and existing regressions.
- [x] Make sync/async selectors preserve the exact requested projection and propagate sanitized database failures.
- [x] Make workspace locator/hydration use only current required columns without editing the user's dirty facade module.
- [x] Replace fallback tests with single-attempt, no-empty-substitution, and sanitized workspace failure tests.
- [x] Run focused selector/workspace/schema-health tests, then adjacent backend suites, scoped Ruff/compile/diff checks, and commit only after green.

### Red-flag micro-plan — restore the committed full-suite baseline

- [x] Confirm the four full-suite failures are in untouched committed files and are unrelated to the selector change.
- [x] Update stale focus-trap and CSS-motion assertions to the behavior introduced by earlier audit commits.
- [x] Extract the file source card so the files page regains its enforced reviewability threshold.
- [x] Isolate the Ollama URL test from the developer's ignored `backend/.env`.
- [x] Run the four failed tests, frontend typecheck/lint/build, and the full backend suite; commit these baseline repairs separately before resuming the schema-drift commit.

### Red-flag resolution — committed baseline tests restored

- Updated stale static assertions to recognize focus-background isolation and the CSS-only, reduced-motion-aware page transition introduced by earlier audit commits.
- Extracted `FileSourceCard` without changing file actions or virtualization behavior; the files page is 897 lines and again satisfies its 900-line reviewability guard.
- The Ollama test now clears cached settings and explicitly overrides `OLLAMA_BASE_URL`, so an ignored developer environment file cannot change its expected endpoint.
- Verified: 25 directly affected tests; backend Ruff for modified tests; frontend typecheck, lint, and production build; full backend suite (609 passed).
- Local commit: `17d5d18b test: restore audit regression baseline`.

### P2 — Fail-closed schema projections

- Shared Supabase selectors now execute exactly the caller-requested projection once. A missing column or stale PostgREST schema cache can no longer be silently removed, retried as `*`, or converted to an empty trusted result.
- Workspace access locators require all hierarchy/authority fields and hydrated workspace reads require the current full projection. Both boundaries return the existing sanitized database error instead of interpreting incomplete rows as legacy top-level workspaces.
- The user's dirty `workspace_service.py` facade was not edited. Deliberate, feature-specific compatibility paths in profiles, initiatives, and ingestion remain separate follow-up debt rather than being broadened into this cited workspace finding.
- Verified: focused selector/workspace/schema-health suite (39 passed); full backend suite (609 passed); scoped Ruff, Python compilation, staged whitespace and diff review.
- No migration was required.

## Current finding

**P2 — Search destinations do not consistently open focused records**

- Affected path: ranked search SQL projection → Supabase RPC result → backend grouping/schema → command palette `router.push` → task, initiative, decision, file, source, automation, and activity destinations.
- Failure model: SQL-provided URLs are passed through unchanged. Task, initiative, and decision query parameters currently select their detail panes, but files and connectors ignore their IDs, document rows without a file fall back to a broad page, and automation/activity rows point to routes that do not exist.
- Intended behavior: every result returned by ranked search has one canonical same-origin route that renders and focuses the matching workspace record. Records without a real focus surface are not advertised as navigable search results.
- Smallest coherent change: add stable detail-route aliases for supported ranked entities, make files/connectors visibly focus their route target, remove automation/activity and detached-document rows from the ranked projection until dedicated detail surfaces exist, and validate ranked destinations at the backend boundary.

### Active micro-plan — focused ranked-search destinations

- [x] Trace SQL URL creation, RPC passthrough, API schemas, both frontend search consumers, destination route handling, and current test coverage.
- [x] Add a forward-only migration with canonical supported detail URLs, unsupported-result filtering, and preserved RPC role boundaries.
- [x] Make the existing focused query routes hydrate and focus file/connector targets while retaining query-link compatibility.
- [x] Reject non-canonical ranked destinations at the backend boundary and remove stale invalid helper URLs.
- [x] Add migration, service, frontend contract, and browser navigation regressions.
- [x] Run focused tests, mandatory `npx supabase db push`, live RPC/grant verification, frontend typecheck/lint/build, scoped backend checks, diff review, then commit only after green.

### P2 — Focused ranked-search destinations

- Ranked search now emits only task, initiative, decision, file, file-backed document, and source records with canonical internal destinations. Unsupported automation, activity, job, and detached-document results are omitted until they have real detail surfaces.
- The backend reconstructs every supported route instead of trusting database-provided URLs. Document links are accepted only when they are same-origin `/files` URLs with a single file identifier and an optional matching document identifier.
- File and source query routes now load targets outside the initial file page, switch to the correct surface, reveal the matching card, scroll it into view with reduced-motion support, and move keyboard focus to it. The authorized single-file endpoint redacts storage paths.
- Database: CLI-created migration `20260729092313_focused_workspace_search_routes.sql` was applied to the linked project. Live catalog verification confirms invoker security, an empty search path, authenticated/service-role execution only, focused URL branches, and omission of unsupported/detached results. Docker Desktop remains unavailable only for the CLI's optional local migration-catalog cache.
- Verified: focused backend/frontend contract suite (26 passed); ranked-result browser navigation in desktop and mobile Chromium (4 passed); agent-browser content/overlay/console inspection; frontend typecheck, lint, and production build; scoped Ruff and Python compilation; full backend suite (614 passed); staged whitespace and complete diff review.
- Local commit: `09087d2f fix(search): focus ranked result destinations`.

## Current finding

**P2 — Data fetching uses overlapping caches and bespoke request lifecycles**

- Affected path: active-workspace change → mutable API workspace header → low-level GET dedupe → custom query cache/invalidation → conversation channel snapshot → Realtime/channel mutation reconciliation.
- Failure model: the custom query cache and API client both deduplicate GETs. Forced reads can rejoin an older transport request; invalidation leaves pending reads alive; old completions can repopulate or overwrite cache; an older `finally` can delete a newer pending entry; and the workspace header is read after asynchronous token lookup instead of being captured with the request. The cited conversation surface compensates with request/revision refs, while message/thread error and loading paths are not fully workspace/channel guarded.
- Intended behavior: one server-state cache owns deduplication, TTL/staleness, transient retry, invalidation, cancellation, and observable loading/error state. Every request keeps the workspace identity captured at invocation. Conversation channels use that cache as their sole snapshot source; Realtime changes cancel an older snapshot before updating cached data; message/thread pagination retains only its domain-specific continuation guards.
- Smallest coherent design: adopt TanStack Query behind the existing `queryGet`/invalidation bridge, pass its abort signal through the API client, add one authenticated-shell provider, and migrate only the audit-cited conversation-channel snapshot in this finding. Preserve task/initiative mutation behavior for the next dedicated optimistic-rollback finding, while fixing the adjacent initiative workspace-ref defect exposed by the trace.

### Active micro-plan — normalize query and conversation fetch lifecycles

- [x] Trace the shared query helper, transport dedupe/header timing, workspace invalidation, all query consumers, conversation snapshot/realtime/pagination paths, and available tests.
- [x] Replace overlapping cache ownership with a configured TanStack Query client and compatibility bridge; capture workspace headers and make GET cancellation/identity race-safe.
- [x] Move conversation channels to a query-backed hook with standardized loading/error/retry/stale behavior and cancellation-safe Realtime cache updates.
- [x] Harden message/thread stale error/loading cleanup and keep only pagination-specific request guards; fix the initiative workspace-ref switch defect.
- [x] Add deterministic cache/retry/cancellation contracts plus browser workspace-switch, stale-response, retry, and conversation regressions.
- [x] Run focused tests first, fix failures, then typecheck, lint, UI audit, production build, full backend/integration checks, complete diff review, and commit locally only after green.

## Completed finding record

### P2 — Data fetching uses overlapping caches and bespoke request lifecycles

- Local commit: `a35e3995 fix(frontend): normalize query lifecycle`.
- Changed: replaced the bespoke query map with a configured TanStack Query client and authenticated-shell provider; captured request workspace identity before asynchronous auth; made transport/query cancellation, deduplication, retry, staleness, and invalidation race-safe; migrated conversation channels to a query-backed snapshot with Realtime cache projection; and hardened message, thread, and initiative workspace-switch guards.
- Behavior: forced reads and invalidation cancel older work, immediate `invalidate(); reload()` paths cannot reuse fresh stale data, old requests keep their original workspace header, transient query failures retry once, client errors do not retry, and stale channel/message/thread responses cannot overwrite the newly selected workspace or channel.
- Verified: query lifecycle contracts across desktop/mobile Chromium (12 passed); synchronized workspace-switch/retry/discussion/initiative browser coverage; complete E2E matrix (79 passed, 7 intentional project skips); frontend lint, typecheck, UI audit, and 39-route production build; scoped frontend contract suite (12 passed); full backend suite (614 passed); dependency tree and staged whitespace review.
- Dependency audit: TanStack Query introduced no reported advisory. The production tree still reports three pre-existing high-severity advisories through Next.js/PostCSS/Sharp; preserve this as a remaining dependency-upgrade risk rather than applying an unrelated broad audit fix in this finding.
- No migration was required.

## Current finding

**P2 — Optimistic mutation and rollback behavior is inconsistent across domains**

- Affected path: workspace/member/invite mutation helpers plus task, initiative, and conversation creation/update flows → optimistic local projections → backend idempotency/client-nonce behavior → rollback/error state → query invalidation and Realtime reconciliation.
- Failure model: pending records and flags are owned independently by each surface; some failures roll back, some leave stale local state, repeated activation can submit twice before React disables a control, and slow mutation completions can update a newly selected workspace or channel.
- Intended behavior: changed surfaces use one explicit mutation lifecycle—synchronous duplicate-submit guard, scoped optimistic projection, exact rollback on failure, workspace/resource identity guards on every completion path, and canonical invalidation/reconciliation after success.

### Active micro-plan — normalize optimistic mutation lifecycle

- [x] Inventory every optimistic mutation, submit guard, rollback path, client nonce, backend idempotency constraint, Realtime reconciliation path, and existing focused test.
- [x] Select the smallest shared lifecycle boundary and changed surfaces required to make pending/success/failure behavior consistent without broad state-library migration.
- [x] Add synchronous duplicate-submit and workspace/resource completion guards, exact rollback, and canonical invalidation for each changed surface.
- [x] Add focused deterministic tests for duplicate submit, rollback, slow workspace/channel mutation completion, and Realtime/optimistic deduplication.
- [x] Run focused tests and fix failures before lint, typecheck, UI audit, build, full regression/integration checks, scoped diff review, and a local commit.

### Selected lifecycle boundary

- Add one frontend-only mutation lifecycle helper for synchronous per-key exclusion, semantic-attempt nonce reuse, and field-conditional rollback. It owns no server state and leaves TanStack Query as the canonical invalidation/refetch boundary.
- Apply it to the audit-cited workspace rename/delete flow and the task, initiative, channel-create, conversation-send, and message-derived task/decision mutation surfaces. Every completion path must prove that its initiating workspace, resource, and current mutation token still match before changing visible state.
- A failed optimistic patch restores only fields that still contain that mutation's optimistic values; it must not replace a whole object or forest and erase a newer mutation, Realtime row, or refetch.
- Conversation failure reconciliation must not mark a row failed when Realtime already replaced the optimistic row with a committed server record carrying the same nonce. Failed sends restore the untouched draft and retain the semantic-attempt nonce so an explicit retry is idempotent.
- Keep user-dirty workspace/initiative/message backend files out of this finding. Missing server idempotency for workspace and decision creation, scoped initiative detach compare-and-set semantics, and chat-stream workspace cancellation remain explicit risks unless a clean frontend boundary can fully contain them.

### Red-flag micro-plan — adversarial optimistic-race review

- [x] Reconcile task/initiative canonical snapshots before late transport failures, release abandoned A→B→A lanes, and scope failures/assistance completions exactly.
- [x] Rebase concurrent workspace rename/delete overlays onto canonical hierarchy refreshes, make loading and active-selection ownership revision-safe, and invalidate deleted descendant caches.
- [x] Compose conversation failures by key/token; repair modal scope reuse, task-conversion response loss, channel selection ownership, thread-root counts, and delayed member hydration.
- [x] Re-run every focused deterministic and browser regression before advancing to broad integration checks.

### Red-flag follow-up — final canonical and scope closure

- [x] Await task/initiative response-loss reconciliation, retire successful overlays on newer canonical versions, and preserve same-resource PATCH serialization across workspace A→B→A transitions.
- [x] Apply active workspace projections to partial tree/subspace refreshes and make their auth/request ownership and cleanup identity-safe.
- [x] Resolve abandoned discussion/thread failures, scope AI/candidate requests, and force-read canonical messages before declaring a response-loss send failed.

## Completed finding record

### P2 — Optimistic mutation and rollback behavior is inconsistent across domains

- Local commit: `4da9de2 fix(workspaces): make optimistic mutations race-safe`.
- Changed: introduced one frontend mutation lifecycle for synchronous per-resource exclusion, semantic-attempt nonce reuse, scoped projections, field-conditional rollback, canonical reconciliation, and token-owned error/loading cleanup across workspace hierarchy, tasks, initiatives, channels, messages, threads, AI assistance, and message-derived task/decision conversions.
- Backend: added durable decision `client_nonce` replay recovery with a per-workspace/user/nonce unique constraint so response-loss retries return the original decision without duplicating mentions, activity, or candidate metrics.
- Race guarantees: stale A→B→A completions cannot replace current state; same-resource patches retain server ordering; canonical refreshes rebase active workspace projections; successful Realtime or forced-read reconciliation wins over late transport failures; abandoned scoped failures are removed exactly.
- Database: `20260824135906_workspace_decision_client_nonce.sql` was applied and `npx supabase db push` reports the remote database up to date.
- Verified: focused lifecycle contracts (56 passed); focused decision service tests (15 passed); full backend suite (619 passed); full desktop/mobile browser matrix (285 passed, 25 intentional skips); frontend lint, typecheck, UI audit, and 39-route production build; full whitespace and patch-boundary review.

## Current finding

**P2 — Modal accessibility**

- Affected path: shared `Modal` → portal rendering → `useFocusTrap` initial focus/background isolation/focus restoration → shared modal consumers; plus connector setup, workspace membership confirmation, and discussion-derived task/decision overlays that visually behave as dialogs without dialog semantics or containment.
- Failure model: the shared primitive accepts arbitrary React nodes as its accessible name, cannot expose a deterministic description, and does not focus the dialog itself when no control is available. Several custom overlays bypass dialog semantics, focus trapping, background inerting, Escape/backdrop behavior, and opener restoration entirely.
- Intended behavior: every modal surface uses one dialog boundary with a string accessible name, optional description, topmost-scoped Escape/backdrop dismissal, focus containment/restoration, and inert/`aria-hidden` background isolation; busy dialogs disable every dismissal route consistently.

### Active micro-plan — normalize modal semantics and focus behavior

- [x] Trace the shared modal, portal, focus-trap, all semantic and visual dialog surfaces, busy close behavior, existing axe coverage, and keyboard regressions.
- [x] Harden the shared primitive and focus trap with deterministic naming/descriptions, dialog fallback focus, consistent dismissal controls, and mobile overscroll containment.
- [x] Migrate the remaining visual modal overlays to the shared boundary without changing their form/mutation behavior.
- [x] Add focused axe and keyboard tests for initial focus, Tab/Shift+Tab containment, Escape/backdrop/cancel, busy dismissal, inert background, and opener focus restoration.
- [x] Run focused tests and fix failures before lint, typecheck, UI audit, build, full regression/integration checks, scoped diff review, and a local commit.

## Completed finding record

### P2 — Modal accessibility

- Local commit: `f5e49fe fix(accessibility): standardize modal behavior`.
- Changed: the shared modal now requires a deterministic string name, exposes optional descriptions and dialog/alertdialog roles, provides fallback dialog focus, contains consumed Escape behavior, blocks Escape/backdrop/Cancel/close together while busy, and applies mobile overscroll containment.
- Focus: background siblings are reference-counted as both inert and `aria-hidden`; Tab/Shift+Tab remain contained; pointer dismissal restores the opener on the next frame without overriding deliberate caller focus.
- Coverage: connector setup, document decision suggestions, membership confirmation, and message-derived task/decision overlays now use the shared semantic boundary instead of raw portals. Destructive confirmations use `alertdialog` and dialog form controls have associated names.
- Structure: extracted `DocumentDecisionSuggestionsModal` keeps the files page at 872 lines and preserves its source-coverage contract; the duplicate document-only portal was removed.
- Verified: focused modal/axe/keyboard matrix (19 passed, 1 intentional skip); external scope-change race regressions (4 passed); file/command architecture contracts (9 passed); full backend suite (619 passed); full desktop/mobile browser matrix (295 passed, 25 intentional skips); frontend lint, typecheck, UI audit, and 39-route production build.
- No migration was required.

## Current finding

**P2 — Loading and dynamic announcements**

- Affected path: shared alert/error/loading primitives; authenticated-shell realtime state; file upload progress and processing result; mention and invite notification changes; chat conversation loading and streamed-response lifecycle.
- Failure model: the dashboard route skeleton is already announced, but conversation and notification skeletons have no meaningful loading status, offline realtime swaps out of the only live status, upload progress has visual-only state, invite/count changes are not consistently announced, and chat streams every token through a live region instead of bounded lifecycle updates.
- Intended behavior: decorative loading remains hidden while a concise status stays exposed; persistent live regions announce state transitions atomically; progress is keyboard/screen-reader discoverable without reading every network tick; success and failure use consistent polite/assertive semantics; streamed response text is not replayed token by token.

### Active micro-plan — normalize loading and dynamic announcements

- [x] Trace shared announcement primitives, route/conversation/notification loading, realtime state, upload lifecycle, mention/invite delivery, chat streaming, and current browser/source coverage.
- [x] Add the smallest shared live-region semantics and correct conflicting alert/error roles without duplicating announcements.
- [x] Add bounded realtime, upload, notification/invite, conversation-loading, and chat-stream lifecycle announcements with semantic progress.
- [x] Add focused screen-reader DOM contracts and browser checks for live-region text, progress values, loading exposure, and keyboard-reachable state.
- [x] Run focused tests and fix failures before lint, typecheck, UI audit, build, full regression/integration checks, scoped diff review, and a local commit.

## Completed finding record

### P2 — Loading and dynamic announcements

- Local commit: `eab90cf4 fix(accessibility): announce dynamic state changes`.
- Added an atomic shared live-region primitive and consistent polite/assertive semantics for alerts, toasts, and error states; the realtime shell now has one persistent announcement owner and its visual offline warning does not duplicate it.
- Conversation and notification loading expose concise status text while decorative skeletons remain hidden. Notification counts, new mentions, invite arrival/actions, and sign-out errors use stable announcement channels.
- Upload rows announce start, queue/processing/success/failure without speaking every progress tick; the visual meter is now a named semantic progressbar with current values.
- Chat announces responding, complete, failure, and keyboard-triggered stop states instead of streaming generated tokens through a live region. Cancellation retains canonical reconciliation and a Retry state without raising a false send-failure banner.
- Verified: focused screen-reader/keyboard matrix (20 passed); complete desktop/mobile browser matrix (313 passed, 25 intentional project skips); full backend suite (619 passed); frontend lint, typecheck, UI audit, and 39-route production build; staged whitespace and patch-boundary review.
- No migration was required.

## Current finding

**P1 — Mobile navigation coverage**

- Affected path: root viewport metadata → authenticated shell sizing → fixed mobile dock/sidebar/modal safe-area padding → direct dock and drawer navigation → chat composer, conversation thread panes, dense forms, long titles, and horizontally wide tables.
- Failure model: direct phone navigation and thread replacement already exist, but the root viewport does not opt into `viewport-fit=cover` or keyboard-driven content resizing, leaving existing safe-area variables ineffective at some device edges and allowing overlay-keyboard behavior. Side insets are missing from the dock/modal and the sidebar header does not reserve the top notch. Coverage stops short of a full tablet navigation pass and does not prove keyboard shrink, long-title containment, wide-table scrolling, or short-viewport modal scrolling.
- Intended behavior: every core domain has an explicit visible route; fixed/mobile surfaces respect all safe-area edges; focused composers stay above the dock when the viewport shrinks; long content cannot widen the document; wide tables scroll within their container; threads and modal bodies remain independently usable at phone/tablet sizes.

### Active micro-plan — close mobile platform and coverage gaps

- [x] Trace dock/drawer destinations, authenticated shell sizing, viewport metadata, conversation/thread switching, safe-area CSS, table wrappers, modal scroll boundaries, and existing phone/tablet tests.
- [x] Add the smallest viewport and safe-area fixes without changing desktop navigation or removing functionality.
- [x] Extend focused mobile DOM coverage across 375px, 390px, 768px, and touch-tablet widths for discoverability, keyboard shrink, long titles, tables, threads, and modal scrolling.
- [x] Run focused tests and fix failures before lint, typecheck, UI audit, build, full backend/browser integration, scoped diff review, and a local commit.

## Completed finding record

### P1 — Mobile navigation coverage

- Local commit: `663d382f fix(mobile): keep navigation clear of device UI`.
- Root viewport metadata now opts into `viewport-fit=cover` and `interactive-widget=resizes-content`; the authenticated app uses a constrained `100dvh` frame with domain surfaces as explicit scroll owners, so a focused chat composer stays above the dock when keyboard height reduces the viewport.
- The mobile dock reserves left, right, and bottom device insets; the drawer header reserves the top inset; modal backdrops/cards reserve every relevant edge while shared dialogs keep fixed headers/footers around independently scrollable bodies.
- Direct dock/drawer routes keep Decisions, Initiatives, Settings, Team, and Analytics visible without gestures. Navigation and conversation/thread replacement are verified at 375px, 390px, 768px, and 820px.
- Added containment checks for long task titles, local scrolling for wide generated tables, short-height modal scrolling, dense task-surface scrolling, touch-tablet actions, and focused-composer/dock separation.
- Verified: focused mobile layout matrix (13 passed); complete desktop/mobile browser matrix (325 passed, 29 intentional project/device skips); full backend suite (619 passed); frontend lint, typecheck, UI audit, and 39-route production build. Route and shared bundle sizes were unchanged.
- No migration was required.

## Current finding

**P2 — Frontend E2E lacks a real deployment integration lane**

- Affected path: `frontend/playwright.config.ts` always starts a dev server with fake Supabase values and a dead API proxy, while `frontend/e2e/omnix-release.spec.ts` intercepts API requests. This provides deterministic UI coverage but cannot prove browser → deployed frontend → authenticated backend → live workspace data.
- Failure model: proxy, environment, authentication persistence, CORS, deployment routing, or backend/database integration can fail while the mocked release suite stays green.
- Intended behavior: keep the deterministic mocked suite, add a separate fail-fast live Playwright lane that never installs route mocks, requires an explicit deployment URL and authenticated storage state, performs only read-only workspace flows, and reports absent credentials as a blocked check rather than a skip or pass.
- Source of truth remains the deployed application and its Supabase session; the live test consumes an externally provisioned least-privilege account and does not create, modify, or delete production data.

### Active micro-plan — add an honest live browser lane

- [x] Trace the existing Playwright server/config, Supabase session storage, authenticated route guard, workspace hierarchy request, and CI/deployment seams.
- [x] Add an isolated live config, read-only browser/API smoke spec, package command, and operator documentation with strict environment validation and secret-safe artifacts.
- [x] Run static/config-focused tests plus lint/typecheck/build; attempt the live command and record the exact missing-environment blocker; review and commit only after every independent check is green.

## Completed finding record

### P2 — Frontend E2E lacks a real deployment integration lane

- Local commit: `f4ec583b test(frontend): add fail-closed live E2E lane`.
- The existing deterministic mocked desktop/mobile suite remains unchanged. `test:e2e:live` now uses a separate configuration with no local web server or request interception, requires HTTPS outside loopback, validates an origin-bound `omnix.supabase.auth` Playwright storage state, and reads hierarchy/task data through the deployed authenticated API on desktop and mobile Chromium.
- The live flow invokes no product write controls; ordinary application presence heartbeats can still occur. Failure artifacts are isolated in an ignored `test-results-live` directory, and documentation requires a least-privilege pre-provisioned workspace account with the state file kept outside the repository.
- Verified: focused live-environment/source contracts (6 passed on two Playwright projects); frontend typecheck, lint, UI audit, and 39-route production build; storage-state artifact ignore check; staged secret-pattern and whitespace checks.
- Blocked external verification: `npm run test:e2e:live` exits before running because `OMNIX_E2E_BASE_URL` and `OMNIX_E2E_STORAGE_STATE` are not configured in this environment. No deployed browser/API/database claim is made.
- No migration was required.

## Current finding

**P2 — Three.js route-level isolation is not enforced**

- Affected path: `frontend/app/page.tsx` → `LandingExperience` → statically imported `LandingHeroScene` → `three`. No authenticated route imports Three.js, but the decorative WebGL scene remains in the public landing route's initial client graph and there is no regression contract preventing shell leakage.
- Failure model: a large 3D runtime delays the landing route's primary content and can accidentally spread into authenticated/shared bundles if its import boundary changes.
- Intended behavior: load the decorative scene client-only in its own async chunk, preserve the existing non-WebGL/loading fallback and reduced-motion lifecycle, and assert that `three` has exactly one application importer with no authenticated-shell import path.

### Active micro-plan — isolate the decorative 3D runtime

- [x] Trace the only `three` importer, its landing route ownership, WebGL fallback, canvas disposal, mobile DPR, and current production bundle baseline.
- [x] Replace only the static landing-scene import with a client-only dynamic boundary and layout-stable fallback; add an import-graph/source contract.
- [x] Run the focused contract and landing browser checks, then typecheck/lint/UI audit/build and compare route/shared bundle output before an isolated commit.

## Completed finding record

### P2 — Three.js route-level isolation is not enforced

- Local commit: `01e46604 perf(frontend): isolate decorative Three.js scene`.
- `LandingHeroScene` is now a client-only dynamic import with a layout-stable ambient fallback. Its existing WebGL detection, mobile DPR limit, reduced-motion rendering, and full geometry/material/renderer cleanup remain inside the isolated scene module.
- A focused import-graph contract requires `LandingHeroScene.tsx` to remain the only application importer of `three`, rejects a static landing import, and verifies the primary landing heading/CTA render on desktop and mobile independently of the decorative chunk.
- Verified: focused isolation/landing matrix (4 passed after correcting a non-unique test locator); frontend typecheck, lint, UI audit, and 39-route production build. Landing first-load JS decreased from 307 kB to 173 kB (134 kB); shared first-load JS remained 103 kB and authenticated route sizes were unchanged.
- No migration was required.

## Current finding

**P2 — Network refresh domains duplicate timers and page-lifecycle listeners**

- Affected path: chat message/workspace validation, mention polling, and collaboration heartbeat/status polling each create independent network timers and independent `focus`/`visibilitychange` listeners even though realtime channels already use a shared registry.
- Failure model: every authenticated session wakes multiple timers and dispatches multiple page-lifecycle listeners; focus/visibility events can bunch redundant refreshes and the work continues to be hard to reason about as providers grow.
- Intended behavior: one lazy global scheduler owns network-refresh timing and page visibility/focus listeners, pauses while hidden, resets due times on reactivation, and preserves each domain's existing cadence and force semantics. The collaboration typing-expiry timer remains local because it only prunes in-memory state every two seconds.

### Active micro-plan — consolidate visible network refresh scheduling

- [x] Trace every polling cadence, focus/visibility callback, realtime subscription owner, and the distinction between network refresh and local typing expiry.
- [x] Add one visibility-aware scheduler and migrate only chat, mention notifications, collaboration heartbeat, and collaboration status refreshes without changing their API functions or realtime registry.
- [x] Run scheduler contracts and focus-driven browser behaviors, apply the multi-TSX React review, then lint/typecheck/UI audit/build and full relevant release tests before an isolated commit.

## Completed finding record

### P2 — Network refresh domains duplicate timers and page-lifecycle listeners

- Local commit: `d9d1b853 perf(frontend): consolidate visible refresh polling`.
- Chat validation, mention refresh, collaboration heartbeat, and live-status polling now share one lazy timeout scheduler and one focus/visibility listener pair. It pauses while hidden, resets all due times on reactivation, coalesces near-simultaneous focus/visibility events, and preserves chat's force-on-visible behavior plus collaboration's 60/90-second cadences.
- Supabase realtime remains owned by the existing realtime registry. The collaboration typing-expiry interval remains local because it is a 2-second in-memory cleanup loop rather than network polling.
- Verified: scheduler contracts (2 passed); focused focus/visibility/workspace browser behaviors (8 passed); React multi-surface review; frontend lint, UI audit, standalone typecheck, and 39-route production build. An initial standalone typecheck overlapped with `next build` and saw transient missing `.next/types` files; the sequential rerun passed, as did the build's own type phase.
- No migration was required.

## Completed finding record

### P2 — Notifications are a mention list rather than a workspace event inbox

- Local commit: `c302ce48 feat(notifications): add workspace event inbox`.
- The notifications surface now composes authoritative workspace activity with mention notifications and exposes All, Mentions, and Activity filters while keeping unread state owned by mentions.
- Event destinations map to existing domain routes only; no new persistence model or write behavior was introduced.
- Verified by commit-scoped notification feed model/browser coverage before the local commit.
- No migration was required.

## Current finding

**P2 — Error boundaries reset or refresh rather than preserving user work**

- Affected path: root `AppErrorBoundary`, `SurfaceErrorBoundary`, chat composer, workspace conversation composer, task creation, and initiative creation.
- Failure model: the root fallback only hard-reloads the page, and surface-level retries remount draft-heavy children. Unsent chat, channel-message, task, and initiative drafts live only in component state, so a recoverable render error or reload discards user-entered work.
- Intended behavior: recovery should first retry in place without a page refresh; reload remains available as an explicit fallback. Active composer/create drafts persist in session-scoped storage keyed by workspace/conversation/channel/thread/surface and clear only after successful submission or explicit reset.
- Smallest coherent change: add one reusable recoverable text-draft helper, use it in the high-risk draft surfaces, and add focused source plus browser regressions proving boundary controls and draft restoration across reload.

### Active micro-plan — preserve draft work through recovery

- [x] Trace boundary placement, refresh/reset behavior, draft-heavy surfaces, storage patterns, and existing E2E mocking.
- [x] Add session-scoped recoverable draft storage and non-destructive boundary retry controls.
- [x] Apply draft persistence to chat, workspace conversation, task creation, and initiative creation without changing mutation semantics.
- [x] Add focused contracts for scoped recovery, submit clearing, and boundary recovery copy.
- [x] Run focused tests first, then typecheck/lint/UI audit/build, review the diff, and commit locally only after green.

## Completed finding record

### P2 — Error boundaries reset or refresh rather than preserving user work

- Local commit: `21654b0 fix(frontend): preserve drafts through error recovery`.
- Root and surface error fallbacks now retry in place first and expose page reload only as an explicit fallback.
- Chat, workspace conversation, task creation, and initiative creation text drafts now use session-scoped recoverable draft keys bound to user/workspace/conversation/channel/thread/surface context.
- Successful submissions continue to clear draft state; workspace/channel/thread remounts no longer erase typed conversation text.
- Verified: `rtk npx playwright test e2e/error-recovery.spec.ts --project=chromium --workers=1` (4 passed), `rtk npm run typecheck`, `rtk npm run lint`, `rtk npm run test:ui-audit`, and `rtk npm run build`.
- No migration was required.

## Current finding

**P2 — Empty states do not consistently distinguish empty, loading, inaccessible, and failed states**

- Affected path: core workspace surfaces for tasks, initiatives, decisions, and conversations, plus their list/pane components.
- Failure model: several surfaces used plain text, spinner-only loaders, or the same empty branch for unavailable/no-selection states, making it hard for users and assistive technology to distinguish loading, no accessible workspace/channel, real empty content, and failed requests.
- Intended behavior: failed requests keep using assertive `OmnixErrorState`; non-error loading, empty, and inaccessible/no-selection states use an explicit shared state card with stable `data-surface-state`, semantic status/note roles, and concrete next-step copy.
- Smallest coherent change: add one shared `SurfaceStateCard` primitive and adopt it only in the core workspace surfaces identified by the audit.

### Active micro-plan — explicit workspace surface states

- [x] Trace current no-workspace, loading, empty, and failed branches in tasks, initiatives, decisions, conversations, channels, and threads.
- [x] Add a shared non-error surface state card for loading/empty/inaccessible states while preserving `OmnixErrorState` for failed requests.
- [x] Replace spinner-only and plain-text branches in the audited core surfaces.
- [x] Run focused source contract, frontend typecheck/lint/UI audit/build, then commit when green.

## Completed finding record

### P2 — Empty states do not consistently distinguish empty, loading, inaccessible, and failed states

- Local commit: `4e7b7bd fix(frontend): clarify workspace surface states`.
- Added a shared `SurfaceStateCard` for non-error loading, empty, and inaccessible/no-selection states; failed requests continue to use assertive `OmnixErrorState`.
- Tasks, initiatives, decisions, conversations, channel lists, message panes, and thread panes now expose distinct state copy and semantics instead of plain text or spinner-only feedback.
- Verified: `rtk npx playwright test e2e/surface-state-contract.spec.ts --project=chromium --workers=1` (4 passed), `rtk npm run typecheck`, `rtk npm run lint`, `rtk npm run test:ui-audit`, and `rtk npm run build`.
- No migration was required.

## Current finding

**P2 — No universal undo model is evident for consequential operations**

- Affected path: shared toast provider, conversation history state owner, chat history delete control, and chat action menu delete control.
- Failure model: reversible consequential actions were confirmed and executed but did not expose a consistent undo affordance. Users could not recover from archived conversation deletion without manual backend intervention, while irreversible operations risked falsely implying reversibility if treated generically.
- Intended behavior: a shared bounded undo action is available for reversible client mutations; archived conversation deletion exposes an 8-second undo that performs a real backend restore; irreversible workspace deletion remains confirmation-only and does not advertise undo.
- Smallest coherent change: add a reusable toast action/undo helper and apply it to conversation archive/delete flows, leaving non-reversible destructive operations unchanged.

### Active micro-plan — bounded undo model

- [x] Trace existing toast, conversation archive, and destructive confirmation flows.
- [x] Add a shared undo-toast helper through the toast action slot.
- [x] Make conversation archive return its archived row and add a restore mutation that reinserts restored rows.
- [x] Wire chat history and action-menu delete flows to the shared undo action.
- [x] Run focused undo contract, frontend typecheck/lint/UI audit/build, then commit when green.

## Completed finding record

### P2 — No universal undo model is evident for consequential operations

- Local commit: `8ff0852 fix(frontend): add bounded undo for archived chats`.
- Added a shared toast action slot and `showUndoToast` helper for bounded reversible mutations.
- Conversation archive/delete now returns the archived row and offers an 8-second undo that performs a real backend restore and reinserts the row.
- Irreversible workspace deletion remains confirmation-only and does not advertise undo.
- Verified: `rtk npx playwright test e2e/undo-contract.spec.ts --project=chromium --workers=1` (4 passed), `rtk npm run typecheck`, `rtk npm run lint`, `rtk npm run test:ui-audit`, and `rtk npm run build`.
- No migration was required.

## Current finding

**P2 — Auth and analytics surfaces mix hardcoded colors with theme variables**

- Affected path: auth form visuals, OAuth loading state, and the live knowledge graph visualization.
- Failure model: cited UI surfaces used inline `AUTH_C` color styles, arbitrary hex background utilities, and SVG `rgba(...)` literals, making theme consistency harder to audit and override.
- Intended behavior: component-level colors should resolve through shared Tailwind/theme classes or centralized CSS variables. Layout-only dynamic styles, such as progress width, remain local.
- Smallest coherent change: replace only the cited text/background/SVG color literals with existing or newly centralized `--omnix-*` tokens and add a source-level contract that prevents regression.

### Active micro-plan — route cited colors through theme tokens

- [x] Trace auth visual helpers, register phone control, OAuth buttons, live graph nodes, and existing global token conventions.
- [x] Replace inline/hardcoded component color literals with theme classes or centralized CSS variables.
- [x] Add missing CSS variables for the exact live graph colors that do not already exist.
- [x] Run focused theme-token contract, frontend typecheck/lint/UI audit/build, then commit when green.

## Completed finding record

### P2 — Auth and analytics surfaces mix hardcoded colors with theme variables

- Local commit: `c2a900e fix(frontend): route cited colors through theme tokens`.
- Auth brand, reusable auth inputs, register phone copy, OAuth loading state, and live knowledge graph literals now use shared classes or centralized `--omnix-*` tokens instead of inline or arbitrary hardcoded color values.
- Added the missing graph color variables to `frontend/styles/globals.css`; layout-only progress width remains local component state.
- Verified: `rtk npx playwright test e2e/theme-token-contract.spec.ts --project=chromium --workers=1` (4 passed), `rtk npm run typecheck`, `rtk npm run lint`, `rtk npm run test:ui-audit`, and `rtk npm run build`.
- No migration was required.

## Current finding

**P2 — Breadcrumbs and header controls compete for width below 390px**

- Affected path: authenticated shell header title area, workspace parent label, secondary breadcrumb/subtitle, and fixed right-side controls.
- Failure model: the control cluster reserves fixed touch target width while the secondary breadcrumb/subtitle was allowed to reappear at the 390px edge, leaving too little horizontal room for long workspace names or subspace trails.
- Intended behavior: phone widths show the primary title/workspace only; secondary parent/breadcrumb/subtitle metadata appears at the small breakpoint where the right-side controls no longer dominate the line.
- Smallest coherent change: keep header controls unchanged, make the title container the explicit flexible region, and defer secondary metadata from `min-[390px]` to `sm`.

### Active micro-plan — preserve narrow header width

- [x] Trace header title, breadcrumb, subspace, right-control, and existing mobile-layout contracts.
- [x] Hide parent/breadcrumb/subtitle metadata until `sm` while keeping the primary title visible and truncatable.
- [x] Add a focused mobile-layout source contract for the responsive breakpoint behavior.
- [x] Run focused mobile-layout contract, frontend typecheck/lint/UI audit/build, then commit when green.

## Completed finding record

### P2 — Breadcrumbs and header controls compete for width below 390px

- Local commit: `46069ae fix(frontend): preserve mobile header width`.
- The header title area is now the explicit flexible region; phone widths show only the primary workspace/route title while parent workspace labels, breadcrumbs, and subtitles wait until the `sm` breakpoint.
- Header controls, touch targets, notifications, command palette access, and desktop behavior remain unchanged.
- Verified: `rtk npx playwright test e2e/mobile-layout.spec.ts --project=chromium --workers=1` (5 passed), `rtk npm run typecheck`, `rtk npm run lint`, `rtk npm run test:ui-audit`, and `rtk npm run build`.
- No migration was required.

## Final integration polish

- Local commit: `5c40342 test(frontend): align notification loading contract`.
- The focused P2 integration run exposed one stale source-level assertion that still expected mention-only notification copy. The contract now expects the current event-inbox loading announcement, `Loading workspace events…`.
- Verified: combined P2 frontend contract run (26 passed), frontend typecheck, lint, UI audit, and production build.

## Current finding — notification activity failure and scope lifecycle

- Confirmed: the activity provider catches failed requests as empty success and unconditionally applies responses after workspace changes. The inbox consequently advertises an empty feed on failure or can show the prior workspace's events.
- Plan: use the existing query client for activity with user/workspace identity, abortable requests, no inactive cache retention, explicit error/loading state, and safe retry. Keep the backend activity endpoint authoritative. Show independent activity errors in the inbox and suppress empty-success copy when a selected source failed.
- Verify: browser regressions for initial failure/retry, failed refresh with retained same-workspace rows, and a delayed response after switching workspaces; existing notification tests; typecheck/lint/UI audit. Commit only after green.
- Reconciliation: HEAD is `5c40342f`; draft recovery, surface states, bounded undo, theme tokens, and narrow header fixes are already locally committed. Preserve the existing user changes listed by git status.
- Expanded within this finding: backend `list_workspace_activity` also returned empty success on database errors. Return a safe 503 instead, test failure/empty/denial at the service boundary, and stage only the new hunks, preserving the user's import reordering.
- Red/green loop: first browser run 6 passed, 2 failed from an ambiguous Retry selector matching realtime controls. Narrowed to the exact inbox Retry action and reran. React review also found an unstable empty-array default; hoisted it.
- Completed: `b765f32` — 8 desktop/mobile browser checks and 3 backend tests passed; lint, typecheck, UI audit and staged whitespace passed. Only the intended backend hunks were staged; user import edits remain unstaged. No migration.

## Current finding — shared refresh scheduler lifecycle

- Confirmed: the 100ms focus/visibility coalescing guard is in the timer callback instead of reactivation. Two domain deadlines less than 100ms apart can return without scheduling the next timer, permanently stopping polling. Focus plus visibility also invokes callbacks twice. Old subscription cleanup can remove a replacement with the same key.
- Plan: move coalescing to reactivation while always scheduling remaining deadlines, and make cleanup conditional on subscription identity. Keep existing intervals, consumers, and the single timer/listener model.
- Verification: deterministic runtime tests executing the production module with a controlled clock: close deadlines, focus/visibility coalescing, hidden/resume, and same-key replacement cleanup. Run focused tests before committing.
- Red/green: all 3 new runtime tests reproduced the defects before the fix; all 4 runtime/source tests pass afterward. Typecheck initially raced Next dev's generated files; rerun sequentially after Playwright.
- Completed: `b0996d2` — focused runtime/source tests 4 passed, sequential typecheck and scoped ESLint passed. No migration.

## Current finding — P3 dashboard label scanability

- Path: dashboard briefing/pulse/hero labels, analytics signal/runtime cards, knowledge-graph labels, and workspace tree heading.
- Plan: replace the confirmed 9–11px forced-uppercase labels with existing `text-xs` (12px) sentence/title-case text and normal tracking. Allow long card labels to wrap instead of clipping. Preserve values, routes and controls.
- Verify: computed font size/case and label fit in rendered dashboard/analytics at 375px and 1366px, plus frontend lint/typecheck and final integration build.
- Test correction: one test navigating four cold-compiled routes exhausted the 30s case budget. Split the route/viewport matrix into independently reported cases; no product assertion was relaxed.
- Further diagnosis: analytics actually reached its error boundary after the shared API mock returned `[]` for the unmocked telemetry object endpoint. Added a correctly shaped telemetry fixture matching the backend response, then reran the matrix. The earlier cold-compilation explanation was incomplete.
- Completed: `b0bf950` — 4 browser route/viewport cases passed (including telemetry labels), lint/typecheck/UI audit and scoped whitespace passed. No migration.

## Integration sweep — 2026-09-08

- Backend full suite: `rtk proxy backend/.venv/bin/pytest backend/tests -q` — 622 passed, 48 existing FastAPI lifecycle deprecation warnings.
- Remote migrations: `rtk proxy npx supabase migration list --linked` — all 62 local versions match remote through `20260824135906`; no pending migration. No new migration in this pass.
- Full frontend E2E is running; production build and standalone typecheck follow sequentially to avoid `.next` generation races.
- Live browser gate: `rtk npm run test:e2e:live` fails before execution because `OMNIX_E2E_BASE_URL` is absent. `OMNIX_E2E_STORAGE_STATE` is also required. Asked for deployment URL and an existing local state-file path; never request raw credentials.
- Top 10 features remain pending the required integration gate. Product-level semantic search, enterprise audit/moderation/retention UI, and granular policy gaps remain explicitly open and overlap those features; do not mark every audit finding complete merely because existing remediation tests pass.

## Current finding — high-severity frontend dependency advisories

- Confirmed from `npm audit --omit=dev --audit-level=high`: Next.js `<15.5.21`, PostCSS `<=8.5.22`, nanoid `<=3.3.17`, and sharp `<0.35.0` were present in the production dependency graph.
- Plan: update the minimum patched Next/PostCSS versions and override sharp to the patched release; regenerate the lockfile without changing application code.
- Verification: `npm ls` confirms the resolved versions; registry-backed `npm audit --omit=dev --audit-level=high` must report zero vulnerabilities; then frontend lint, typecheck, build, and E2E.

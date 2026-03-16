# Repository Cleanup Report

## Executive Summary
A comprehensive repository audit was performed to transition Omnix from a rapid-prototype architecture into a clean, production-grade AI infrastructure repository. All temporary fix scripts, stale testing files, and disconnected legacy modules were identified, verified for zero cross-dependencies, and safely archived/removed. The application successfully boots and compiles without errors post-cleanup.

## Safe Removals & Archiving

### 1. Root-Level Temporary Scripts
Archived and removed one-off development scripts that were no longer referenced by any runtime code:
* `fix.py`, `fix2.py`, `fix3.py`
* `fix.js`
* `fix_tests.py`
* `rewrite_dropzone.py`

### 2. Disconnected Test Files
Organized meaningful test files into `backend/tests/` and archived temporary/duplicate testing files:
* **Moved to `backend/tests/`:** `test_hybrid_retrieval.py`, `test_rag_db.py`, `test_llm.py`
* **Archived obsolete tests:** `test_vectorstore_abstraction.py`, `test_run_upload.py`, `test_upload_client.py`, `test_run_server.py`, `test_db.py`, `test.py`, `test_upload.py`, `test_improvements.py`, `dummy_model.py`

### 3. Stale Architecture Artifacts (FAISS)
The FAISS vector store has been fully superseded by `PgVectorStore`. References and old files were cleaned up:
* Removed `backend/app/rag/vector_store.py` (contained `FAISSStore`).
* Removed physical FAISS data remnants: `backend/data/faiss_index.index`, `backend/data/faiss_map.json`.
* Removed FAISS paths from `backend/app/core/config.py`.

### 4. Deprecated Context/Retrieval Modules
The RAG system evolved to utilize a centralized `ContextEngine` and `HybridSearchEngine`. The legacy models were safely deleted:
* Removed `backend/app/rag/retrieval.py` (`RAGRetriever`)
* Removed `backend/app/rag/context_builder.py` (`ContextBuilder`)
* Stripped the unused `ChatService` wrapper class from `backend/app/services/chat_service.py` (which still relied on the deprecated models). Only `call_llm` and `call_llm_stream` are preserved and used by API endpoints.

## Risks Mitigated
* **Dependency Verification:** Extensive checks via `grep_search` and dependency tree evaluation were performed before archiving `FAISSStore`, `ChatService`, and `RAGRetriever`.
* **Frontend Compilation:** Repaired TypeScript strictness errors (`@typescript-eslint/no-explicit-any`) generated inside `ActionsMenu.tsx` to restore full frontend compilation post-cleanup.

## Architecture Improvements
* The repository now clearly separates components with dedicated test folders (`tests/retrieval`, `tests/db`, `tests/llm`).
* Unused, risky entry points have been disabled, leaving a singular unified retrieval boundary within `app.context.engine`.

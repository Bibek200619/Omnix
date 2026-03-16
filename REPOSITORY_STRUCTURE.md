# Omnix Repository Structure

The Omnix AI platform is organized into a clean, modular architecture separating backend logic, infrastructure boundaries, and frontend presentation.

## `/backend/app/`
The core Python application running on FastAPI.

* **`/actions/`**: Action-driven workflows (e.g., summarize, tasks, faq, compare) combining retrieval logic.
* **`/automation/`**: Background orchestration, scheduled jobs, and logic for artifact/insight generation.
* **`/context/`**: The unified `ContextEngine` mapping token budgets, hybrid retrieval context, and prompt synthesis.
* **`/core/`**: Central application configurations and security/authentication policies.
* **`/db/`**: Connection setups and generic handlers (e.g., Supabase initialization).
* **`/embeddings/`**: Model configuration, chunk dimensionalities, and vector space utilities.
* **`/insights/`**: Intelligent background processors for topic/conflict/action-item detection.
* **`/integrations/`**: Third-party linkages (e.g., Google Drive).
* **`/jobs/`**: Async worker pools for ingestion, preflight queueing, and task execution.
* **`/observability/`**: Full tracing frameworks, metric tracking, stream interception, and exporter structures.
* **`/rag/`**: Vectorstore abstractions (`pgvector_store.py`) and ingestion pipelines.
* **`/retrieval/`**: Robust retrieval algorithms including keyword/semantic hybrid integrations and scoring mechanisms.
* **`/routers/`**: FastAPI endpoints serving HTTP/REST logic securely.
* **`/schemas/`**: Pydantic models for explicit I/O typing.
* **`/services/`**: Broad external service bridges (e.g., chat/LLM providers, Supabase API interactions).

## `/backend/tests/`
Testing logic separated by explicit domains to maintain focus and isolated context validation.

* **`/db/`**: Testing vector database ingestion and persistence logic (`test_rag_db.py`).
* **`/llm/`**: End-to-end model connectivity and stability/timeout validations.
* **`/observability/`**: Isolated testing for trace capturing, sanitization, and metric aggregation.
* **`/retrieval/`**: Testing retrieval engines and context boundary preservation.

## `/frontend/`
The presentation layer built using Next.js, React, and TypeScript.

* **`/app/`**: Next.js App Router topology separating `(auth)` flows from `(dashboard)` experiences.
* **`/components/`**: 
  * `/actions/`, `/auth/`, `/chat/`, `/upload/`, `/workspace/`: Domain-specific interactive UI elements.
  * `/layout/`, `/ui/`: Cross-cutting layout scaffolding, primitive interactive elements, and overarching structural containers.
* **`/lib/`**: Frontend utility logic, API wrapper classes (`apiClient`), and shared structural types.
* **`/styles/`**: Global stylesheet definitions and utility-class configurations (Tailwind).

## Execution Boundaries

1. **Ingestion Flow**: Data goes through `/routers/upload.py` -> `/jobs/ingestion_jobs.py` -> `/rag/ingestion.py` which interfaces with `PgVectorStore`.
2. **Retrieval Flow**: Queries process through `/routers/messages.py` -> `/retrieval/hybrid_search.py` (via `ContextEngine`), which builds prompts for LLMs.
3. **Execution Tracing**: Almost all asynchronous worker steps generate events sent to `/observability/tracing.py` where they are securely aggregated.

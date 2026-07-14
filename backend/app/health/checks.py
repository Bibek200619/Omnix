from __future__ import annotations
import asyncio
import importlib
import inspect
import logging
import os
from datetime import datetime, timezone, timedelta
from importlib.util import find_spec
from pathlib import Path
from typing import Dict, Any
from urllib.parse import urlparse
import httpx
from ..db.supabase_client import get_supabase
from ..rag.startup import get_vector_store
from ..core.config import get_settings
from ..services.workspace_schema_health_service import check_workspace_schema_health

logger = logging.getLogger(__name__)


async def check_supabase() -> Dict[str, Any]:
    try:
        get_supabase().table("workspaces").select("id").limit(1).execute()
        return {"status": "healthy"}
    except Exception as e:
        logger.error("Supabase health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_vector_store() -> Dict[str, Any]:
    try:
        store = get_vector_store()
        return {"status": "healthy", "type": store.__class__.__name__}
    except Exception as e:
        logger.error("Vector store health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_embedding_provider() -> Dict[str, Any]:
    provider: Any | None = None
    try:
        from ..embeddings.provider import get_default_provider

        provider = get_default_provider()
        provider_type = provider.__class__.__name__
        if provider_type == "LocalEmbeddingProvider" and find_spec("sentence_transformers") is None:
            return {
                "status": "failed",
                "provider": provider_type,
                "reason": "sentence_transformers_dependency_missing",
            }

        result: Dict[str, Any] = {
            "status": "healthy",
            "provider": provider_type,
            "probe": "configuration",
        }
        for attribute in ("model_name", "model", "embedding_dim", "expected_dim"):
            value = getattr(provider, attribute, None)
            if value is not None:
                result[attribute] = value
        return result
    except Exception as exc:
        logger.exception("Embedding provider health check failed.")
        return {
            "status": "failed",
            "reason": "embedding_provider_configuration_error",
            "error_type": type(exc).__name__,
        }
    finally:
        close = getattr(provider, "close", None)
        if callable(close):
            try:
                close_result = close()
                if inspect.isawaitable(close_result):
                    await close_result
            except Exception:
                logger.warning("Embedding provider health-check client cleanup failed.", exc_info=True)


def _nearest_existing_path(path: Path) -> Path:
    candidate = path
    while not candidate.exists() and candidate.parent != candidate:
        candidate = candidate.parent
    return candidate


async def check_file_storage() -> Dict[str, Any]:
    from ..services.file_storage import storage_backend_name, storage_is_shared, upload_root

    backend = storage_backend_name()
    if backend == "local":
        root = upload_root()
        probe_path = _nearest_existing_path(root)
        if root.exists() and not root.is_dir():
            return {
                "status": "failed",
                "backend": backend,
                "reason": "upload_path_is_not_directory",
            }
        if not probe_path.exists() or not os.access(probe_path, os.W_OK | os.X_OK):
            return {
                "status": "failed",
                "backend": backend,
                "reason": "upload_path_not_writable",
            }

        production = str(getattr(get_settings(), "ENV", "")).strip().lower() in {"prod", "production"}
        shared = storage_is_shared()
        if production and not shared:
            return {
                "status": "failed",
                "backend": backend,
                "shared": False,
                "root_exists": root.exists(),
                "reason": "local_storage_not_shared",
            }
        return {
            "status": "healthy",
            "backend": backend,
            "shared": shared,
            "root_exists": root.exists(),
            "reason": None,
        }

    if backend == "supabase":
        bucket = os.environ.get("OMNIX_FILE_STORAGE_BUCKET", "omnix-files")
        try:
            storage_bucket = get_supabase().storage.from_(bucket)
            await asyncio.to_thread(storage_bucket.list)
            return {
                "status": "healthy",
                "backend": backend,
                "shared": True,
                "bucket": bucket,
            }
        except Exception as exc:
            logger.exception("Shared file storage health check failed.")
            return {
                "status": "failed",
                "backend": backend,
                "shared": True,
                "bucket": bucket,
                "reason": "storage_probe_failed",
                "error_type": type(exc).__name__,
            }

    return {
        "status": "failed",
        "backend": backend,
        "reason": "unsupported_storage_backend",
    }


async def check_redis() -> Dict[str, Any]:
    """Real Redis connectivity check — no placeholders."""
    try:
        from ..jobs.queue import get_redis
        redis = get_redis()
        pong = await redis.ping()
        return {"status": "healthy", "ping": str(pong)}
    except Exception as e:
        logger.error("Redis health check failed: %s", e)
        return {"status": "unhealthy", "error": str(e)}


async def check_ollama() -> Dict[str, Any]:
    settings = get_settings()
    parsed_chat_url = urlparse(settings.ollama_chat_url)
    base_url = f"{parsed_chat_url.scheme}://{parsed_chat_url.netloc}".rstrip("/")
    expected_model = settings.ollama_model

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0, connect=2.0)) as client:
            response = await client.get(f"{base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
    except Exception as e:
        logger.error("Ollama health check failed: %s", e)
        return {
            "status": "unhealthy",
            "error": str(e),
            "base_url": base_url,
            "expected_model": expected_model,
        }

    models = [
        str(model.get("name") or "")
        for model in data.get("models", [])
        if isinstance(model, dict)
    ]
    if expected_model not in models:
        return {
            "status": "unhealthy",
            "error": f"Expected Ollama model {expected_model!r} is not installed.",
            "base_url": base_url,
            "expected_model": expected_model,
            "installed_models": models,
        }

    return {
        "status": "healthy",
        "base_url": base_url,
        "model": expected_model,
        "chat_endpoint": settings.ollama_chat_url,
    }


def _configured_chat_providers(settings: Any) -> list[str]:
    raw_order = getattr(settings, "AI_PROVIDER_ORDER", "ollama,openai,anthropic")
    names = raw_order.split(",") if isinstance(raw_order, str) else list(raw_order)
    available = {"ollama"}
    if getattr(settings, "OPENAI_API_KEY", None):
        available.add("openai")
    if getattr(settings, "ANTHROPIC_API_KEY", None):
        available.add("anthropic")

    configured: list[str] = []
    for raw_name in names:
        name = str(raw_name).strip().lower()
        if name in available and name not in configured:
            configured.append(name)
    configured.extend(name for name in sorted(available) if name not in configured)
    return configured


async def check_chat_providers() -> Dict[str, Any]:
    settings = get_settings()
    configured = _configured_chat_providers(settings)
    ollama = await check_ollama()
    ollama_healthy = ollama.get("status") == "healthy"
    providers: Dict[str, Any] = {
        "ollama": {
            "status": "healthy" if ollama_healthy else "failed",
            "probe": "live",
            "model": ollama.get("model") or ollama.get("expected_model"),
        }
    }
    for name in configured:
        if name != "ollama":
            providers[name] = {"status": "configured", "probe": "configuration"}

    primary = configured[0] if configured else "ollama"
    if primary != "ollama":
        status = "warning"
        reason = "primary_connectivity_not_probed"
    elif ollama_healthy:
        status = "healthy"
        reason = None
    elif len(configured) > 1:
        status = "degraded"
        reason = "primary_unavailable_failover_configured"
    else:
        status = "failed"
        reason = "no_chat_provider_available"

    return {
        "status": status,
        "primary": primary,
        "configured": configured,
        "providers": providers,
        "reason": reason,
    }


async def check_ingestion_worker(*, include_stuck_jobs: bool = True) -> Dict[str, Any]:
    """
    Report ingestion worker health from RuntimeManager (in-process counters)
    plus real Redis queue depth and DB-derived stuck job counts.
    Returns only backend-derived values — no fake metrics.
    """
    from ..runtime.manager import RuntimeManager

    runtime = RuntimeManager.get()
    metrics = runtime.get_ingestion_worker_metrics()

    # Real queue depth from Redis
    queue_depth: int | None = None
    try:
        from ..jobs.queue import get_redis
        import os
        queue_name = os.environ.get("OMNIX_JOB_QUEUE", "omnix:jobs")
        redis = get_redis()
        queue_depth = await redis.llen(queue_name)
    except Exception as exc:
        logger.warning("Could not read queue depth from Redis: %s", exc)

    # Stuck job detection uses trusted DB access and is reserved for authenticated
    # internal diagnostics. Public readiness checks skip it.
    stuck_10m = stuck_30m = stuck_60m = None
    queue_recovery: dict[str, Any] = {"status": "not_checked", "reason": "internal_diagnostics_disabled"}
    dead_lettered_jobs: int | None = None
    if include_stuck_jobs:
        stuck_10m = await _count_stuck_jobs(minutes=10)
        stuck_30m = await _count_stuck_jobs(minutes=30)
        stuck_60m = await _count_stuck_jobs(minutes=60)
        queue_recovery = await _queue_recovery_diagnostics()
        dead_lettered_jobs = await _count_jobs_by_status("dead_lettered")

    worker_status = "healthy" if metrics["active_workers"] > 0 else "no_worker"
    if metrics["active_workers"] == 0:
        logger.warning("Ingestion worker health check: no active ingestion workers registered in this process.")

    return {
        "status": worker_status,
        "active_workers": metrics["active_workers"],
        "worker_details": metrics["worker_details"],
        "queue_depth": queue_depth,
        "processing_jobs": metrics["processing_jobs"],
        "completed_jobs": metrics["completed_jobs"],
        "failed_jobs": metrics["failed_jobs"],
        "stuck_jobs": {
            "older_than_10m": stuck_10m,
            "older_than_30m": stuck_30m,
            "older_than_60m": stuck_60m,
        },
        "queue_recovery": queue_recovery,
        "dead_lettered_jobs": dead_lettered_jobs,
    }


async def _count_stuck_jobs(minutes: int) -> int | None:
    """Count jobs with status='queued' older than `minutes` minutes. Detection only."""
    try:
        from ..services.supabase_service import select_all_trusted
        threshold = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
        rows = await select_all_trusted(
            "jobs",
            "id",
            filters={"status": "queued"},
        )
        if rows is None:
            return None
        # Filter by created_at < threshold in Python (avoids complex query syntax)
        stuck = [
            r for r in rows
            if isinstance(r.get("created_at"), str) and r["created_at"] < threshold
        ]
        return len(stuck)
    except Exception as exc:
        logger.warning("Could not count stuck jobs (>%dm): %s", minutes, exc)
        return None


async def _count_jobs_by_status(status: str) -> int | None:
    try:
        from ..services.supabase_service import select_all_trusted

        rows = await select_all_trusted(
            "jobs",
            "id",
            filters={"status": status},
        )
        if rows is None:
            return None
        return len(rows)
    except Exception as exc:
        logger.warning("Could not count jobs with status=%s: %s", status, exc)
        return None


async def _queue_recovery_diagnostics() -> dict[str, Any]:
    try:
        queue_module = importlib.import_module("app.jobs.queue")
        recover_missing_queued_jobs = getattr(queue_module, "recover_missing_queued_jobs", None)
        if not inspect.iscoroutinefunction(recover_missing_queued_jobs):
            return {"status": "unavailable", "error": "queue recovery scanner is not available"}

        result = await recover_missing_queued_jobs(dry_run=True)
        missing_jobs = int(result.get("missing_jobs") or 0)
        return {
            **result,
            "status": "recovery_needed" if missing_jobs else "clear",
        }
    except Exception as exc:
        logger.warning("Could not inspect queue recovery state: %s", exc)
        return {"status": "error", "error": str(exc)}


async def run_all_checks(*, include_internal: bool = True) -> Dict[str, Any]:
    results = await asyncio.gather(
        check_supabase(),
        check_workspace_schema_health(),
        check_vector_store(),
        check_redis(),
        check_chat_providers(),
        check_ingestion_worker(include_stuck_jobs=include_internal),
        check_file_storage(),
        return_exceptions=True,
    )

    return {
        "supabase": results[0] if not isinstance(results[0], Exception) else {"status": "error", "error": str(results[0])},
        "workspace_schema": results[1] if not isinstance(results[1], Exception) else {"status": "error", "error": str(results[1])},
        "vector_store": results[2] if not isinstance(results[2], Exception) else {"status": "error", "error": str(results[2])},
        "redis": results[3] if not isinstance(results[3], Exception) else {"status": "error", "error": str(results[3])},
        "ollama": results[4] if not isinstance(results[4], Exception) else {"status": "error", "error": str(results[4])},
        "ingestion_worker": results[5] if not isinstance(results[5], Exception) else {"status": "error", "error": str(results[5])},
        "file_storage": results[6] if not isinstance(results[6], Exception) else {"status": "error", "error": str(results[6])},
    }


_OPERATIONAL_STATUS_MAP = {
    "healthy": "healthy",
    "clear": "healthy",
    "warning": "warning",
    "no_worker": "warning",
    "not_checked": "warning",
    "degraded": "degraded",
    "recovery_needed": "degraded",
    "failed": "failed",
    "unhealthy": "failed",
    "error": "failed",
    "unavailable": "failed",
}
_OPERATIONAL_STATUS_ORDER = {"healthy": 0, "warning": 1, "degraded": 2, "failed": 3}


def _operational_component(
    result: Dict[str, Any],
    *,
    fields: tuple[str, ...] = (),
    status: str | None = None,
) -> Dict[str, Any]:
    observed_status = str(result.get("status") or "error")
    normalized_status = status or _OPERATIONAL_STATUS_MAP.get(observed_status, "failed")
    component: Dict[str, Any] = {
        "status": normalized_status,
        "observed_status": observed_status,
    }
    for field in fields:
        if field in result:
            component[field] = result[field]
    return component


def build_operational_health(
    checks: Dict[str, Any],
    *,
    embedding_provider: Dict[str, Any],
    file_storage: Dict[str, Any],
    api_logging: Dict[str, Any],
    startup: Dict[str, Any],
) -> Dict[str, Any]:
    worker = checks.get("ingestion_worker") or {"status": "error"}
    queue_depth = worker.get("queue_depth")
    worker_status = None
    if worker.get("status") == "no_worker" and isinstance(queue_depth, int) and queue_depth > 0:
        worker_status = "degraded"

    queue_recovery = worker.get("queue_recovery") or {"status": "not_checked"}
    dead_letter_count = worker.get("dead_lettered_jobs")
    if dead_letter_count is None:
        dead_letter_status = "warning"
    elif int(dead_letter_count) > 0:
        dead_letter_status = "degraded"
    else:
        dead_letter_status = "healthy"

    components = {
        "database": _operational_component(checks.get("supabase") or {"status": "error"}),
        "workspace_schema": _operational_component(
            checks.get("workspace_schema") or {"status": "error"},
            fields=("summary",),
        ),
        "redis": _operational_component(checks.get("redis") or {"status": "error"}, fields=("ping",)),
        "workers": _operational_component(
            worker,
            status=worker_status,
            fields=("active_workers", "queue_depth", "processing_jobs", "completed_jobs", "failed_jobs"),
        ),
        "vector_store": _operational_component(
            checks.get("vector_store") or {"status": "error"},
            fields=("type",),
        ),
        "embedding_provider": _operational_component(
            embedding_provider,
            fields=("provider", "probe", "model_name", "model", "embedding_dim", "expected_dim", "reason"),
        ),
        "file_storage": _operational_component(
            file_storage,
            fields=("backend", "shared", "bucket", "root_exists", "reason"),
        ),
        "chat_provider": _operational_component(
            checks.get("ollama") or {"status": "error"},
            fields=("primary", "configured", "providers", "reason"),
        ),
        "api_logging": _operational_component(
            api_logging,
            fields=(
                "pending_tasks",
                "max_pending_tasks",
                "enqueued_total",
                "written_total",
                "failed_total",
                "dropped_total",
                "last_failure_at",
                "last_drop_at",
            ),
        ),
        "startup": _operational_component(
            startup,
            fields=("summary", "components"),
        ),
        "queue_recovery": _operational_component(
            queue_recovery,
            fields=("missing_jobs", "requeued_jobs", "scanned_jobs", "dry_run", "reason"),
        ),
        "dead_letters": {
            "status": dead_letter_status,
            "count": dead_letter_count,
        },
    }
    counts = {status: 0 for status in _OPERATIONAL_STATUS_ORDER}
    for component in components.values():
        counts[str(component["status"])] += 1
    overall_status = max(
        counts,
        key=lambda candidate: _OPERATIONAL_STATUS_ORDER[candidate] if counts[candidate] else -1,
    )
    return {
        "status": overall_status,
        "summary": counts,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "components": components,
    }


async def run_operational_checks() -> Dict[str, Any]:
    from ..bootstrap.middleware import get_api_logging_health
    from ..runtime.manager import RuntimeManager

    checks, embedding_provider, file_storage = await asyncio.gather(
        run_all_checks(include_internal=True),
        check_embedding_provider(),
        check_file_storage(),
    )
    return build_operational_health(
        checks,
        embedding_provider=embedding_provider,
        file_storage=file_storage,
        api_logging=get_api_logging_health(),
        startup=RuntimeManager.get().get_startup_health(),
    )

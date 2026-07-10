from __future__ import annotations
import logging
import os
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import vector_store, observability, workers, redis, shutdown, middleware
from ..runtime.manager import RuntimeManager
from ..health.router import router as health_router
from ..routers import conversations, files, cache, messages, upload, workspaces, workspace_invites, workspace_conversations, workspace_tasks, workspace_decisions, workspace_search, workspace_mentions, actions, artifacts, insights, automations, google_drive, admin, profile, continuity, connectors, email
from ..core.security import auth_context_middleware
from ..settings import get_settings

logger = logging.getLogger(__name__)

_DEV_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
)
_PRODUCTION_CORS_ORIGINS = (
    "https://omni-x.co.in",
    "https://www.omni-x.co.in",
)


def _is_dev_environment(settings: Any) -> bool:
    env = str(getattr(settings, "ENV", "") or "").strip().lower()
    return bool(getattr(settings, "DEV_MODE", False)) or env in {"dev", "development", "local", "test"}


def _split_origins(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _load_cors_settings() -> Any:
    try:
        return get_settings()
    except Exception as exc:
        logger.warning("Unable to load full settings for CORS configuration; using environment-only CORS settings: %s", exc)
        return SimpleNamespace(
            ENV=os.environ.get("ENV", "dev"),
            DEV_MODE=_env_bool("DEV_MODE", True),
            CORS_ALLOWED_ORIGINS=os.environ.get("CORS_ALLOWED_ORIGINS", ""),
            CORS_ALLOWED_ORIGIN_REGEX=os.environ.get("CORS_ALLOWED_ORIGIN_REGEX"),
            OMNIX_APP_URL=os.environ.get("OMNIX_APP_URL", "http://localhost:3000"),
        )


def _normalize_origin(origin: str) -> str | None:
    origin = origin.strip().rstrip("/")
    if not origin:
        return None
    if origin == "*":
        return origin

    parsed = urlparse(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        logger.warning("Ignoring invalid CORS origin %r.", origin)
        return None
    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


def _cors_allowed_origins(settings: Any) -> list[str]:
    is_dev = _is_dev_environment(settings)
    candidates: list[str] = []
    candidates.extend(_split_origins(getattr(settings, "CORS_ALLOWED_ORIGINS", "")))

    frontend_url = os.environ.get("OMNIX_FRONTEND_URL")
    if frontend_url:
        candidates.append(frontend_url)

    app_url = str(getattr(settings, "OMNIX_APP_URL", "") or "").strip()
    if app_url and (is_dev or app_url != "http://localhost:3000"):
        candidates.append(app_url)

    if is_dev:
        candidates.extend(_DEV_CORS_ORIGINS)
    else:
        candidates.extend(_PRODUCTION_CORS_ORIGINS)

    origins: list[str] = []
    for candidate in candidates:
        normalized = _normalize_origin(candidate)
        if normalized is None:
            continue
        if normalized == "*":
            logger.warning("Ignoring wildcard CORS origin; explicit origins are required.")
            continue
        if normalized not in origins:
            origins.append(normalized)

    if not origins and not is_dev:
        logger.warning("No production CORS origins configured; browser cross-origin requests will be blocked.")

    return origins


def _cors_options() -> dict[str, Any]:
    settings = _load_cors_settings()
    return {
        "allow_origins": _cors_allowed_origins(settings),
        "allow_origin_regex": getattr(settings, "CORS_ALLOWED_ORIGIN_REGEX", None) or None,
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
    }


def create_app() -> FastAPI:
    app = FastAPI(title="Omnix AI Platform", version="1.0.0")
    
    # Register Middlewares
    app.middleware("http")(auth_context_middleware)
    app.middleware("http")(middleware.api_logging_middleware)
    app.add_middleware(
        CORSMiddleware,
        **_cors_options(),
    )
    
    # Include Routers
    app.include_router(health_router)
    app.include_router(conversations.router)
    app.include_router(messages.router)
    app.include_router(files.router)
    app.include_router(upload.router)
    app.include_router(cache.router)
    app.include_router(profile.router)
    app.include_router(workspace_invites.workspace_router)
    app.include_router(workspaces.router)
    app.include_router(workspace_invites.router)
    app.include_router(workspace_conversations.router)
    app.include_router(workspace_tasks.router)
    app.include_router(workspace_decisions.router)
    app.include_router(workspace_search.router)
    app.include_router(workspace_mentions.router)
    app.include_router(actions.router)
    app.include_router(artifacts.router)
    app.include_router(insights.router)
    app.include_router(automations.router)
    app.include_router(connectors.router)
    app.include_router(google_drive.router)
    app.include_router(admin.router)
    app.include_router(continuity.router)
    app.include_router(email.router)
    
    @app.on_event("startup")
    async def startup_event():
        logger.info("Bootstrap: Starting system initialization...")
        runtime = RuntimeManager.get()
        runtime.begin_startup()
        runtime.set_status("booting")

        failed_components: list[str] = []
        initializers = (
            ("redis", redis.initialize_redis),
            ("observability", observability.initialize),
            ("vector_store", vector_store.initialize),
            ("workers", workers.initialize),
        )
        for component, initializer in initializers:
            try:
                await initializer()
                runtime.record_startup_component(component, "healthy")
            except Exception as exc:
                failed_components.append(component)
                runtime.record_startup_component(component, "failed", error_type=type(exc).__name__)
                logger.exception("Bootstrap component initialization failed | component=%s", component)

        if failed_components:
            runtime.set_status("degraded")
            logger.error(
                "Bootstrap: System initialization degraded | failed_components=%s",
                failed_components,
            )
        else:
            runtime.set_status("running")
            logger.info("Bootstrap: System initialized successfully.")

    @app.on_event("shutdown")
    async def shutdown_event():
        await shutdown.graceful_shutdown()
        
    return app

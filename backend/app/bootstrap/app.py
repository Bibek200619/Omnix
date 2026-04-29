from __future__ import annotations
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from . import vector_store, observability, workers, redis, shutdown, middleware
from ..runtime.manager import RuntimeManager
from ..health.router import router as health_router
from ..routers import conversations, files, cache, messages, upload, workspaces, actions, artifacts, insights, automations, google_drive, admin, profile, continuity
from ..core.security import auth_context_middleware

logger = logging.getLogger(__name__)

def create_app() -> FastAPI:
    app = FastAPI(title="Omnix AI Platform", version="1.0.0")
    
    # Register Middlewares
    app.middleware("http")(auth_context_middleware)
    app.middleware("http")(middleware.api_logging_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], # Should be restricted in prod via settings
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Include Routers
    app.include_router(health_router)
    app.include_router(conversations.router)
    app.include_router(messages.router)
    app.include_router(files.router)
    app.include_router(upload.router)
    app.include_router(cache.router)
    app.include_router(profile.router)
    app.include_router(workspaces.router)
    app.include_router(workspaces.invite_router)
    app.include_router(actions.router)
    app.include_router(artifacts.router)
    app.include_router(insights.router)
    app.include_router(automations.router)
    app.include_router(google_drive.router)
    app.include_router(admin.router)
    app.include_router(continuity.router)
    
    @app.on_event("startup")
    async def startup_event():
        logger.info("Bootstrap: Starting system initialization...")
        RuntimeManager.get().set_status("booting")
        
        try:
            await redis.initialize_redis()
            await observability.initialize()
            await vector_store.initialize()
            await workers.initialize()
            
            RuntimeManager.get().set_status("running")
            logger.info("Bootstrap: System initialized successfully.")
        except Exception as e:
            RuntimeManager.get().set_status("degraded")
            logger.error(f"Bootstrap: System initialization failed: {e}")
            
    @app.on_event("shutdown")
    async def shutdown_event():
        await shutdown.graceful_shutdown()
        
    return app

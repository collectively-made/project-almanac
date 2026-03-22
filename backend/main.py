import logging
import signal
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from backend.api.chat import router as chat_router
from backend.api.health import router as health_router
from backend.api.models import router as models_router
from backend.config import settings
from backend.dependencies import get_database

logger = logging.getLogger("almanac")


# --- Security Headers Middleware ---

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self'"
        )
        return response


# --- Application Lifespan ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    db = get_database()
    await db.init_schema()
    ok = await db.integrity_check()
    if ok:
        logger.info("Database integrity check passed")
    else:
        logger.error("Database integrity check FAILED")

    logger.info(
        "Almanac started",
        extra={"config_dir": str(settings.config_dir), "port": settings.port},
    )

    yield

    # Shutdown
    logger.info("Shutting down gracefully...")
    db.checkpoint_and_close()
    db.close_all()
    logger.info("Shutdown complete")


# --- App Factory ---

def create_app() -> FastAPI:
    app = FastAPI(
        title="Project Almanac",
        version="0.1.0",
        docs_url=None,  # No Swagger in production
        redoc_url=None,
        lifespan=lifespan,
    )

    # Middleware
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Same-origin in production; permissive for dev
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    # API routes
    app.include_router(health_router)
    app.include_router(chat_router)
    app.include_router(models_router)

    # SPA static files (must be last — catches all non-API routes)
    # Mounted after frontend is built; in dev mode Vite handles this
    static_dir = "/app/static"
    try:
        from backend.spa import SPAStaticFiles
        app.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="spa")
    except Exception:
        logger.info("Static files directory not found, skipping SPA mount")

    return app


app = create_app()

"""app.py — FastAPI application factory."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .settings import get_settings
from .routes import auth, clients, content, approvals, assets, reports, reviews, directories, media
from .database import engine, Base

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager — startup and shutdown events."""
    # Startup
    logger.info("Starting up...")
    
    # Create database tables if they don't exist
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables created/verified")
    
    # Start the scheduler
    try:
        from scheduler.scheduler import start_scheduler
        start_scheduler()
        logger.info("Scheduler started")
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down...")
    try:
        from scheduler.scheduler import scheduler
        scheduler.shutdown()
        logger.info("Scheduler shut down")
    except Exception as e:
        logger.error(f"Failed to shut down scheduler: {e}")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Halogen Marketing Automation",
        version="1.0.0",
        docs_url="/api/docs" if settings.APP_ENV == "development" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # CORS — allow the Next.js frontend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routers
    app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
    app.include_router(clients.router, prefix="/api/clients", tags=["clients"])
    app.include_router(content.router, prefix="/api/content", tags=["content"])
    app.include_router(approvals.router, prefix="/api/approvals", tags=["approvals"])
    app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
    app.include_router(reports.router, prefix="/api/reports", tags=["reports"])
    app.include_router(reviews.router, prefix="/api/reviews", tags=["reviews"])
    app.include_router(directories.router, prefix="/api/directories", tags=["directories"])
    app.include_router(media.router, prefix="/api/media", tags=["media"])

    # Serve uploaded images publicly so Publer can download them
    uploads_dir = Path(__file__).parent.parent.parent / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()

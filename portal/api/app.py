"""app.py — FastAPI application factory."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .settings import get_settings
from .routes import auth, clients, content, approvals, assets, reports, reviews, directories, media, users, files
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

    # Migrate: add media_source_client_id column if not present (SQLite)
    try:
        from sqlalchemy import text as _text
        from .database import SessionLocal as _SL
        _db2 = _SL()
        try:
            _db2.execute(_text("ALTER TABLE clients ADD COLUMN media_source_client_id INTEGER REFERENCES clients(id)"))
            _db2.commit()
            logger.info("Added media_source_client_id column")
        except Exception:
            pass  # Column already exists
        finally:
            _db2.close()
    except Exception as e:
        logger.error(f"media_source_client_id migration failed: {e}")

    # Migrate: add auto_publish_at column if not present
    try:
        from sqlalchemy import text as _text
        from .database import SessionLocal as _SL
        _db3 = _SL()
        # SQLite (dev) has no IF NOT EXISTS for ADD COLUMN — let the duplicate error be the guard.
        if engine.dialect.name == "postgresql":
            _sql = "ALTER TABLE content_items ADD COLUMN IF NOT EXISTS auto_publish_at TIMESTAMPTZ"
        else:
            _sql = "ALTER TABLE content_items ADD COLUMN auto_publish_at DATETIME"
        try:
            _db3.execute(_text(_sql))
            _db3.commit()
            logger.info("Added auto_publish_at column")
        except Exception:
            _db3.rollback()  # column already exists
        finally:
            _db3.close()
    except Exception as e:
        logger.error(f"auto_publish_at migration failed: {e}")

    # Migrate: populate user_clients from existing client_id values
    try:
        from sqlalchemy import text
        from .database import SessionLocal
        _db = SessionLocal()
        try:
            # INSERT OR IGNORE is SQLite-only; Postgres rejects it outright, so
            # this migration had never actually run in production.
            if engine.dialect.name == "postgresql":
                _sql = (
                    "INSERT INTO user_clients (user_id, client_id) "
                    "SELECT id, client_id FROM users WHERE client_id IS NOT NULL "
                    "ON CONFLICT DO NOTHING"
                )
            else:
                _sql = (
                    "INSERT OR IGNORE INTO user_clients (user_id, client_id) "
                    "SELECT id, client_id FROM users WHERE client_id IS NOT NULL"
                )
            _db.execute(text(_sql))
            _db.commit()
            logger.info("user_clients migration complete")
        finally:
            _db.close()
    except Exception as e:
        logger.error(f"user_clients migration failed: {e}")
    
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
    app.include_router(users.router, prefix="/api/users", tags=["users"])
    app.include_router(files.router, prefix="/api/files", tags=["files"])

    # Serve uploaded images publicly so Publer can download them
    uploads_dir = Path(__file__).parent.parent.parent / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()

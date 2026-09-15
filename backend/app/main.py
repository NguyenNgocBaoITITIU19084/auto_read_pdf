import logging
import sys
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path

# Ensure project root is in sys.path (needed for standalone PyInstaller builds and direct module execution)
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from backend.app.core.logging_setup import configure_logging
configure_logging()
logger = logging.getLogger("backend.main")

from backend.app.core.request_logging import RequestLoggingMiddleware
from backend.app.core.config import BACKEND_HOST, BACKEND_PORT
from backend.app.core.database import init_db, get_collections, create_collection
from backend.app.services.background_tasks import restore_auto_sync, shutdown_scheduler
from backend.app.api.collections import router as collections_router
from backend.app.api.bookings import router as bookings_router
from backend.app.api.vessels import router as vessels_router
from backend.app.api.containers import router as containers_router
from backend.app.api.export_backup import router as export_backup_router
from backend.app.api.color_rules import router as color_rules_router
from backend.app.api.dashboard import router as dashboard_router
from backend.app.api.settings import router as settings_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    collections = get_collections()
    if not collections:
        create_collection("Default Collection")
    # Restore persisted auto-sync schedule (first run is delayed so startup stays fast)
    await restore_auto_sync()
    yield
    # Shutdown
    shutdown_scheduler()

app = FastAPI(
    title="Auto Read PDF Backend API",
    version="2.0.0",
    lifespan=lifespan
)

# Enable CORS for Electron / React Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# Per-request log line, X-Request-ID header, and JSON lookup code on unhandled 500s.
app.add_middleware(RequestLoggingMiddleware)

# Healthcheck accepting both GET and HEAD
@app.api_route("/health", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok", "app": "Auto Read PDF", "version": "2.0.0"}

# Register API routers under /api/v1
app.include_router(collections_router, prefix="/api/v1")
app.include_router(bookings_router, prefix="/api/v1")
app.include_router(vessels_router, prefix="/api/v1")
app.include_router(containers_router, prefix="/api/v1")
app.include_router(export_backup_router, prefix="/api/v1")
app.include_router(color_rules_router, prefix="/api/v1")
app.include_router(dashboard_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")

if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    
    is_frozen = getattr(sys, "frozen", False)
    logger.info(f"Starting backend server (frozen={is_frozen}) on {BACKEND_HOST}:{BACKEND_PORT}")
    
    uvicorn.run(app, host=BACKEND_HOST, port=BACKEND_PORT, reload=False, log_level="info", access_log=False)


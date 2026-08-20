import logging
import sys
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Configure root logger with clean formatting and INFO level
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(name)s]: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout)
    ],
    force=True
)
logger = logging.getLogger("backend.main")

from backend.app.core.config import BACKEND_HOST, BACKEND_PORT
from backend.app.core.database import init_db, get_collections, create_collection
from backend.app.services.background_tasks import setup_scheduler
from backend.app.api.collections import router as collections_router
from backend.app.api.bookings import router as bookings_router
from backend.app.api.vessels import router as vessels_router
from backend.app.api.containers import router as containers_router
from backend.app.api.export_backup import router as export_backup_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    setup_scheduler()
    collections = get_collections()
    if not collections:
        create_collection("Default Collection")
    yield
    # Shutdown

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
)

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

if __name__ == "__main__":
    uvicorn.run("backend.app.main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=True)

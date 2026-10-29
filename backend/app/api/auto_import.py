import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.app.core.database import list_auto_import_files
from backend.app.services import auto_import, background_tasks

logger = logging.getLogger("backend.api.auto_import")
router = APIRouter(prefix="/auto-import", tags=["Auto import"])


class AutoImportSettingsRequest(BaseModel):
    enabled: bool
    folder: str = ""
    collection_id: Optional[int] = None
    # Also import the PDFs already in a newly chosen folder (default: they are left as they are)
    import_existing: bool = False
    # When the folder is scanned; left out = unchanged
    mode: Optional[str] = None
    interval_minutes: Optional[int] = None
    times: Optional[List[str]] = None


def _with_next_scan(settings: dict) -> dict:
    return {**settings, "next_scan_at": background_tasks.auto_import_next_run()}


@router.get("/settings")
def read_settings():
    return _with_next_scan(auto_import.get_settings())


@router.put("/settings")
async def write_settings(payload: AutoImportSettingsRequest):
    try:
        settings = await asyncio.to_thread(
            auto_import.save_settings, payload.enabled, payload.folder, payload.collection_id, payload.import_existing,
            payload.mode, payload.interval_minutes, payload.times)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    background_tasks.register_auto_import_job()
    schedule = ", ".join(settings["times"]) if settings["mode"] == "times" else f"every {settings['interval_minutes']} min"
    logger.info(f"Auto import settings: enabled={settings['enabled']} collection={settings['collection_id']} "
                f"schedule={schedule}")
    return _with_next_scan(settings)


@router.post("/run")
async def run_now():
    """Scans the folder now (also while switched off, to try a folder out) and returns what it did."""
    result = await asyncio.to_thread(auto_import.scan_once, None, True)
    return {**result, "settings": _with_next_scan(auto_import.get_settings())}


@router.get("/history")
def history(limit: int = Query(30, ge=1, le=500)):
    return {"items": list_auto_import_files(limit)}


@router.delete("/history/{sha256}")
def forget(sha256: str):
    """Reads that file again on the next scan (e.g. after its duplicate booking was deleted)."""
    if not auto_import.forget(sha256):
        raise HTTPException(status_code=404, detail="Not found")
    return {"status": "success"}

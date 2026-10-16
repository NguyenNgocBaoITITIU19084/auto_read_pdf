import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from urllib.parse import quote

from backend.app.services.exporter import export_to_excel_buffer, export_columns_to_excel, EXPORT_PALETTE
from backend.app.core.database import (
    export_backup_data, import_backup_data, list_export_templates, create_export_template,
    update_export_template, delete_export_template, EXPORT_TABS,
)
from backend.app.services import background_tasks
from backend.app.schemas.models import ExportExcelRequest, ExportTemplateRequest

logger = logging.getLogger("backend.api.backup")

router = APIRouter(prefix="", tags=["Export & Backup & Scheduler"])


class SchedulerToggleRequest(BaseModel):
    """Backward compatible with the old {enable, interval_minutes} body."""
    enable: bool
    interval_minutes: Optional[int] = None
    mode: Optional[str] = None
    times: Optional[List[str]] = None


@router.post("/export/excel")
def export_excel(payload: ExportExcelRequest):
    try:
        if payload.columns:
            buf = export_columns_to_excel(payload.data, [c.model_dump() for c in payload.columns])
        else:
            buf = export_to_excel_buffer(payload.data, payload.selected_columns)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to export excel: {e}")
    name = (payload.filename or "export_data.xlsx").strip() or "export_data.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=export.xlsx; filename*=UTF-8''{quote(name)}"},
    )


@router.get("/export/palette")
def export_palette():
    return [{"id": k, "header": f"#{h}", "tint": f"#{t}", "text": f"#{f}"} for k, (h, t, f) in EXPORT_PALETTE.items()]


@router.get("/export/templates")
def get_export_templates(tab: str = Query(...)):
    if tab not in EXPORT_TABS:
        raise HTTPException(status_code=400, detail="Tab không hợp lệ")
    return list_export_templates(tab)


@router.post("/export/templates")
def add_export_template(payload: ExportTemplateRequest):
    try:
        item = create_export_template(payload.tab or "", payload.name, [c.model_dump() for c in payload.columns],
                                      payload.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(f"Export template created id={item['id']} tab={item['tab']}")
    return item


@router.put("/export/templates/{template_id}")
def edit_export_template(template_id: int, payload: ExportTemplateRequest):
    try:
        item = update_export_template(template_id, payload.name, [c.model_dump() for c in payload.columns],
                                      payload.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if item is None:
        raise HTTPException(status_code=404, detail="Mẫu xuất không tồn tại")
    return item


@router.delete("/export/templates/{template_id}")
def remove_export_template(template_id: int):
    if not delete_export_template(template_id):
        raise HTTPException(status_code=404, detail="Mẫu xuất không tồn tại")
    return {"status": "success", "deleted_id": template_id}

@router.get("/backup")
def get_backup():
    try:
        data = export_backup_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")
    logger.info("Backup exported")
    return data

@router.post("/restore")
def restore_backup(payload: dict, mode: str = Query("merge", description="merge | replace")):
    if mode not in ("merge", "replace"):
        raise HTTPException(status_code=400, detail="mode must be 'merge' or 'replace'")
    try:
        import_backup_data(payload, mode=mode)
    except Exception as e:
        logger.exception("Restore failed")
        raise HTTPException(status_code=400, detail=f"Restore failed: {e}")
    logger.info(f"Restore finished mode={mode}")
    return {"status": "success", "message": "Database restored successfully", "mode": mode}

@router.get("/scheduler/status")
async def auto_sync_status():
    return background_tasks.get_auto_sync_status()

@router.post("/scheduler/toggle")
async def auto_sync_toggle(payload: SchedulerToggleRequest):
    try:
        return await background_tasks.toggle_auto_sync(
            payload.enable,
            interval_minutes=payload.interval_minutes,
            mode=payload.mode,
            times=payload.times,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/scheduler/run-now")
async def auto_sync_run_now():
    return {"status": await background_tasks.run_now()}

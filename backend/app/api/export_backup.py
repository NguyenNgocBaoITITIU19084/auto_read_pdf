from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from backend.app.services.exporter import export_to_excel_buffer
from backend.app.core.database import export_backup_data, import_backup_data
from backend.app.services.background_tasks import toggle_auto_sync, get_auto_sync_status
from backend.app.schemas.models import ExportExcelRequest, AutoSyncToggleRequest

router = APIRouter(prefix="", tags=["Export & Backup & Scheduler"])

@router.post("/export/excel")
def export_excel(payload: ExportExcelRequest):
    try:
        buf = export_to_excel_buffer(payload.data, payload.selected_columns)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=export_data.xlsx"}
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to export excel: {e}")

@router.get("/backup")
def get_backup():
    try:
        return export_backup_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")

@router.post("/restore")
def restore_backup(payload: dict):
    try:
        import_backup_data(payload)
        return {"status": "success", "message": "Database restored successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Restore failed: {e}")

@router.get("/scheduler/status")
async def auto_sync_status():
    return get_auto_sync_status()

@router.post("/scheduler/toggle")
async def auto_sync_toggle(payload: AutoSyncToggleRequest):
    return await toggle_auto_sync(payload.enable, payload.interval_minutes or 10)

import logging
from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from backend.app.core.database import get_dashboard_summary
from backend.app.schemas.models import DashboardSummaryResponse

logger = logging.getLogger("backend.api.dashboard")
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/summary", response_model=DashboardSummaryResponse)
def get_summary(collection_id: Optional[int] = Query(None)):
    try:
        return get_dashboard_summary(collection_id=collection_id)
    except Exception as e:
        logger.error(f"Error getting dashboard summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

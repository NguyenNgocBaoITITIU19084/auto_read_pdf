import logging
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Query, HTTPException
from backend.app.core import fleet, gmail, zalo
from backend.app.core.database import get_dashboard_summary
from backend.app.core.timezone import VN_TZ
from backend.app.schemas.models import DashboardSummaryResponse

logger = logging.getLogger("backend.api.dashboard")
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

def _messaging_summary() -> dict:
    """What is waiting in Zalo and Gmail (account-wide, never scoped to a collection). Each side is read on its own so
    one failing leaves the other; a side that could not be read is None."""
    from backend.app.services import zalo_booking
    out: dict = {"zalo": None, "gmail": None}
    try:
        session = zalo.get_session()
        connected = session.get("status") == "connected" and bool(session.get("uid"))
        counts = zalo.list_conversations(limit=1)["counts"] if connected else {}
        out["zalo"] = {
            "connected": connected,
            "account_name": session.get("display_name") or "",
            "unread_messages": int(counts.get("unread_messages", 0)),
            "unread_conversations": int(counts.get("unread", 0)),
            "pending_conversations": int(counts.get("pending", 0)),
            "bookings_to_review": zalo_booking.summary()["pending_review"] if connected else 0,
        }
    except Exception as e:
        logger.error(f"Error getting Zalo dashboard summary: {e}", exc_info=True)
    try:
        accounts = gmail.list_accounts()
        out["gmail"] = {
            "accounts": [{"id": a["id"], "email": a["email"], "status": a.get("status") or "",
                          "unread_count": int(a.get("unread_count") or 0)} for a in accounts],
            "unread_total": sum(int(a.get("unread_count") or 0) for a in accounts),
            "accounts_with_error": sum(1 for a in accounts if (a.get("status") or "") == "error"),
        }
    except Exception as e:
        logger.error(f"Error getting Gmail dashboard summary: {e}", exc_info=True)
    return out


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_summary(collection_id: Optional[int] = Query(None)):
    try:
        summary = get_dashboard_summary(collection_id=collection_id)
    except Exception as e:
        logger.error(f"Error getting dashboard summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    # The fleet is company-wide (not per collection); a failure there must not hide the rest of the dashboard
    try:
        summary["fleet"] = fleet.dashboard_summary(datetime.now(VN_TZ).date())
    except Exception as e:
        logger.error(f"Error getting fleet dashboard summary: {e}", exc_info=True)
        summary["fleet"] = None
    summary["messaging"] = _messaging_summary()
    return summary

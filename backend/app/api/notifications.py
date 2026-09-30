import logging
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from backend.app.core.database import (
    claim_os_notifications, clear_notifications, get_notification_settings, list_notifications,
    mark_notifications_read, record_test_notification, set_notification_settings,
)
from backend.app.services.change_detection import ALL_KINDS

logger = logging.getLogger("backend.api.notifications")
router = APIRouter(prefix="/notifications", tags=["Notifications"])


class MarkReadRequest(BaseModel):
    """ids omitted / null = every notification"""
    ids: Optional[List[int]] = None


class NotificationSettingsRequest(BaseModel):
    kinds: List[str]
    os_enabled: bool = True


def _settings_payload() -> dict:
    s = get_notification_settings()
    return {"kinds": [k for k in ALL_KINDS if k in s["kinds"]], "os_enabled": s["os_enabled"], "all_kinds": list(ALL_KINDS)}


@router.get("")
def get_notifications(limit: int = Query(50, ge=1, le=500), unread_only: bool = Query(False)):
    """Newest first, with the total number of unread ones."""
    return list_notifications(limit, unread_only)


@router.post("/mark-read")
def mark_read(payload: MarkReadRequest):
    return {"updated": mark_notifications_read(payload.ids)}


@router.delete("")
def clear(read_only: bool = Query(True)):
    return {"deleted": clear_notifications(read_only)}


@router.post("/claim-os")
def claim_os():
    """For the desktop app only: takes the background notifications not yet shown as a system popup (each is returned once)."""
    return claim_os_notifications()


@router.post("/test")
def send_test():
    """Creates a sample notification (bell + desktop popup) so the user can check they work."""
    return record_test_notification()


@router.get("/settings")
def read_settings():
    return _settings_payload()


@router.put("/settings")
def write_settings(payload: NotificationSettingsRequest):
    set_notification_settings(payload.kinds, payload.os_enabled)
    return _settings_payload()

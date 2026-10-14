import logging

from fastapi import APIRouter, Query

from backend.app.core.database import (
    TRASH_KEEP_DAYS, count_trash, delete_trashed, get_trash_ids, get_trash_page, restore_trashed,
)
from backend.app.schemas.models import BatchDeleteRequest


def add_trash_routes(router: APIRouter, kind: str, logger: logging.Logger, label: str):
    """GET /trash, /trash/ids, /trash/count and POST /trash/restore, /trash/delete for one kind of row."""

    @router.get("/trash")
    def list_trash(collection_id: int = Query(...), limit: int = Query(50), offset: int = Query(0)):
        """A page of the collection's deleted rows, kept TRASH_KEEP_DAYS days before being purged."""
        return {**get_trash_page(kind, collection_id, limit, offset), "keep_days": TRASH_KEEP_DAYS}

    @router.get("/trash/ids")
    def list_trash_ids(collection_id: int = Query(...)):
        return {"ids": get_trash_ids(kind, collection_id)}

    @router.get("/trash/count")
    def trash_count(collection_id: int = Query(...)):
        return {"count": count_trash(kind, collection_id)}

    @router.post("/trash/restore")
    def restore_from_trash(req: BatchDeleteRequest):
        res = restore_trashed(kind, list(req.ids or []))
        logger.info(f"Restored {res['restored']} {label}(s) from the trash"
                    + (f", {res['superseded']} already looked up again" if res["superseded"] else ""))
        return {"status": "success", **res}

    @router.post("/trash/delete")
    def delete_from_trash(req: BatchDeleteRequest):
        deleted = delete_trashed(kind, list(req.ids or []))
        logger.info(f"Permanently deleted {deleted} {label}(s) from the trash")
        return {"status": "success", "deleted": deleted}

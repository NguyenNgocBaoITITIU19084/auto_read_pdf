import logging

from fastapi import APIRouter, HTTPException
from backend.app.core.database import (
    get_collections, create_collection, delete_collection, update_collection_settings,
    move_items_to_collection
)
from backend.app.schemas.models import (
    CollectionCreate, CollectionUpdateSettings, CollectionResponse, MoveItemsRequest
)

logger = logging.getLogger("backend.api.collections")

router = APIRouter(prefix="/collections", tags=["Collections"])

@router.get("", response_model=list[CollectionResponse])
def list_collections():
    return get_collections()

@router.post("", response_model=dict)
def create_new_collection(payload: CollectionCreate):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Collection name cannot be empty")
    try:
        col_id = create_collection(name)
        logger.info(f"Created collection id={col_id}")
        return {"id": col_id, "name": name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create collection: {e}")

@router.post("/move")
def move_items(payload: MoveItemsRequest):
    try:
        moved = move_items_to_collection(
            payload.entity, payload.ids, payload.target_collection_id, copy=bool(payload.copy_items)
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info(f"Moved {moved} {payload.entity} to collection {payload.target_collection_id} (copy={bool(payload.copy_items)})")
    return {"status": "success", "moved": moved}

@router.delete("/{col_id}")
def remove_collection(col_id: int):
    delete_collection(col_id)
    logger.info(f"Deleted collection id={col_id}")
    return {"status": "success", "deleted_id": col_id}

@router.put("/{col_id}/settings")
def update_settings(col_id: int, payload: CollectionUpdateSettings):
    update_collection_settings(col_id, payload.settings)
    return {"status": "success"}

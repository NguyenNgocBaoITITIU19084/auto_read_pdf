import logging

from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_collections, get_collections_with_counts, create_collection, delete_collection, update_collection_settings,
    move_items_to_collection, rename_collection, collection_name_taken,
)
from backend.app.schemas.models import (
    CollectionCreate, CollectionRename, CollectionUpdateSettings, CollectionResponse, MoveItemsRequest
)

logger = logging.getLogger("backend.api.collections")

router = APIRouter(prefix="/collections", tags=["Collections"])
MAX_NAME_LENGTH = 100


def _clean_name(name: str, exclude_id: int | None = None) -> str:
    name = (name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tên bộ sưu tập không được để trống")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Tên bộ sưu tập tối đa {MAX_NAME_LENGTH} ký tự")
    if collection_name_taken(name, exclude_id):
        raise HTTPException(status_code=409, detail=f"Đã có bộ sưu tập tên '{name}'")
    return name


@router.get("", response_model=list[CollectionResponse], response_model_exclude_none=True)
def list_collections(with_counts: bool = Query(False)):
    return get_collections_with_counts() if with_counts else get_collections()

@router.post("", response_model=dict)
def create_new_collection(payload: CollectionCreate):
    name = _clean_name(payload.name)
    col_id = create_collection(name)
    logger.info(f"Created collection id={col_id}")
    return {"id": col_id, "name": name}

@router.put("/{col_id}")
def rename(col_id: int, payload: CollectionRename):
    name = _clean_name(payload.name, exclude_id=col_id)
    if not rename_collection(col_id, name):
        raise HTTPException(status_code=404, detail="Bộ sưu tập không tồn tại")
    logger.info(f"Renamed collection id={col_id}")
    return {"status": "success", "id": col_id, "name": name}

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

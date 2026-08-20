from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_containers, insert_containers, delete_container, clear_containers,
    get_container_watchlist, add_to_container_watchlist, remove_from_container_watchlist
)
from backend.app.services.eport_client import search_containers
from backend.app.schemas.models import ContainerSearchRequest, ContainerWatchlistAddRequest

router = APIRouter(prefix="/containers", tags=["Containers"])

@router.get("")
def list_containers(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None)
):
    return get_containers(collection_id, search_query, search_field)

@router.post("/search")
def query_containers(payload: ContainerSearchRequest):
    try:
        results = search_containers(payload.site_id, payload.container_nos)
        if results:
            insert_containers(payload.collection_id, results)
        message = "Không tìm thấy thông tin container trên ePort" if len(results) == 0 else ""
        return {"count": len(results), "items": results, "message": message}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{cont_id}")
def remove_container(cont_id: int):
    delete_container(cont_id)
    return {"status": "success", "deleted_id": cont_id}

@router.delete("/clear/{collection_id}")
def clear_all_containers(collection_id: int):
    clear_containers(collection_id)
    return {"status": "success", "cleared_collection_id": collection_id}

@router.get("/watchlist")
def list_container_watchlist(collection_id: int = Query(...)):
    return get_container_watchlist(collection_id)

@router.post("/watchlist")
def add_container_watchlist_item(payload: ContainerWatchlistAddRequest):
    add_to_container_watchlist(payload.collection_id, payload.site_id, payload.container_no)
    return {"status": "success"}

@router.delete("/watchlist/{watchlist_id}")
def delete_container_watchlist_item(watchlist_id: int):
    remove_from_container_watchlist(watchlist_id)
    return {"status": "success", "deleted_id": watchlist_id}

@router.post("/watchlist/sync")
def sync_collection_container_watchlist(collection_id: int = Query(...)):
    watchlist = get_container_watchlist(collection_id)
    if not watchlist:
        return {"updated_count": 0, "errors": []}
        
    by_site = {}
    for item in watchlist:
        site = item["site_id"]
        if site not in by_site:
            by_site[site] = []
        by_site[site].append(item["container_no"])
        
    updated_count = 0
    errors = []
    for site, cont_nos in by_site.items():
        try:
            res = search_containers(site, ",".join(cont_nos))
            if res:
                insert_containers(collection_id, res)
                updated_count += len(res)
        except Exception as e:
            errors.append(f"Site {site}: {e}")
            
    return {"updated_count": updated_count, "errors": errors}

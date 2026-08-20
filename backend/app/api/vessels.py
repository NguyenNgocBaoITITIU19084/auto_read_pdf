from typing import Optional
import time
from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_vessel_schedules, insert_vessel_schedules, delete_vessel_schedule,
    clear_vessel_schedules, get_watchlist, add_to_watchlist, remove_from_watchlist
)
from backend.app.services.eport_client import search_vessels
from backend.app.schemas.models import VesselSearchRequest, VesselWatchlistAddRequest

router = APIRouter(prefix="/vessels", tags=["Vessels"])

@router.get("")
def list_vessels(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None)
):
    return get_vessel_schedules(collection_id, search_query, search_field)

@router.post("/search")
def query_vessels(payload: VesselSearchRequest):
    try:
        results = search_vessels(payload.site_id, payload.vessel_name, payload.voyage)
        if results:
            insert_vessel_schedules(payload.collection_id, results)
        message = "Không tìm thấy thông tin chuyến tàu trên ePort" if len(results) == 0 else ""
        return {"count": len(results), "items": results, "message": message}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.delete("/{schedule_id}")
def remove_schedule(schedule_id: int):
    delete_vessel_schedule(schedule_id)
    return {"status": "success", "deleted_id": schedule_id}

@router.delete("/clear/{collection_id}")
def clear_all_schedules(collection_id: int):
    clear_vessel_schedules(collection_id)
    return {"status": "success", "cleared_collection_id": collection_id}

@router.get("/watchlist")
def list_watchlist(collection_id: int = Query(...)):
    return get_watchlist(collection_id)

@router.post("/watchlist")
def add_watchlist_item(payload: VesselWatchlistAddRequest):
    add_to_watchlist(payload.collection_id, payload.site_id, payload.vessel_name, payload.voyage)
    return {"status": "success"}

@router.delete("/watchlist/{watchlist_id}")
def delete_watchlist_item(watchlist_id: int):
    remove_from_watchlist(watchlist_id)
    return {"status": "success", "deleted_id": watchlist_id}

@router.post("/watchlist/sync")
def sync_collection_watchlist(collection_id: int = Query(...)):
    watchlist = get_watchlist(collection_id)
    updated_count = 0
    errors = []
    for idx, item in enumerate(watchlist):
        try:
            res = search_vessels(item["site_id"], item["vessel_name"], item["voyage"])
            if res:
                insert_vessel_schedules(collection_id, res)
                updated_count += len(res)
        except Exception as e:
            errors.append(f"{item['vessel_name']}/{item['voyage']}: {e}")
        
        # Wait 2 seconds between each vessel API call to avoid overloading ePort
        if idx < len(watchlist) - 1:
            time.sleep(2)
    return {"updated_count": updated_count, "errors": errors}

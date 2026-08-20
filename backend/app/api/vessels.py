import logging
from typing import Optional
import time
from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_vessel_schedules, insert_vessel_schedules, delete_vessel_schedule,
    delete_vessel_schedules_batch, clear_vessel_schedules, get_watchlist,
    add_to_watchlist, remove_from_watchlist
)
from backend.app.services.eport_client import search_vessels
from backend.app.schemas.models import VesselSearchRequest, VesselWatchlistAddRequest, BatchDeleteRequest

logger = logging.getLogger("backend.api.vessels")
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
    logger.info(f"[API /vessels/search] User searching: site='{payload.site_id}', vessel='{payload.vessel_name}', voyage='{payload.voyage}', collection_id={payload.collection_id}")
    try:
        results = search_vessels(payload.site_id, payload.vessel_name, payload.voyage)
        if results:
            insert_vessel_schedules(payload.collection_id, results)
            logger.info(f"[API /vessels/search] ✅ Found and saved {len(results)} matching schedule(s)")
            message = ""
        else:
            if payload.voyage:
                message = f"Không tìm thấy lịch tàu '{payload.vessel_name}' khớp với số chuyến '{payload.voyage}' trên ePort"
            else:
                message = f"Không tìm thấy thông tin lịch tàu '{payload.vessel_name}' trên ePort"
            logger.warning(f"[API /vessels/search] ⚠️ {message} - Không cập nhật DB.")
        return {"count": len(results), "items": results, "message": message}
    except Exception as e:
        logger.error(f"[API /vessels/search] ❌ Error querying vessels: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/batch-delete")
def remove_schedules_batch(payload: BatchDeleteRequest):
    delete_vessel_schedules_batch(payload.ids)
    return {"status": "success", "deleted_count": len(payload.ids)}

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
    logger.info(f"[API /vessels/watchlist/sync] Starting sync for {len(watchlist)} watchlist item(s) in collection {collection_id}...")
    for idx, item in enumerate(watchlist):
        v_name = item["vessel_name"]
        v_voyage = item.get("voyage", "")
        v_site = item["site_id"]
        try:
            res = search_vessels(v_site, v_name, v_voyage)
            if res:
                insert_vessel_schedules(collection_id, res)
                updated_count += len(res)
                logger.info(f"[API /vessels/watchlist/sync] ✅ Updated {len(res)} schedule(s) for '{v_name}' (Voyage: '{v_voyage}')")
            else:
                logger.warning(f"[API /vessels/watchlist/sync] ⚠️ No matching voyage on ePort for '{v_name}' ('{v_voyage}') -> Skipped, DB preserved.")
        except Exception as e:
            err_msg = f"{v_name}/{v_voyage}: {e}"
            errors.append(err_msg)
            logger.error(f"[API /vessels/watchlist/sync] ❌ Error syncing vessel {v_name}: {e}")
        
        # Wait 2 seconds between each vessel API call to avoid overloading ePort
        if idx < len(watchlist) - 1:
            time.sleep(2)
            
    logger.info(f"[API /vessels/watchlist/sync] Sync completed. Total schedules updated: {updated_count}, errors: {len(errors)}")
    return {"updated_count": updated_count, "errors": errors}

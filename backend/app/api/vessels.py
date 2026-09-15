import logging
from typing import Optional
import time
from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_vessel_schedules, insert_vessel_schedules, delete_vessel_schedule,
    delete_vessel_schedules_batch, clear_vessel_schedules, get_watchlist,
    add_to_watchlist, remove_from_watchlist, add_vessel_watchlist_batch,
    remove_vessel_watchlist_batch, get_vessel_schedules_by_ids, update_watchlist_sync_status
)
from backend.app.services.eport_client import search_vessels
from backend.app.schemas.models import (
    VesselSearchRequest, VesselWatchlistAddRequest, BatchDeleteRequest,
    VesselWatchlistBatchAddRequest, BatchIdsRequest, ResyncRequest, ResyncResponse
)

logger = logging.getLogger("backend.api.vessels")
router = APIRouter(prefix="/vessels", tags=["Vessels"])

# Pause between consecutive ePort vessel calls (avoid overloading ePort)
RESYNC_VESSEL_DELAY_SECONDS = 1.0

# NOTE: every endpoint here is a plain `def` so FastAPI runs it in the threadpool —
# the DB/ePort calls and sleeps below never block the event loop.

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
        logger.exception(f"[API /vessels/search] ❌ Error querying vessels: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/batch-delete")
def remove_schedules_batch(payload: BatchDeleteRequest):
    delete_vessel_schedules_batch(payload.ids)
    return {"status": "success", "deleted_count": len(payload.ids)}

@router.post("/resync", response_model=ResyncResponse)
def resync_vessels(payload: ResyncRequest):
    """Re-query ePort for the selected vessel_schedules rows and upsert the results."""
    rows = get_vessel_schedules_by_ids(payload.ids)

    # Dedupe by site + vessel + voyage; remember every collection that holds the row
    groups: dict[tuple[str, str, str], dict] = {}
    for r in rows:
        vessel_name = (r.get("vessel_name") or "").strip()
        if not vessel_name:
            continue
        site_id = (r.get("site_id") or "").strip().upper()
        voyage = (r.get("in_out_voyage") or "").strip()
        key = (site_id, vessel_name.upper(), voyage.upper())
        group = groups.setdefault(key, {"site_id": site_id, "vessel_name": vessel_name, "voyage": voyage, "collections": set()})
        group["collections"].add(r["collection_id"])

    updated = 0
    not_found: list[str] = []
    errors: list[str] = []
    logger.info(f"[API /vessels/resync] Resyncing {len(groups)} unique vessel/voyage(s) from {len(rows)} row(s)")
    for idx, group in enumerate(groups.values()):
        if idx > 0:
            time.sleep(RESYNC_VESSEL_DELAY_SECONDS)
        label = f"{group['vessel_name']} / {group['voyage']}" if group["voyage"] else group["vessel_name"]
        if group["site_id"]:
            label = f"{label} ({group['site_id']})"
        try:
            results = search_vessels(group["site_id"], group["vessel_name"], group["voyage"] or None)
        except Exception as e:
            logger.exception(f"[API /vessels/resync] ❌ Error resyncing {label}: {e}")
            errors.append(f"{label}: {e}")
            continue
        if not results:
            not_found.append(label)
            continue
        try:
            for col_id in sorted(group["collections"]):
                insert_vessel_schedules(col_id, results)
                updated += len(results)
        except Exception as e:
            logger.exception(f"[API /vessels/resync] ❌ Error saving {label}: {e}")
            errors.append(f"{label}: {e}")

    logger.info(f"[API /vessels/resync] Done. updated={updated}, not_found={len(not_found)}, errors={len(errors)}")
    return {"status": "success", "updated": updated, "not_found": not_found, "errors": errors}

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

@router.post("/watchlist/batch-add")
def add_watchlist_batch(payload: VesselWatchlistBatchAddRequest):
    added = add_vessel_watchlist_batch(payload.collection_id, [it.model_dump() for it in payload.items])
    return {"status": "success", "added": added}

@router.post("/watchlist/batch-remove")
def remove_watchlist_batch(payload: BatchIdsRequest):
    removed = remove_vessel_watchlist_batch(payload.ids)
    return {"status": "success", "removed": removed}

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
                update_watchlist_sync_status("vessel", item["id"], "ok", f"{len(res)} schedule(s)")
                logger.info(f"[API /vessels/watchlist/sync] ✅ Updated {len(res)} schedule(s) for '{v_name}' (Voyage: '{v_voyage}')")
            else:
                update_watchlist_sync_status(
                    "vessel", item["id"], "not_found",
                    f"Không tìm thấy lịch tàu '{v_name}' khớp số chuyến '{v_voyage}' trên ePort" if v_voyage
                    else f"Không tìm thấy lịch tàu '{v_name}' trên ePort"
                )
                logger.warning(f"[API /vessels/watchlist/sync] ⚠️ No matching voyage on ePort for '{v_name}' ('{v_voyage}') -> Skipped, DB preserved.")
        except Exception as e:
            err_msg = f"{v_name}/{v_voyage}: {e}"
            errors.append(err_msg)
            try:
                update_watchlist_sync_status("vessel", item["id"], "error", str(e))
            except Exception:
                logger.exception("[API /vessels/watchlist/sync] Could not record sync status")
            logger.exception(f"[API /vessels/watchlist/sync] ❌ Error syncing vessel {v_name}: {e}")

        # Wait 2 seconds between each vessel API call to avoid overloading ePort
        if idx < len(watchlist) - 1:
            time.sleep(2)

    logger.info(f"[API /vessels/watchlist/sync] Sync completed. Total schedules updated: {updated_count}, errors: {len(errors)}")
    return {"updated_count": updated_count, "errors": errors}

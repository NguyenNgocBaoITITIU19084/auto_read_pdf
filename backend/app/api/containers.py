import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from backend.app.core.database import (
    get_containers, insert_containers, delete_container, delete_containers_batch, clear_containers,
    get_container_watchlist, add_to_container_watchlist, remove_from_container_watchlist,
    add_container_watchlist_batch, remove_container_watchlist_batch, get_containers_by_ids,
    update_watchlist_sync_status, get_containers_page, get_container_ids
)
from backend.app.services.eport_client import search_containers
from backend.app.schemas.models import (
    ContainerSearchRequest, ContainerWatchlistAddRequest, BatchDeleteRequest,
    ContainerWatchlistBatchAddRequest, BatchIdsRequest, ResyncRequest, ResyncResponse,
    ContainerResyncRequest
)

logger = logging.getLogger("backend.api.containers")
router = APIRouter(prefix="/containers", tags=["Containers"])

# NOTE: every endpoint here is a plain `def` so FastAPI runs it in the threadpool —
# DB and ePort calls never block the event loop.

@router.get("")
def list_containers(
    collection_id: int = Query(..., description="ID of the collection"),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None)
):
    return get_containers(collection_id, search_query, search_field)

@router.get("/page")
def list_containers_page(
    collection_id: int = Query(...),
    limit: int = Query(50),
    offset: int = Query(0),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
):
    return get_containers_page(collection_id, limit, offset, search_query, search_field, event_type)

@router.get("/ids")
def list_container_ids(
    collection_id: int = Query(...),
    search_query: Optional[str] = Query(None),
    search_field: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
):
    return {"ids": get_container_ids(collection_id, search_query, search_field, event_type)}

@router.post("/by-ids")
def list_containers_by_ids(payload: BatchIdsRequest):
    return get_containers_by_ids(payload.ids)

@router.post("/search")
def query_containers(payload: ContainerSearchRequest):
    logger.info(
        f"[API /containers/search] User searching: site='{payload.site_id}', containers='{payload.container_nos}', "
        f"is_in_yard={payload.is_search_by_in_yard}, is_batch={payload.is_search_by_batch}, collection_id={payload.collection_id}"
    )
    try:
        results = search_containers(
            payload.site_id,
            payload.container_nos,
            is_search_by_in_yard=bool(payload.is_search_by_in_yard),
            is_search_by_batch=bool(payload.is_search_by_batch)
        )
        if results:
            insert_containers(payload.collection_id, results)
            logger.info(f"[API /containers/search] ✅ Found and saved {len(results)} container event(s)")
        else:
            logger.warning(f"[API /containers/search] ⚠️ No container info found for '{payload.container_nos}'")
        message = "Không tìm thấy thông tin container trên ePort" if len(results) == 0 else ""
        return {"count": len(results), "items": results, "message": message}
    except Exception as e:
        logger.exception(f"[API /containers/search] ❌ Error querying containers: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/batch-delete")
def remove_containers_batch(payload: BatchDeleteRequest):
    delete_containers_batch(payload.ids)
    return {"status": "success", "deleted_count": len(payload.ids)}

def _result_container_no(r: dict) -> str:
    return str(r.get("CONTAINERNO", r.get("containerno", "")) or "").strip().upper()

@router.post("/resync", response_model=ResyncResponse)
def resync_containers(payload: ContainerResyncRequest):
    """Re-query ePort for the selected rows (one call per site). Only events of the selected rows' types are
    saved unless all_events=true."""
    rows = get_containers_by_ids(payload.ids)

    # site_id -> container_no -> {"collections": set[int], "events": set[str] ("" = any event)}
    by_site: dict[str, dict[str, dict]] = {}
    for r in rows:
        cont_no = (r.get("containerno") or "").strip().upper()
        if not cont_no:
            continue
        site_id = (r.get("site_id") or "").strip().upper()
        entry = by_site.setdefault(site_id, {}).setdefault(cont_no, {"collections": set(), "events": set()})
        entry["collections"].add(r["collection_id"])
        entry["events"].add((r.get("event_type") or "").strip().upper())

    updated = 0
    not_found: list[str] = []
    errors: list[str] = []
    for site_id, conts in by_site.items():
        cont_nos = sorted(conts)
        try:
            results = search_containers(site_id, ",".join(cont_nos)) or []
        except Exception as e:
            logger.exception(f"[API /containers/resync] ❌ Error resyncing site '{site_id}': {e}")
            errors.append(f"{site_id or '-'}: {e}")
            continue

        found: set[str] = set()
        per_collection: dict[int, list[dict]] = {}
        for res in results:
            cont_no = _result_container_no(res)
            entry = conts.get(cont_no)
            if not entry:
                continue
            event = str(res.get("EVENT_TYPE", res.get("event_type", "")) or "").strip().upper()
            if not (payload.all_events or "" in entry["events"] or event in entry["events"]):
                continue
            found.add(cont_no)
            for col_id in entry["collections"]:
                per_collection.setdefault(col_id, []).append(res)

        try:
            for col_id, items in per_collection.items():
                insert_containers(col_id, items)
                updated += len(items)
        except Exception as e:
            logger.exception(f"[API /containers/resync] ❌ Error saving results for site '{site_id}': {e}")
            errors.append(f"{site_id or '-'}: {e}")

        not_found.extend(c for c in cont_nos if c not in found)

    logger.info(f"[API /containers/resync] Done. all_events={payload.all_events}, updated={updated}, not_found={len(not_found)}, errors={len(errors)}")
    return {"status": "success", "updated": updated, "not_found": not_found, "errors": errors}

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
    add_to_container_watchlist(
        payload.collection_id,
        payload.site_id,
        payload.container_no,
        payload.event_type or ""
    )
    return {"status": "success"}

@router.post("/watchlist/batch-add")
def add_container_watchlist_batch_items(payload: ContainerWatchlistBatchAddRequest):
    added = add_container_watchlist_batch(payload.collection_id, [it.model_dump() for it in payload.items])
    return {"status": "success", "added": added}

@router.post("/watchlist/batch-remove")
def remove_container_watchlist_batch_items(payload: BatchIdsRequest):
    removed = remove_container_watchlist_batch(payload.ids)
    return {"status": "success", "removed": removed}

@router.delete("/watchlist/{watchlist_id}")
def delete_container_watchlist_item(watchlist_id: int):
    remove_from_container_watchlist(watchlist_id)
    return {"status": "success", "deleted_id": watchlist_id}

def _record_status(watchlist_id: int, status: str, message: str = ""):
    try:
        update_watchlist_sync_status("container", watchlist_id, status, message)
    except Exception:
        logger.exception("[API /containers/watchlist/sync] Could not record sync status")

@router.post("/watchlist/sync")
def sync_collection_container_watchlist(collection_id: int = Query(...)):
    watchlist = get_container_watchlist(collection_id)
    if not watchlist:
        return {"updated_count": 0, "errors": []}

    by_site = {}
    for item in watchlist:
        by_site.setdefault(item["site_id"], []).append(item)

    updated_count = 0
    errors = []
    for site, items in by_site.items():
        unique_cont_nos = list(set([it["container_no"].strip().upper() for it in items if it.get("container_no")]))
        if not unique_cont_nos:
            continue
        try:
            res = search_containers(site, ",".join(unique_cont_nos)) or []
            # Filter results to strictly match watched container_no AND event_type (if specified)
            filtered_res = []
            matched_ids = set()
            for r in res:
                r_cont = _result_container_no(r)
                r_event = str(r.get("EVENT_TYPE", r.get("event_type", ""))).strip().upper()
                matched = False
                for it in items:
                    it_event = (it.get("event_type") or "").strip().upper()
                    if it["container_no"].strip().upper() == r_cont and (not it_event or it_event == "ALL" or it_event == r_event):
                        matched_ids.add(it["id"])
                        matched = True
                if matched:
                    filtered_res.append(r)

            if filtered_res:
                insert_containers(collection_id, filtered_res)
                updated_count += len(filtered_res)
            for it in items:
                if it["id"] in matched_ids:
                    _record_status(it["id"], "ok")
                else:
                    _record_status(it["id"], "not_found", "Không tìm thấy thông tin container phù hợp trên ePort")
        except Exception as e:
            logger.exception(f"[API /containers/watchlist/sync] ❌ Error syncing site {site}: {e}")
            errors.append(f"Site {site}: {e}")
            for it in items:
                _record_status(it["id"], "error", str(e))

    return {"updated_count": updated_count, "errors": errors}

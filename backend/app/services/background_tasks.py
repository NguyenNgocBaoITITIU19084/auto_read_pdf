import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from backend.app.core.database import (
    get_all_watchlists, get_all_container_watchlists,
    insert_vessel_schedules, insert_containers
)
from backend.app.services.eport_client import search_vessels, search_containers

logger = logging.getLogger("backend.background_tasks")

scheduler = AsyncIOScheduler()
is_auto_sync_enabled = False
sync_interval_minutes = 10

async def sync_vessel_watchlists():
    try:
        watchlists = await asyncio.to_thread(get_all_watchlists)
        if not watchlists:
            logger.info("[Auto-Sync Vessels] ℹ️ Watchlist is empty, nothing to sync.")
            return
            
        logger.info(f"[Auto-Sync Vessels] 🚀 Auto-syncing {len(watchlists)} vessel watchlist item(s)...")
        for idx, item in enumerate(watchlists):
            col_id = item["collection_id"]
            site_id = item["site_id"]
            vessel_name = item["vessel_name"]
            voyage = item.get("voyage", "")
            logger.info(f"[Auto-Sync Vessels] ({idx + 1}/{len(watchlists)}) Syncing: Vessel='{vessel_name}', Voyage='{voyage}', Site='{site_id}', Collection={col_id}")
            try:
                schedules = await asyncio.to_thread(search_vessels, site_id, vessel_name, voyage)
                if schedules:
                    await asyncio.to_thread(insert_vessel_schedules, col_id, schedules)
                    logger.info(f"[Auto-Sync Vessels] ✅ Updated {len(schedules)} schedule(s) for '{vessel_name}' ({voyage})")
                else:
                    logger.warning(f"[Auto-Sync Vessels] ⚠️ No schedules found for '{vessel_name}' ({voyage}) at site '{site_id}'")
            except Exception as e:
                logger.error(f"[Auto-Sync Vessels] ❌ Error syncing vessel {vessel_name}/{voyage}: {e}")
            
            # Wait 2 seconds between each vessel API call to avoid overloading ePort
            if idx < len(watchlists) - 1:
                await asyncio.sleep(2)
        logger.info("[Auto-Sync Vessels] 🎉 Completed syncing all vessel watchlists.")
    except Exception as e:
        logger.error(f"[Auto-Sync Vessels] ❌ Fatal error in sync_vessel_watchlists: {e}")

async def sync_container_watchlists():
    try:
        c_watchlists = await asyncio.to_thread(get_all_container_watchlists)
        if not c_watchlists:
            logger.info("[Auto-Sync Containers] ℹ️ Watchlist is empty, nothing to sync.")
            return
            
        logger.info(f"[Auto-Sync Containers] 🚀 Auto-syncing {len(c_watchlists)} container watchlist item(s)...")
        by_col_and_site = {}
        for cw in c_watchlists:
            key = (cw["collection_id"], cw["site_id"])
            if key not in by_col_and_site:
                by_col_and_site[key] = []
            by_col_and_site[key].append(cw)
            
        for (col_id, site_id), items in by_col_and_site.items():
            unique_cont_nos = list(set([it["container_no"].strip().upper() for it in items if it.get("container_no")]))
            if not unique_cont_nos:
                continue
            cont_str = ",".join(unique_cont_nos)
            logger.info(f"[Auto-Sync Containers] Syncing {len(unique_cont_nos)} container(s) for Collection {col_id} at site '{site_id}': {cont_str}")
            try:
                results = await asyncio.to_thread(search_containers, site_id, cont_str)
                if results:
                    # Filter results: Only keep results strictly matching watched container_no AND event_type (if specified)
                    filtered_results = []
                    for r in results:
                        r_cont = str(r.get("CONTAINERNO", r.get("containerno", ""))).strip().upper()
                        r_event = str(r.get("EVENT_TYPE", r.get("event_type", ""))).strip().upper()
                        
                        matches = any(
                            it["container_no"].strip().upper() == r_cont and 
                            (not it.get("event_type") or it["event_type"].strip().upper() == "ALL" or it["event_type"].strip().upper() == r_event)
                            for it in items
                        )
                        if matches:
                            filtered_results.append(r)

                    if filtered_results:
                        await asyncio.to_thread(insert_containers, col_id, filtered_results)
                        logger.info(f"[Auto-Sync Containers] ✅ Updated {len(filtered_results)} container event(s) for {cont_str}")
                    else:
                        logger.info(f"[Auto-Sync Containers] ℹ️ No matching events found for watched event_types for {cont_str}")
                else:
                    logger.warning(f"[Auto-Sync Containers] ⚠️ No container info found for {cont_str} at site '{site_id}'")
            except Exception as e:
                logger.error(f"[Auto-Sync Containers] ❌ Error syncing containers {unique_cont_nos}: {e}")
        logger.info("[Auto-Sync Containers] 🎉 Completed syncing all container watchlists.")
    except Exception as e:
        logger.error(f"[Auto-Sync Containers] ❌ Fatal error in sync_container_watchlists: {e}")

async def run_sync_all():
    logger.info("🔄 ==================== Starting Auto-Sync Cycle ====================")
    await sync_vessel_watchlists()
    await sync_container_watchlists()
    logger.info("🏁 ==================== Auto-Sync Cycle Finished ====================")

def setup_scheduler():
    try:
        if not scheduler.running:
            scheduler.start()
            logger.info("AsyncIOScheduler started.")
    except Exception as e:
        logger.warning(f"Could not start scheduler immediately: {e}")

async def toggle_auto_sync(enable: bool, interval_minutes: int = 10):
    global is_auto_sync_enabled, sync_interval_minutes
    is_auto_sync_enabled = enable
    sync_interval_minutes = max(1, interval_minutes)
    
    # Ensure scheduler is started
    setup_scheduler()
        
    # Remove existing job if any
    try:
        scheduler.remove_job("auto_sync_job")
    except Exception:
        pass
        
    if enable:
        try:
            scheduler.add_job(
                run_sync_all,
                "interval",
                minutes=sync_interval_minutes,
                id="auto_sync_job"
            )
            logger.info(f"Auto-sync scheduled every {sync_interval_minutes} minutes")
        except Exception as e:
            logger.warning(f"Error adding auto_sync_job: {e}")
        
        # Trigger an immediate run in background right away
        try:
            asyncio.create_task(run_sync_all())
            logger.info("Triggered immediate sync cycle upon enabling auto-sync")
        except Exception as e:
            logger.warning(f"Could not trigger immediate run: {e}")
    else:
        logger.info("Auto-sync disabled")
        
    return {"enabled": is_auto_sync_enabled, "interval_minutes": sync_interval_minutes}

def get_auto_sync_status():
    return {"enabled": is_auto_sync_enabled, "interval_minutes": sync_interval_minutes}

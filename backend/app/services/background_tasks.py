import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from backend.app.core.database import (
    get_all_watchlists, get_all_container_watchlists,
    insert_vessel_schedules, insert_containers
)
from backend.app.services.eport_client import search_vessels, search_containers

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()
is_auto_sync_enabled = False
sync_interval_minutes = 10

async def sync_vessel_watchlists():
    try:
        watchlists = await asyncio.to_thread(get_all_watchlists)
        if not watchlists:
            return
            
        logger.info(f"Auto-syncing {len(watchlists)} vessel watchlist items...")
        for idx, item in enumerate(watchlists):
            col_id = item["collection_id"]
            site_id = item["site_id"]
            vessel_name = item["vessel_name"]
            voyage = item.get("voyage", "")
            try:
                schedules = await asyncio.to_thread(search_vessels, site_id, vessel_name, voyage)
                if schedules:
                    await asyncio.to_thread(insert_vessel_schedules, col_id, schedules)
                    logger.info(f"Updated {len(schedules)} schedules for vessel {vessel_name}")
            except Exception as e:
                logger.warning(f"Error syncing vessel {vessel_name}/{voyage}: {e}")
            
            # Wait 2 seconds between each vessel API call to avoid overloading ePort
            if idx < len(watchlists) - 1:
                await asyncio.sleep(2)
    except Exception as e:
        logger.error(f"Error in sync_vessel_watchlists: {e}")

async def sync_container_watchlists():
    try:
        c_watchlists = await asyncio.to_thread(get_all_container_watchlists)
        if not c_watchlists:
            return
            
        logger.info(f"Auto-syncing {len(c_watchlists)} container watchlist items...")
        by_col_and_site = {}
        for cw in c_watchlists:
            key = (cw["collection_id"], cw["site_id"])
            if key not in by_col_and_site:
                by_col_and_site[key] = []
            by_col_and_site[key].append(cw["container_no"])
            
        for (col_id, site_id), cont_list in by_col_and_site.items():
            try:
                cont_str = ",".join(cont_list)
                results = await asyncio.to_thread(search_containers, site_id, cont_str)
                if results:
                    await asyncio.to_thread(insert_containers, col_id, results)
                    logger.info(f"Updated {len(results)} container events for {cont_str}")
            except Exception as e:
                logger.warning(f"Error syncing containers {cont_list}: {e}")
    except Exception as e:
        logger.error(f"Error in sync_container_watchlists: {e}")

async def run_sync_all():
    logger.info("Starting Auto-Sync cycle for all watchlists...")
    await sync_vessel_watchlists()
    await sync_container_watchlists()
    logger.info("Auto-Sync cycle completed.")

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

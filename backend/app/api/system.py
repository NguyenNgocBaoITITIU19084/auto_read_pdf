import logging
from fastapi import APIRouter, HTTPException
from backend.app.services import resource_monitor
from backend.app.schemas.models import SystemResourcesResponse, FreeMemoryResponse

logger = logging.getLogger("backend.api.system")
router = APIRouter(prefix="/system", tags=["System"])

# Plain `def`: psutil calls block, so FastAPI runs these in its threadpool.
@router.get("/resources", response_model=SystemResourcesResponse)
def get_resources():
    try:
        return resource_monitor.get_resource_snapshot()
    except Exception as e:
        logger.error(f"Error reading system resources: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/free-memory", response_model=FreeMemoryResponse)
def free_memory():
    return resource_monitor.free_backend_memory()

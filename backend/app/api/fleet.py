"""Fleet: trucks, drivers, trailers, who drives which truck and which truck pulls which trailer. Errors answer {"detail": "<Vietnamese message>"}."""
from typing import List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.core import fleet
from backend.app.core import fleet_trailers as trailers

router = APIRouter(prefix="/fleet", tags=["Fleet"])


class VehicleIn(BaseModel):
    plate: Optional[str] = None
    category: Optional[str] = None        # on create only: tractor (đầu kéo, the default) / truck (xe tải)
    trailer_plate: Optional[str] = None   # tractors only
    vehicle_type: Optional[str] = None
    body_type: Optional[str] = None       # trucks: loại thùng
    payload: Optional[str] = None         # trucks: tải trọng
    ownership_expiry: Optional[str] = None   # hạn đăng ký
    registration_expiry: Optional[str] = None
    insurance_expiry: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None


class DriverIn(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    id_number: Optional[str] = None
    license_no: Optional[str] = None
    license_class: Optional[str] = None
    license_expiry: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None
    home_vehicle_id: Optional[int] = None


class VehicleStatusIn(BaseModel):
    status: str
    reason: str = ""
    move_to_vehicle_id: Optional[int] = None
    # running again ("Đã sửa xong"): also bring its home driver back from a temporary truck
    bring_home_driver: bool = False


class HomeVehicleIn(BaseModel):
    vehicle_id: Optional[int] = None
    force: bool = False


class MoveIn(BaseModel):
    vehicle_id: int
    reason: str = ""


class ReasonIn(BaseModel):
    reason: str = ""


class TrailerIn(BaseModel):
    plate: Optional[str] = None
    trailer_type: Optional[str] = None
    chassis_no: Optional[str] = None
    payload: Optional[str] = None
    year: Optional[str] = None
    ownership_expiry: Optional[str] = None
    registration_expiry: Optional[str] = None
    insurance_expiry: Optional[str] = None
    status: Optional[str] = None
    note: Optional[str] = None
    vehicle_id: Optional[int] = None      # on create only: hitch it to this tractor


class HitchIn(BaseModel):
    vehicle_id: Optional[int] = None      # null: unhitch
    reason: str = ""


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except fleet.FleetError as e:
        raise HTTPException(status_code=e.status, detail=e.message)


def _vehicle(vehicle_id: int) -> dict:
    found = next((v for v in fleet.list_vehicles() if v["id"] == vehicle_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="Không tìm thấy xe")
    return found


def _driver(driver_id: int) -> dict:
    found = next((d for d in fleet.list_drivers() if d["id"] == driver_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="Không tìm thấy tài xế")
    return found


# --- trucks ---------------------------------------------------------------
@router.get("/vehicles")
def list_vehicles():
    return fleet.list_vehicles()


@router.post("/vehicles")
def create_vehicle(payload: VehicleIn):
    vehicle_id = _run(fleet.create_vehicle, payload.model_dump(exclude_none=True))
    return _vehicle(vehicle_id)


@router.put("/vehicles/{vehicle_id}")
def update_vehicle(vehicle_id: int, payload: VehicleIn):
    _run(fleet.update_vehicle, vehicle_id, payload.model_dump(exclude_unset=True))
    return _vehicle(vehicle_id)


@router.delete("/vehicles/{vehicle_id}")
def delete_vehicle(vehicle_id: int):
    _run(fleet.delete_vehicle, vehicle_id)
    return {"status": "success"}


@router.post("/vehicles/{vehicle_id}/status")
def set_vehicle_status(vehicle_id: int, payload: VehicleStatusIn):
    """Status change and, for a truck that stops running, where its driver goes, in one step."""
    return _run(fleet.set_vehicle_status, vehicle_id, payload.status, payload.reason, payload.move_to_vehicle_id,
                payload.bring_home_driver)


# --- drivers --------------------------------------------------------------
@router.get("/drivers")
def list_drivers():
    return fleet.list_drivers()


@router.post("/drivers")
def create_driver(payload: DriverIn):
    driver_id = _run(fleet.create_driver, payload.model_dump(exclude_none=True))
    return _driver(driver_id)


@router.put("/drivers/{driver_id}")
def update_driver(driver_id: int, payload: DriverIn):
    data = payload.model_dump(exclude_unset=True)
    data.pop("home_vehicle_id", None)  # the home truck changes through /home (it can move people)
    _run(fleet.update_driver, driver_id, data)
    return _driver(driver_id)


@router.delete("/drivers/{driver_id}")
def delete_driver(driver_id: int):
    _run(fleet.delete_driver, driver_id)
    return {"status": "success"}


@router.post("/drivers/{driver_id}/home")
def set_home_vehicle(driver_id: int, payload: HomeVehicleIn):
    """Give the driver a home truck (vehicle_id null: none). 409 when it belongs to / is driven by someone else,
    unless force."""
    _run(fleet.set_home_vehicle, driver_id, payload.vehicle_id, payload.force)
    return _driver(driver_id)


@router.post("/drivers/{driver_id}/temporary")
def move_temporary(driver_id: int, payload: MoveIn):
    _run(fleet.move_temporary, driver_id, payload.vehicle_id, payload.reason)
    return _driver(driver_id)


@router.post("/drivers/{driver_id}/return-home")
def return_home(driver_id: int):
    _run(fleet.return_home, driver_id)
    return _driver(driver_id)


@router.post("/drivers/{driver_id}/unassign")
def unassign(driver_id: int, payload: ReasonIn):
    _run(fleet.unassign, driver_id, payload.reason)
    return _driver(driver_id)


@router.post("/drivers/{driver_id}/revoke")
def revoke_vehicle(driver_id: int, payload: ReasonIn):
    """Thu hồi xe: no home truck, off any truck they drive."""
    _run(fleet.revoke_vehicle, driver_id, payload.reason)
    return _driver(driver_id)


# --- trailers -------------------------------------------------------------
@router.get("/trailers")
def list_trailers():
    return trailers.list_trailers()


@router.post("/trailers")
def create_trailer(payload: TrailerIn):
    trailer_id = _run(trailers.create_trailer, payload.model_dump(exclude_none=True))
    return _run(trailers.get_trailer, trailer_id)


@router.put("/trailers/{trailer_id}")
def update_trailer(trailer_id: int, payload: TrailerIn):
    data = payload.model_dump(exclude_unset=True)
    data.pop("vehicle_id", None)  # hitching goes through /hitch
    _run(trailers.update_trailer, trailer_id, data)
    return _run(trailers.get_trailer, trailer_id)


@router.delete("/trailers/{trailer_id}")
def delete_trailer(trailer_id: int):
    _run(trailers.delete_trailer, trailer_id)
    return {"status": "success"}


@router.post("/trailers/{trailer_id}/hitch")
def hitch_trailer(trailer_id: int, payload: HitchIn):
    """Hitch to a tractor (off any other one, and the tractor's own trailer off it), or unhitch (vehicle_id null).
    Answers the trailer plus {"replaced", "from_plate"}."""
    moved = _run(trailers.hitch, trailer_id, payload.vehicle_id, payload.reason)
    return {**_run(trailers.get_trailer, trailer_id), **moved}


@router.get("/trailers/history/page")
def trailer_history_page(trailer_id: Optional[int] = None, vehicle_id: Optional[int] = None,
                         states: Optional[List[str]] = Query(None), q: str = "", sort_by: Optional[str] = None,
                         sort_dir: str = "desc", limit: int = 50, offset: int = 0):
    """A page of the hitch history: {"items", "total"} (see fleet_trailers.hitch_page)."""
    return trailers.hitch_page(trailer_id, vehicle_id, states, q, sort_by, sort_dir, limit, offset)


@router.get("/trailers/history")
def trailer_history(trailer_id: Optional[int] = None, vehicle_id: Optional[int] = None, limit: int = 200):
    return trailers.hitch_history(trailer_id, vehicle_id, limit)


@router.post("/trailers/{trailer_id}/photo")
async def upload_trailer_photo(trailer_id: int, file: UploadFile = File(...)):
    _run(fleet.set_photo, "trailer", trailer_id, await file.read())
    return _run(trailers.get_trailer, trailer_id)


@router.delete("/trailers/{trailer_id}/photo")
def delete_trailer_photo(trailer_id: int):
    _run(fleet.remove_photo, "trailer", trailer_id)
    return _run(trailers.get_trailer, trailer_id)


@router.post("/trailers/{trailer_id}/documents/{which}")
async def upload_trailer_document(trailer_id: int, which: str, file: UploadFile = File(...)):
    """A scan of the trailer's đăng kiểm / bảo hiểm / đăng ký xe, front or back (`which`: registration_front, ...)."""
    _run(fleet.set_document, "trailer", trailer_id, which, await file.read())
    return _run(trailers.get_trailer, trailer_id)


@router.delete("/trailers/{trailer_id}/documents/{which}")
def delete_trailer_document(trailer_id: int, which: str):
    _run(fleet.remove_document, "trailer", trailer_id, which)
    return _run(trailers.get_trailer, trailer_id)


# --- photos -----------------------------------------------------------------
@router.post("/vehicles/{vehicle_id}/photo")
async def upload_vehicle_photo(vehicle_id: int, file: UploadFile = File(...)):
    _run(fleet.set_photo, "vehicle", vehicle_id, await file.read())
    return _vehicle(vehicle_id)


@router.delete("/vehicles/{vehicle_id}/photo")
def delete_vehicle_photo(vehicle_id: int):
    _run(fleet.remove_photo, "vehicle", vehicle_id)
    return _vehicle(vehicle_id)


@router.post("/drivers/{driver_id}/photo")
async def upload_driver_photo(driver_id: int, file: UploadFile = File(...)):
    _run(fleet.set_photo, "driver", driver_id, await file.read())
    return _driver(driver_id)


@router.delete("/drivers/{driver_id}/photo")
def delete_driver_photo(driver_id: int):
    _run(fleet.remove_photo, "driver", driver_id)
    return _driver(driver_id)


@router.post("/drivers/{driver_id}/documents/{which}")
async def upload_driver_document(driver_id: int, which: str, file: UploadFile = File(...)):
    """A scan of the driver's papers: which = license_front, license_back, id_front or id_back."""
    _run(fleet.set_driver_document, driver_id, which, await file.read())
    return _driver(driver_id)


@router.delete("/drivers/{driver_id}/documents/{which}")
def delete_driver_document(driver_id: int, which: str):
    _run(fleet.remove_driver_document, driver_id, which)
    return _driver(driver_id)


@router.post("/vehicles/{vehicle_id}/documents/{which}")
async def upload_vehicle_document(vehicle_id: int, which: str, file: UploadFile = File(...)):
    """A scan of the truck's papers: which = registration_front / _back (đăng kiểm), insurance_front / _back,
    ownership_front / _back (giấy đăng ký xe)."""
    _run(fleet.set_document, "vehicle", vehicle_id, which, await file.read())
    return _vehicle(vehicle_id)


@router.delete("/vehicles/{vehicle_id}/documents/{which}")
def delete_vehicle_document(vehicle_id: int, which: str):
    _run(fleet.remove_document, "vehicle", vehicle_id, which)
    return _vehicle(vehicle_id)


@router.get("/photos/{name}")
def get_photo(name: str):
    """A stored photo. Names change with every upload, so it can be cached for good."""
    path = fleet.photo_path(name)
    if not path:
        raise HTTPException(status_code=404, detail="Không tìm thấy ảnh")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


# --- trash -----------------------------------------------------------------------
class TrashIdsIn(BaseModel):
    kind: str
    ids: List[int] = []


@router.get("/trash")
def list_trash(kind: str, limit: int = 50, offset: int = 0):
    """Tractors (kind=vehicle), trucks (kind=truck), drivers (kind=driver) or trailers (kind=trailer) in the trash,
    last deleted first."""
    return _run(fleet.trash_page, kind, limit, offset)


@router.get("/trash/ids")
def list_trash_ids(kind: str):
    return {"ids": _run(fleet.trash_ids, kind)}


@router.get("/trash/count")
def trash_count():
    """{"vehicle": n, "driver": n, "trailer": n}"""
    return fleet.trash_count()


@router.post("/trash/restore")
def restore_trash(payload: TrashIdsIn):
    return {"status": "success", "restored": _run(fleet.restore_from_trash, payload.kind, payload.ids)}


@router.post("/trash/delete")
def delete_trash(payload: TrashIdsIn):
    return {"status": "success", "deleted": _run(fleet.delete_from_trash, payload.kind, payload.ids)}


# --- history / documents --------------------------------------------------
@router.get("/history")
def history(driver_id: Optional[int] = None, vehicle_id: Optional[int] = None, limit: int = 200):
    return fleet.list_history(driver_id, vehicle_id, limit)


@router.get("/history/page")
def history_page(driver_id: Optional[int] = None, vehicle_id: Optional[int] = None,
                 kinds: Optional[List[str]] = Query(None), states: Optional[List[str]] = Query(None), q: str = "",
                 sort_by: Optional[str] = None, sort_dir: str = "desc", limit: int = 50, offset: int = 0,
                 category: Optional[str] = None):
    """A page of the assignment history: {"items", "total"} (see fleet.history_page); `category` (tractor / truck)
    keeps that kind of truck only."""
    return fleet.history_page(driver_id, vehicle_id, kinds, states, q, sort_by, sort_dir, limit, offset, category)


@router.get("/expiring")
def expiring(days: int = fleet.EXPIRY_REMINDER_DAYS[0]):
    """Documents expiring within `days` days (or already expired), soonest first."""
    from datetime import datetime
    from backend.app.core.timezone import VN_TZ
    return fleet.expiring_documents(datetime.now(VN_TZ).date(), max(0, min(int(days), 365)))

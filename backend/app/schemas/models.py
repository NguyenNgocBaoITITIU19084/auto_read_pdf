from typing import Optional, List, Any
from pydantic import BaseModel

class CollectionCreate(BaseModel):
    name: str

class CollectionUpdateSettings(BaseModel):
    settings: str

class CollectionResponse(BaseModel):
    id: int
    name: str
    created_at: str
    settings: Optional[str] = None

class BookingItem(BaseModel):
    id: Optional[int] = None
    pdf_name: Optional[str] = None
    booking_no: Optional[str] = None
    port_of_discharging: Optional[str] = None
    place_of_delivery: Optional[str] = None
    block_val: Optional[str] = None
    ts_port: Optional[str] = None
    equipment_type: Optional[str] = None
    qty: Optional[str] = None
    empty_pickup_cy: Optional[str] = None
    full_return_cy: Optional[str] = None
    cutoff_time: Optional[str] = None
    vessel: Optional[str] = None
    etd: Optional[str] = None

class VesselSearchRequest(BaseModel):
    collection_id: int
    site_id: str
    vessel_name: str
    voyage: Optional[str] = None

class VesselWatchlistAddRequest(BaseModel):
    collection_id: int
    site_id: str
    vessel_name: str
    voyage: Optional[str] = ""

class ContainerSearchRequest(BaseModel):
    collection_id: int
    site_id: str
    container_nos: str

class ContainerWatchlistAddRequest(BaseModel):
    collection_id: int
    site_id: str
    container_no: str

class ExportExcelRequest(BaseModel):
    data: List[dict]
    selected_columns: List[str]

class AutoSyncToggleRequest(BaseModel):
    enable: bool
    interval_minutes: Optional[int] = 10

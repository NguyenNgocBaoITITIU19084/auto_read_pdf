from typing import Optional, List, Any, Literal
from pydantic import BaseModel, ConfigDict, Field

class CollectionCreate(BaseModel):
    name: str

class CollectionUpdateSettings(BaseModel):
    settings: str

class CollectionRename(BaseModel):
    name: str

class CollectionResponse(BaseModel):
    id: int
    name: str
    created_at: str
    settings: Optional[str] = None
    booking_count: Optional[int] = None
    vessel_count: Optional[int] = None
    container_count: Optional[int] = None
    watchlist_count: Optional[int] = None

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
    save: Optional[bool] = True

class VesselSaveResultsRequest(BaseModel):
    collection_id: int
    items: List[dict]

class VesselWatchlistAddRequest(BaseModel):
    collection_id: int
    site_id: str
    vessel_name: str
    voyage: Optional[str] = ""

class ContainerSearchRequest(BaseModel):
    collection_id: int
    site_id: str
    container_nos: str
    is_search_by_in_yard: Optional[bool] = False
    is_search_by_batch: Optional[bool] = False

class ContainerWatchlistAddRequest(BaseModel):
    collection_id: int
    site_id: str
    container_no: str
    event_type: Optional[str] = ""

class ExportExcelRequest(BaseModel):
    data: List[dict]
    selected_columns: List[str]

class AutoSyncToggleRequest(BaseModel):
    enable: bool
    interval_minutes: Optional[int] = 10
    mode: Optional[Literal["interval", "times"]] = None
    times: Optional[List[str]] = None

class BatchDeleteRequest(BaseModel):
    ids: List[int]

class BatchIdsRequest(BaseModel):
    ids: List[int]

class VesselWatchlistItem(BaseModel):
    site_id: Optional[str] = ""
    vessel_name: str
    voyage: Optional[str] = ""

class VesselWatchlistBatchAddRequest(BaseModel):
    collection_id: int
    items: List[VesselWatchlistItem]

class ContainerWatchlistItem(BaseModel):
    site_id: Optional[str] = ""
    container_no: str
    event_type: Optional[str] = ""

class ContainerWatchlistBatchAddRequest(BaseModel):
    collection_id: int
    items: List[ContainerWatchlistItem]

class ResyncRequest(BaseModel):
    ids: List[int]

class ContainerResyncRequest(ResyncRequest):
    all_events: Optional[bool] = False

class ResyncResponse(BaseModel):
    status: str
    updated: int
    not_found: List[str]
    errors: List[str]

class MoveItemsRequest(BaseModel):
    entity: Literal["bookings", "vessels", "containers"]
    ids: List[int]
    target_collection_id: int
    # JSON key is "copy"; renamed in Python to avoid shadowing BaseModel.copy
    copy_items: Optional[bool] = Field(default=False, alias="copy")
    model_config = ConfigDict(populate_by_name=True)

class ColorRuleCreate(BaseModel):
    target_table: Optional[str] = "all"
    column_key: Optional[str] = "all"
    match_value: str
    match_type: Optional[str] = "exact"
    preset_id: Optional[str] = None
    custom_bg: Optional[str] = None
    custom_border: Optional[str] = None
    custom_text: Optional[str] = None
    is_enabled: Optional[bool] = True

class ColorRuleUpdate(BaseModel):
    target_table: Optional[str] = None
    column_key: Optional[str] = None
    match_value: Optional[str] = None
    match_type: Optional[str] = None
    preset_id: Optional[str] = None
    custom_bg: Optional[str] = None
    custom_border: Optional[str] = None
    custom_text: Optional[str] = None
    is_enabled: Optional[bool] = None

class ColorRuleResponse(BaseModel):
    id: int
    target_table: str
    column_key: str
    match_value: str
    match_type: str
    preset_id: Optional[str] = None
    custom_bg: Optional[str] = None
    custom_border: Optional[str] = None
    custom_text: Optional[str] = None
    is_enabled: bool
    created_at: str

class DashboardKPIs(BaseModel):
    total_bookings: int
    total_estimated_teus: int
    customs_uncleared: int
    customs_cleared: int
    infras_unpaid: int
    infras_paid: int
    containers_in_yard: int
    containers_out_yard: int
    total_vessels: int
    watchlist_vessels: int
    total_containers: int
    watchlist_containers: int

class DistributionItem(BaseModel):
    name: str
    count: int
    percentage: float

class DashboardAlerts(BaseModel):
    critical_cutoffs: List[dict]
    uncleared_containers: List[dict]
    upcoming_vessels: List[dict]

class DashboardDistributions(BaseModel):
    carriers: List[DistributionItem]
    sites: List[DistributionItem]
    equipment_types: List[DistributionItem]
    container_events: List[DistributionItem]

class DashboardSummaryResponse(BaseModel):
    updated_at: str
    scope: dict
    kpis: DashboardKPIs
    alerts: DashboardAlerts
    distributions: DashboardDistributions


class SystemUsage(BaseModel):
    cpu_percent: float
    cpu_count: int
    ram_total: int
    ram_used: int
    ram_percent: float

class BackendProcessUsage(BaseModel):
    pid: int
    rss: int
    cpu_percent: float
    child_count: int

class SystemResourcesResponse(BaseModel):
    sampled_at: str
    system: SystemUsage
    backend: BackendProcessUsage

class FreeMemoryResponse(BaseModel):
    rss_before: int
    rss_after: int
    collected_objects: int

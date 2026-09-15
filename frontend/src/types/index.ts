export interface Collection {
  id: number;
  name: string;
  created_at: string;
  settings?: string | null;
}

export interface Booking {
  id: number;
  "Tên file PDF"?: string;
  "Booking No"?: string;
  "Carrier"?: string;
  "Port of Discharging"?: string;
  "Place of Delivery"?: string;
  "Block"?: string;
  "T/S Port"?: string;
  "Equipment Type"?: string;
  "Q'ty"?: string;
  "Empty Pick Up CY"?: string;
  "Full return CY"?: string;
  "Port Cargo Cut-off"?: string;
  "Vessel"?: string;
  "ETD"?: string;
  "Pre Carrier"?: string;
  "ETD_Pre"?: string;
  "Trunk Vessel"?: string;
  "ETD_Trunk"?: string;
  [key: string]: any;
}

export interface VesselSchedule {
  id: number;
  collection_id?: number;
  site_id: string;
  agent: string;
  vessel_name: string;
  in_out_voyage: string;
  actual_berth_time: string;
  actual_departure_time: string;
  closing_time: string;
  closing_time_icd: string;
  in_gate: string;
  open_ts: string;
  reefer_open_ts: string;
  oog_open_ts: string;
  haz_open_ts: string;
  remarks: string;
  queried_at: string;
  [key: string]: any;
}

export type WatchlistSyncStatus = 'ok' | 'not_found' | 'error';

export interface WatchlistSyncFields {
  /** Local time "%Y-%m-%d %H:%M:%S" of the last sync attempt for this item */
  last_sync_at?: string | null;
  last_sync_status?: WatchlistSyncStatus | string | null;
  last_sync_message?: string | null;
}

export interface VesselWatchlist extends WatchlistSyncFields {
  id: number;
  collection_id: number;
  site_id: string;
  vessel_name: string;
  voyage: string;
}

export interface ContainerInfo {
  id: number;
  collection_id?: number;
  site_id: string;
  containerno: string;
  event_time: string;
  event_type: string;
  in_yard?: string;
  fel: string;
  iso: string;
  gross: number;
  container_gross?: number;
  tare_wt?: number;
  manifest_wt?: number;
  gate_wt?: number;
  gate_gross_wt?: number;
  certified_weight?: number;
  vgm: string;
  category: string;
  cust: string;
  location: string;
  stack?: string;
  temp?: string;
  haz?: string;
  load_to_vessel?: string;
  pod_destination?: string;
  truck_vessel: string;
  trans_in: string;
  trans_out: string;
  cont_in_ts?: string;
  cont_out_ts?: string;
  line_oper: string;
  im_exp: string;
  bill_book: string;
  cust_approval_date: string;
  note: string;
  item_seal_no: string;
  custom_clearance_status: string;
  infras_fee_status: string;
  /** Computed by backend: "Đã thông quan" | "Đang giám sát HQ" | "Chưa thông quan" | "" */
  customs_status?: string;
  /** Computed by backend: IMDG link extracted from raw `haz` HTML, else "" */
  imdg_url?: string;
  item_key?: number;
  queried_at: string;
  [key: string]: any;
}

export interface ContainerWatchlist extends WatchlistSyncFields {
  id: number;
  collection_id: number;
  site_id: string;
  container_no: string;
  event_type?: string;
}

export interface ColumnSetting {
  key: string;
  visible: boolean;
  order: number;
  customName?: string;
}

export type TabId = 'dashboard' | 'booking' | 'vessel' | 'container';
export type MatchType = 'exact' | 'contains' | 'starts_with' | 'ends_with' | 'any';
export type TargetTable = 'all' | 'booking' | 'container' | 'vessel';

export interface ColorPreset {
  id: string;
  name: string;
  nameVi: string;
  bgClass: string;
  darkBgClass: string;
  borderClass: string;
  darkBorderClass: string;
  textClass: string;
  darkTextClass: string;
  hexPreview: string;
  badgeClass: string;
}

export interface ColorRule {
  id?: number;
  target_table: TargetTable;
  column_key: string;
  match_value: string;
  match_type: MatchType;
  preset_id?: string;
  custom_bg?: string;
  custom_border?: string;
  custom_text?: string;
  is_enabled: boolean;
  created_at?: string;
}

export interface DashboardKPIs {
  total_bookings: number;
  total_estimated_teus: number;
  customs_uncleared: number;
  customs_cleared: number;
  infras_unpaid: number;
  infras_paid: number;
  containers_in_yard: number;
  containers_out_yard: number;
  total_vessels: number;
  watchlist_vessels: number;
  total_containers: number;
  watchlist_containers: number;
}

export interface DistributionItem {
  name: string;
  count: number;
  percentage: number;
}

export interface CriticalCutoffAlert {
  id: number;
  booking_no?: string;
  carrier?: string;
  cutoff_time?: string;
  vessel?: string;
  port_of_discharging?: string;
}

export interface UnclearedContainerAlert {
  id: number;
  site_id?: string;
  containerno: string;
  event_time?: string;
  event_type?: string;
  in_yard?: string;
  custom_clearance_status?: string;
  cust?: string;
  customs_status?: string;
  infras_fee_status?: string;
  fel?: string;
  iso?: string;
  location?: string;
}

export interface UpcomingVesselAlert {
  id: number;
  site_id?: string;
  vessel_name: string;
  in_out_voyage?: string;
  actual_berth_time?: string;
  actual_departure_time?: string;
  closing_time?: string;
}

export interface DashboardAlerts {
  critical_cutoffs: CriticalCutoffAlert[];
  uncleared_containers: UnclearedContainerAlert[];
  upcoming_vessels: UpcomingVesselAlert[];
}

export interface DashboardDistributions {
  carriers: DistributionItem[];
  sites: DistributionItem[];
  equipment_types: DistributionItem[];
  container_events: DistributionItem[];
}

export interface DashboardSummary {
  updated_at: string;
  scope: {
    collection_id?: number | null;
    collection_name: string;
  };
  kpis: DashboardKPIs;
  alerts: DashboardAlerts;
  distributions: DashboardDistributions;
}

export interface AISettings {
  has_key: boolean;
  masked_key: string;
  raw_key?: string;
  gemini_model: string;
  ocr_engine: string;
}

export type ImageExtractEngine = 'gemini' | 'ocr' | 'none';

export interface ImageExtractResult {
  data: Partial<Booking>;
  engine_used: ImageExtractEngine;
  warnings: string[];
}

export interface ExtractImageResponse extends Partial<ImageExtractResult> {
  status: string;
  data: Partial<Booking>;
}

// ---------------------------------------------------------------------------
// Auto sync (scheduler)
// ---------------------------------------------------------------------------
export type AutoSyncMode = 'interval' | 'times';

export interface AutoSyncRunResult {
  vessels_ok: number;
  vessels_not_found: number;
  containers_ok: number;
  errors: number;
}

export interface AutoSyncStatus {
  enabled: boolean;
  mode: AutoSyncMode;
  interval_minutes: number;
  /** "HH:MM" list, Asia/Ho_Chi_Minh */
  times: string[];
  running: boolean;
  last_run_at: string | null;
  last_run_result: AutoSyncRunResult | null;
  next_run_at: string | null;
}

export interface AutoSyncSchedule {
  mode: AutoSyncMode;
  interval_minutes: number;
  times: string[];
}

// ---------------------------------------------------------------------------
// Bulk / batch API shapes
// ---------------------------------------------------------------------------
export type BulkEntity = 'bookings' | 'vessels' | 'containers';

export interface VesselWatchlistBatchItem {
  site_id: string;
  vessel_name: string;
  voyage: string;
}

export interface ContainerWatchlistBatchItem {
  site_id: string;
  container_no: string;
  event_type: string;
}

export interface ResyncResult {
  status: string;
  updated: number;
  not_found: string[];
  errors: string[];
}

export type RunSyncNowStatus = 'started' | 'already_running';

// ---------------------------------------------------------------------------
// Electron preload bridge
// ---------------------------------------------------------------------------
export interface ElectronAPI {
  platform?: string;
  version?: string;
  openExternal?: (url: string) => Promise<void>;
  /** PNG data URL or null */
  readClipboardImage?: () => Promise<string | null>;
  /** Tells main process whether to hide-to-tray on close */
  setAutoSyncActive?: (active: boolean) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}


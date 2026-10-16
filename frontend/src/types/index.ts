export interface Collection {
  id: number;
  name: string;
  created_at: string;
  settings?: string | null;
  booking_count?: number;
  vessel_count?: number;
  container_count?: number;
  watchlist_count?: number;
}

/** Booking workflow status, in workflow order (stored as these codes; labels come from translations) */
export const BOOKING_STATUSES = ['new', 'dispatched', 'stuffed', 'gated_in', 'done', 'cancelled'] as const;
export type BookingStatus = typeof BOOKING_STATUSES[number];

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
  /** Cắt máng from ePort for this booking's vessel + voyage (derived; "" when unknown) */
  "Cut-off ePort"?: string;
  "Cut-off ePort cập nhật"?: string;
  "Vessel"?: string;
  "ETD"?: string;
  "Ghi chú"?: string;
  "Pre Carrier"?: string;
  "ETD_Pre"?: string;
  "Trunk Vessel"?: string;
  "ETD_Trunk"?: string;
  "Trạng thái"?: BookingStatus;
  /** Open booking whose cut-off (ePort's when known) has passed (computed by the server) */
  "Trễ cut-off"?: boolean;
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
  /** Computed by backend: "Đã thông quan" | "Chưa thông quan" | "" */
  customs_status?: string;
  /** Computed by backend: IMDG link extracted from raw `haz` HTML, else "" */
  imdg_url?: string;
  item_key?: number;
  queried_at: string;
  [key: string]: any;
}

/** A booking's ePort vessel schedules and containers (GET /bookings/{id}/links). */
export interface BookingLinks {
  /** Schedules naming the booking's vessel + voyage, one per port site */
  vessels: (VesselSchedule & { closing_estimated: boolean })[];
  /** One row per container with this booking number, its latest event */
  containers: (ContainerInfo & { gated_in: boolean })[];
  /** Containers gated in for export, out of the booking's Q'ty (null when Q'ty has no number) */
  gated_in: number;
  qty: number | null;
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
  /** Parsed cut-off, VN wall-clock "YYYY-MM-DDTHH:mm" (newer backends only) */
  alert_at?: string;
  /** "eport" when cutoff_time is ePort's closing time rather than the booking's own */
  cutoff_source?: 'eport' | 'booking';
  /** The booking's own cut-off, when ePort's differs */
  original_cutoff?: string | null;
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
  /** Parsed berth time, VN wall-clock "YYYY-MM-DDTHH:mm" (newer backends only) */
  alert_at?: string;
}

export interface DashboardAlerts {
  critical_cutoffs: CriticalCutoffAlert[];
  uncleared_containers: UnclearedContainerAlert[];
  upcoming_vessels: UpcomingVesselAlert[];
  /** Full counts (lists are capped at 10); missing on older backends */
  totals?: { critical_cutoffs: number; uncleared_containers: number; upcoming_vessels: number };
  window_days?: number;
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

/** 'pdf' = read from a PDF's text layer (no AI / OCR) */
export type ImageExtractEngine = 'gemini' | 'ocr' | 'pdf' | 'none';

export interface ImageExtractResult {
  data: Partial<Booking>;
  engine_used: ImageExtractEngine;
  warnings: string[];
  /** Gemini model that produced the result (null when read by OCR) */
  model_used?: string | null;
  /** Why Gemini did not produce the result: no_key | quota | invalid_key | network | model_not_found | bad_response | unknown */
  gemini_error_kind?: string | null;
}

/** What the container photo reader returns (kg values; null when not printed / not readable) */
export interface ContainerImageData {
  container_no: string;
  tare_kg: number | null;
  max_gross_kg: number | null;
  /** ISO 6346 check digit matches; null when the number is not in the 4 letters + 7 digits shape */
  check_digit_ok: boolean | null;
  /** Number printed on a seal in the photo (empty when none) */
  seal_no: string;
  seal_brand: string;
}

export interface ContainerImageResult {
  data: ContainerImageData;
  engine_used: ImageExtractEngine;
  warnings: string[];
  model_used?: string | null;
  gemini_error_kind?: string | null;
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
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported';

export interface UpdateStatus {
  state: UpdateState;
  /** Version of the update being downloaded / ready to install. */
  version?: string | null;
  /** Download progress 0-100 while state === 'downloading'. */
  percent?: number;
  error?: string | null;
  currentVersion?: string;
  releasesUrl?: string;
}

export interface ElectronAPI {
  platform?: string;
  version?: string;
  openExternal?: (url: string) => Promise<void>;
  /** PNG data URL or null */
  readClipboardImage?: () => Promise<string | null>;
  /** Tells main process whether to hide-to-tray on close */
  setAutoSyncActive?: (active: boolean) => void;
  /** Open the folder containing app.log / errors.log. */
  openLogFolder?: () => void;
  /** Subscribe to auto-update events. Returns an unsubscribe fn. */
  onUpdateStatus?: (cb: (status: UpdateStatus) => void) => () => void;
  getUpdateStatus?: () => Promise<UpdateStatus>;
  checkForUpdates?: () => Promise<UpdateStatus>;
  /** Desktop only: fires when the main process changed notification state (popup shown / clicked). Returns unsubscribe. */
  onNotificationsChanged?: (callback: () => void) => () => void;
  /** Desktop only: claim pending notifications now and pop them up even while the app is focused. */
  pollNotificationsNow?: () => Promise<void>;
  /** Desktop only: a system popup was clicked — open that notification's detail (or the matching tab). Returns unsubscribe. */
  onNotificationNavigate?: (callback: (target: { tab: 'vessel' | 'container' | null; query: string | null; notificationId?: number | null }) => void) => () => void;
  /** Quit and install a downloaded update; false when nothing is ready. */
  installUpdate?: () => Promise<boolean>;
  /** CPU/RAM of all Electron processes (dashboard resource monitor). */
  getAppMetrics?: () => Promise<AppMetrics>;
  /** Clear the UI session caches → working-set bytes before/after. */
  clearRendererCache?: () => Promise<{ before: number; after: number }>;
  /** Restart the backend owned by Electron. */
  restartBackend?: () => Promise<{ ok: boolean; reason?: 'not_owned' | 'busy' | 'failed' }>;
}

export interface AppMetricsProcess {
  type: string;
  pid: number;
  /** % of the whole machine (0-100) */
  cpuPercent: number;
  workingSetBytes: number;
}

export interface AppMetrics {
  processes: AppMetricsProcess[];
  totalCpuPercent: number;
  totalWorkingSetBytes: number;
  cpuCount: number;
}

export interface SystemResources {
  sampled_at: string;
  system: { cpu_percent: number; cpu_count: number; ram_total: number; ram_used: number; ram_percent: number };
  backend: { pid: number; rss: number; cpu_percent: number; child_count: number };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export interface PageResult<T> {
  items: T[];
  total: number;
}

export interface ContainerPageResult extends PageResult<ContainerInfo> {
  event_type_counts: Record<string, number>;
}

export interface TableQuery {
  search_query?: string;
  search_field?: string;
  event_type?: string;
  sort_by?: string;
  sort_dir?: 'asc' | 'desc';
  /** Filter column values to keep ('' = blank): booking carrier, container line operator */
  carriers?: string[];
  /** Booking statuses to keep */
  statuses?: string[];
  /** Leave out done / cancelled bookings */
  hide_closed?: boolean;
}

// ---------------------------------------------------------------------------
// Mobile phone session (QR pairing)
// ---------------------------------------------------------------------------
export interface MobileDeviceInfo {
  id: string;
  label: string;
  last_seen: number;
}

export interface MobilePendingPhoto {
  id: string;
  filename: string;
  size: number;
  received_at: number;
}

export interface MobileSession {
  active: boolean;
  session_id?: string;
  pair_url?: string;
  ips?: string[];
  selected_ip?: string;
  port?: number;
  pairing_expires_at?: number;
  devices: MobileDeviceInfo[];
  pending: MobilePendingPhoto[];
}




// ---------------------------------------------------------------------------
// Change notifications (vessel schedule / container events)
// ---------------------------------------------------------------------------
export type NotificationKind =
  | 'container_customs' | 'container_ingate' | 'container_outgate'
  | 'vessel_closing' | 'vessel_closing_icd' | 'vessel_open_gate' | 'vessel_eta' | 'vessel_etd'
  /** every time of one vessel/voyage that changed in a lookup, listed in detail.changes */
  | 'vessel_schedule'
  /** a booking's cut-off is 24h / 6h / 2h away (detail.hours, detail.bookings) */
  | 'booking_cutoff'
  /** the daily summary of today's cut-offs (detail.today / late / tomorrow / items) */
  | 'morning_brief'
  /** the sample sent by the "send a test" button */
  | 'test';

/** One booking due today, as listed in a morning brief */
export interface BriefItem {
  booking_no: string;
  time: string;
  vessel: string;
  collection: string;
}

/** One changed time inside a 'vessel_schedule' notification (old/new as dd/mm/yyyy HH:MM) */
export interface VesselTimeChange {
  kind: NotificationKind;
  label: string;
  old: string;
  new: string;
}

export interface AppNotification {
  id: number;
  collection_id: number | null;
  kind: NotificationKind;
  /** Vietnamese fallback text; the UI builds a localized one from kind + detail */
  title: string;
  old_value: string;
  new_value: string;
  detail: {
    site_id?: string; vessel?: string; voyage?: string; container?: string; event_type?: string; bookings?: string[];
    changes?: VesselTimeChange[];
    // booking_cutoff
    hours?: number; cutoff?: string; booking_no?: string; vessel_name?: string; count?: number;
    // morning_brief
    date?: string; today?: number; late?: number; tomorrow?: number; vessels_today?: number; items?: BriefItem[];
    collections?: { name: string; today: number; late: number; tomorrow: number }[];
  };
  nav_tab: 'vessel' | 'container' | 'booking' | null;
  nav_query: string | null;
  source: 'auto_sync' | 'manual';
  created_at: string;
  read: boolean;
}

// ---------------------------------------------------------------------------
// Excel export templates
// ---------------------------------------------------------------------------
export type ExportTab = 'booking' | 'vessel' | 'container';
export type ExportFill = 'header' | 'column';
export type PaletteColor = 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink' | 'gray';
/** A palette colour, or a custom one as '#RRGGBB' */
export type ExportColor = PaletteColor | `#${string}`;

/** One exported column: its key in the row, the header written (blank = the table's label), colour and fill */
export interface ExportColumn {
  key: string;
  header: string;
  color: ExportColor | null;
  fill: ExportFill;
}

export interface ExportTemplate {
  id: number;
  tab: ExportTab;
  name: string;
  /** File name pattern; {date} and {collection} are filled in */
  filename: string;
  columns: ExportColumn[];
  created_at: string;
  updated_at: string;
}

export interface NotificationSettings {
  kinds: NotificationKind[];
  os_enabled: boolean;
  all_kinds: NotificationKind[];
  /** 'HH:MM' of the morning brief */
  brief_time: string;
}

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

export interface VesselWatchlist {
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
  item_key?: number;
  queried_at: string;
  [key: string]: any;
}

export interface ContainerWatchlist {
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

export type MatchType = 'exact' | 'contains';
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

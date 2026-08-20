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
  fel: string;
  iso: string;
  gross: number;
  vgm: string;
  category: string;
  cust: string;
  location: string;
  truck_vessel: string;
  trans_in: string;
  trans_out: string;
  gate_wt: number;
  line_oper: string;
  im_exp: string;
  bill_book: string;
  cust_approval_date: string;
  note: string;
  item_seal_no: string;
  custom_clearance_status: string;
  infras_fee_status: string;
  queried_at: string;
  [key: string]: any;
}

export interface ContainerWatchlist {
  id: number;
  collection_id: number;
  site_id: string;
  container_no: string;
}

export interface ColumnSetting {
  key: string;
  visible: boolean;
  order: number;
  customName?: string;
}

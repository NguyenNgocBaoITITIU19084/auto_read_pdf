import axios from 'axios';
import {
  Collection, Booking, VesselSchedule, VesselWatchlist, ContainerInfo, ContainerWatchlist, ColorRule,
  AutoSyncStatus, AutoSyncMode, ImageExtractResult, BulkEntity,
  VesselWatchlistBatchItem, ContainerWatchlistBatchItem, ResyncResult, RunSyncNowStatus,
  PageResult, ContainerPageResult, TableQuery,
} from '../types';

const API_BASE = 'http://127.0.0.1:8000/api/v1';

/** Timeout for long-running calls (ePort resync, PDF upload, image extraction). */
export const LONG_TIMEOUT = 180000;

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const FALLBACK_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
});

import { reportClientLog, setClientLogTransport, ClientLogPayload } from './clientLogger';

export interface LogEntry { time: string; level: string; logger: string; request_id: string; message: string }

export const sendClientLogApi = async (payload: ClientLogPayload): Promise<void> => {
  await apiClient.post('/logs/client', payload, { timeout: 10000 });
};
setClientLogTransport(sendClientLogApi);

apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    const cfg = error?.config || {};
    const target = `${String(cfg.method || 'get').toUpperCase()} ${cfg.url || ''}`;
    if (!String(cfg.url || '').includes('/logs/client')) {
      if (!error?.response) {
        reportClientLog('warning', `Network error: ${target}`, { context: { code: error?.code } });
      } else if (error.response.status >= 500) {
        reportClientLog('error', `HTTP ${error.response.status}: ${target}`, {
          context: { request_id: error.response.headers?.['x-request-id'], detail: error.response.data?.detail },
        });
      }
    }
    return Promise.reject(error);
  }
);

export const getLogsApi = async (params: { source?: 'app' | 'errors'; level?: string; q?: string; limit?: number }) =>
  (await apiClient.get<{ entries: LogEntry[]; log_dir: string }>('/logs', { params })).data;

export const downloadLogsZipApi = async (): Promise<{ blob: Blob; filename: string }> => {
  const res = await apiClient.get('/logs/export', { responseType: 'blob', timeout: LONG_TIMEOUT });
  const match = /filename="?([^"]+)"?/.exec(res.headers['content-disposition'] || '');
  return { blob: res.data, filename: match?.[1] || 'auto-read-pdf-logs.zip' };
};

const tableParams = (collectionId: number, q: TableQuery, extra: Record<string, number> = {}) => {
  const params: Record<string, string | number> = { collection_id: collectionId, ...extra };
  if (q.search_query) params.search_query = q.search_query;
  if (q.search_field && q.search_field !== 'all') params.search_field = q.search_field;
  if (q.event_type && q.event_type !== 'ALL') params.event_type = q.event_type;
  return params;
};

// Collections
export const getCollections = async (): Promise<Collection[]> => {
  const res = await apiClient.get<Collection[]>('/collections');
  return res.data;
};

export const createCollection = async (name: string): Promise<{ id: number; name: string }> => {
  const res = await apiClient.post('/collections', { name });
  return res.data;
};

export const deleteCollection = async (id: number): Promise<void> => {
  await apiClient.delete(`/collections/${id}`);
};

export const updateCollectionSettings = async (id: number, settings: string): Promise<void> => {
  await apiClient.put(`/collections/${id}/settings`, { settings });
};

// Bookings
export const getBookings = async (collectionId: number, query?: string, field?: string): Promise<Booking[]> => {
  const params: any = { collection_id: collectionId };
  if (query) params.search_query = query;
  if (field && field !== 'all') params.search_field = field;
  const res = await apiClient.get<Booking[]>('/bookings', { params });
  return res.data;
};

export const getBookingsPage = async (collectionId: number, limit: number, offset: number, q: TableQuery): Promise<PageResult<Booking>> =>
  (await apiClient.get<PageResult<Booking>>('/bookings/page', { params: tableParams(collectionId, q, { limit, offset }) })).data;
export const getBookingIds = async (collectionId: number, q: TableQuery): Promise<number[]> =>
  (await apiClient.get<{ ids: number[] }>('/bookings/ids', { params: tableParams(collectionId, q) })).data.ids;
export const getBookingsByIds = async (ids: number[]): Promise<Booking[]> =>
  (await apiClient.post<Booking[]>('/bookings/by-ids', { ids }, { timeout: LONG_TIMEOUT })).data;

export const uploadPDFs = async (collectionId: number, files: File[]): Promise<{ count: number; items: Booking[] }> => {
  const formData = new FormData();
  formData.append('collection_id', collectionId.toString());
  files.forEach((file) => {
    formData.append('files', file);
  });
  const res = await apiClient.post('/bookings/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: LONG_TIMEOUT,
  });
  return res.data;
};

export const uploadFiles = uploadPDFs;

/**
 * Extract booking fields from an image. Returns the full result
 * `{data, engine_used, warnings}` so callers can surface engine failures.
 */
export const extractBookingImageDetailedApi = async (file: File, apiKey?: string): Promise<ImageExtractResult> => {
  const formData = new FormData();
  formData.append('file', file);
  if (apiKey) {
    formData.append('api_key', apiKey);
  }
  const res = await apiClient.post<{
    status: string;
    data: Partial<Booking>;
    engine_used?: ImageExtractResult['engine_used'];
    warnings?: string[];
  }>('/bookings/extract-image', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: LONG_TIMEOUT,
  });
  return {
    data: res.data?.data || {},
    engine_used: res.data?.engine_used || 'none',
    warnings: Array.isArray(res.data?.warnings) ? res.data.warnings : [],
  };
};

/** Backward-compatible: returns only `.data`. Prefer `extractBookingImageDetailedApi`. */
export const extractBookingImageApi = async (file: File, apiKey?: string): Promise<Partial<Booking>> => {
  const result = await extractBookingImageDetailedApi(file, apiKey);
  return result.data;
};

export const saveManualBookingApi = async (collectionId: number, booking: Partial<Booking>): Promise<{ item: Booking; warnings: string[] }> => {
  const res = await apiClient.post<{ status: string; id: number; item: Booking; warnings?: string[] }>('/bookings/manual-save', {
    collection_id: collectionId,
    booking,
  });
  return { item: res.data.item, warnings: res.data.warnings || [] };
};

export const updateBookingApi = async (id: number, booking: Partial<Booking>): Promise<{ item: Booking; warnings: string[] }> => {
  const res = await apiClient.put<{ status: string; item: Booking; warnings?: string[] }>(`/bookings/${id}`, { booking });
  return { item: res.data.item, warnings: res.data.warnings || [] };
};

export const deleteBooking = async (id: number): Promise<void> => {
  await apiClient.delete(`/bookings/${id}`);
};

export const clearBookings = async (collectionId: number): Promise<void> => {
  await apiClient.delete(`/bookings/clear/${collectionId}`);
};

export const deleteBookingsBatch = async (ids: number[]): Promise<{ status: string; deleted: number }> => {
  const res = await apiClient.post('/bookings/batch-delete', { ids });
  return res.data;
};

// Vessels
export const getVessels = async (collectionId: number, query?: string, field?: string): Promise<VesselSchedule[]> => {
  const params: any = { collection_id: collectionId };
  if (query) params.search_query = query;
  if (field && field !== 'all') params.search_field = field;
  const res = await apiClient.get<VesselSchedule[]>('/vessels', { params });
  return res.data;
};

export const getVesselsPage = async (collectionId: number, limit: number, offset: number, q: TableQuery): Promise<PageResult<VesselSchedule>> =>
  (await apiClient.get<PageResult<VesselSchedule>>('/vessels/page', { params: tableParams(collectionId, q, { limit, offset }) })).data;
export const getVesselIds = async (collectionId: number, q: TableQuery): Promise<number[]> =>
  (await apiClient.get<{ ids: number[] }>('/vessels/ids', { params: tableParams(collectionId, q) })).data.ids;
export const getVesselsByIds = async (ids: number[]): Promise<VesselSchedule[]> =>
  (await apiClient.post<VesselSchedule[]>('/vessels/by-ids', { ids }, { timeout: LONG_TIMEOUT })).data;

export const searchVesselsApi = async (
  collectionId: number, siteId: string, vesselName: string, voyage?: string, options: { save?: boolean } = {}
): Promise<any> => {
  const res = await apiClient.post('/vessels/search', {
    collection_id: collectionId,
    site_id: siteId,
    vessel_name: vesselName,
    voyage: voyage || null,
    save: options.save ?? true,
  });
  return res.data;
};

export const saveVesselResultsApi = async (collectionId: number, items: Record<string, any>[]) =>
  (await apiClient.post<{ status: string; saved: number }>('/vessels/save', { collection_id: collectionId, items })).data;


export const deleteVessel = async (id: number): Promise<void> => {
  await apiClient.delete(`/vessels/${id}`);
};

export const deleteVesselsBatch = async (ids: number[]): Promise<void> => {
  await apiClient.post('/vessels/batch-delete', { ids });
};

export const clearVessels = async (collectionId: number): Promise<void> => {
  await apiClient.delete(`/vessels/clear/${collectionId}`);
};

export const getVesselWatchlist = async (collectionId: number): Promise<VesselWatchlist[]> => {
  const res = await apiClient.get<VesselWatchlist[]>('/vessels/watchlist', { params: { collection_id: collectionId } });
  return res.data;
};

export const addVesselWatchlist = async (collectionId: number, siteId: string, vesselName: string, voyage: string): Promise<void> => {
  await apiClient.post('/vessels/watchlist', {
    collection_id: collectionId,
    site_id: siteId,
    vessel_name: vesselName,
    voyage,
  });
};

export const deleteVesselWatchlist = async (watchlistId: number): Promise<void> => {
  await apiClient.delete(`/vessels/watchlist/${watchlistId}`);
};

export const syncVesselWatchlist = async (collectionId: number): Promise<any> => {
  const res = await apiClient.post(`/vessels/watchlist/sync?collection_id=${collectionId}`, undefined, {
    timeout: LONG_TIMEOUT,
  });
  return res.data;
};

export const addVesselWatchlistBatch = async (
  collectionId: number,
  items: VesselWatchlistBatchItem[]
): Promise<{ status: string; added: number }> => {
  const res = await apiClient.post('/vessels/watchlist/batch-add', { collection_id: collectionId, items });
  return res.data;
};

export const removeVesselWatchlistBatch = async (ids: number[]): Promise<{ status: string; removed: number }> => {
  const res = await apiClient.post('/vessels/watchlist/batch-remove', { ids });
  return res.data;
};

/** Re-query ePort for the given vessel_schedules ids. */
export const resyncVesselsApi = async (ids: number[]): Promise<ResyncResult> => {
  const res = await apiClient.post<ResyncResult>('/vessels/resync', { ids }, { timeout: LONG_TIMEOUT });
  return res.data;
};

// Containers
export const getContainers = async (collectionId: number, query?: string, field?: string): Promise<ContainerInfo[]> => {
  const params: any = { collection_id: collectionId };
  if (query) params.search_query = query;
  if (field && field !== 'all') params.search_field = field;
  const res = await apiClient.get<ContainerInfo[]>('/containers', { params });
  return res.data;
};

export const getContainersPage = async (collectionId: number, limit: number, offset: number, q: TableQuery): Promise<ContainerPageResult> =>
  (await apiClient.get<ContainerPageResult>('/containers/page', { params: tableParams(collectionId, q, { limit, offset }) })).data;
export const getContainerIds = async (collectionId: number, q: TableQuery): Promise<number[]> =>
  (await apiClient.get<{ ids: number[] }>('/containers/ids', { params: tableParams(collectionId, q) })).data.ids;
export const getContainersByIds = async (ids: number[]): Promise<ContainerInfo[]> =>
  (await apiClient.post<ContainerInfo[]>('/containers/by-ids', { ids }, { timeout: LONG_TIMEOUT })).data;

export const searchContainersApi = async (
  collectionId: number,
  siteId: string,
  containerNos: string,
  isSearchByInYard: boolean = false,
  isSearchByBatch: boolean = false
): Promise<any> => {
  const res = await apiClient.post('/containers/search', {
    collection_id: collectionId,
    site_id: siteId,
    container_nos: containerNos,
    is_search_by_in_yard: isSearchByInYard,
    is_search_by_batch: isSearchByBatch,
  });
  return res.data;
};

export const deleteContainer = async (id: number): Promise<void> => {
  await apiClient.delete(`/containers/${id}`);
};

export const deleteContainersBatch = async (ids: number[]): Promise<void> => {
  await apiClient.post('/containers/batch-delete', { ids });
};

export const clearContainers = async (collectionId: number): Promise<void> => {
  await apiClient.delete(`/containers/clear/${collectionId}`);
};

export const getContainerWatchlist = async (collectionId: number): Promise<ContainerWatchlist[]> => {
  const res = await apiClient.get<ContainerWatchlist[]>('/containers/watchlist', { params: { collection_id: collectionId } });
  return res.data;
};

export const addContainerWatchlist = async (collectionId: number, siteId: string, containerNo: string, eventType?: string): Promise<void> => {
  await apiClient.post('/containers/watchlist', {
    collection_id: collectionId,
    site_id: siteId,
    container_no: containerNo,
    event_type: eventType || '',
  });
};

export const deleteContainerWatchlist = async (watchlistId: number): Promise<void> => {
  await apiClient.delete(`/containers/watchlist/${watchlistId}`);
};

export const syncContainerWatchlist = async (collectionId: number): Promise<any> => {
  const res = await apiClient.post(`/containers/watchlist/sync?collection_id=${collectionId}`, undefined, {
    timeout: LONG_TIMEOUT,
  });
  return res.data;
};

export const addContainerWatchlistBatch = async (
  collectionId: number,
  items: ContainerWatchlistBatchItem[]
): Promise<{ status: string; added: number }> => {
  const res = await apiClient.post('/containers/watchlist/batch-add', { collection_id: collectionId, items });
  return res.data;
};

export const removeContainerWatchlistBatch = async (ids: number[]): Promise<{ status: string; removed: number }> => {
  const res = await apiClient.post('/containers/watchlist/batch-remove', { ids });
  return res.data;
};

/** Re-query ePort for the given containers ids. */
export const resyncContainersApi = async (ids: number[], options: { allEvents?: boolean } = {}): Promise<ResyncResult> => {
  const res = await apiClient.post<ResyncResult>('/containers/resync', { ids, all_events: !!options.allEvents }, { timeout: LONG_TIMEOUT });
  return res.data;
};

// Collections — move / copy items between collections
export const moveItemsToCollection = async (
  entity: BulkEntity,
  ids: number[],
  targetCollectionId: number,
  copy: boolean = false
): Promise<{ status: string; moved: number }> => {
  const res = await apiClient.post('/collections/move', {
    entity,
    ids,
    target_collection_id: targetCollectionId,
    copy,
  });
  return res.data;
};

// Export & Backup
export const exportExcelApi = async (data: any[], selectedColumns: string[]): Promise<Blob> => {
  const res = await apiClient.post('/export/excel', {
    data,
    selected_columns: selectedColumns,
  }, { responseType: 'blob' });
  return res.data;
};

export const getBackupDb = async (): Promise<any> => {
  const res = await apiClient.get('/backup');
  return res.data;
};

export type RestoreMode = 'merge' | 'replace';

export const restoreBackupDb = async (backupData: unknown, mode: RestoreMode = 'merge') => {
  const res = await apiClient.post<{ status: string; message: string; mode: RestoreMode }>(
    '/restore', backupData, { params: { mode }, timeout: LONG_TIMEOUT });
  return res.data;
};

const DEFAULT_AUTO_SYNC_STATUS: AutoSyncStatus = {
  enabled: false,
  mode: 'interval',
  interval_minutes: 10,
  times: [],
  running: false,
  last_run_at: null,
  last_run_result: null,
  next_run_at: null,
};

/** Normalizes a (possibly older-backend) scheduler payload into a full AutoSyncStatus. */
export const normalizeAutoSyncStatus = (raw: any): AutoSyncStatus => {
  const r = raw && typeof raw === 'object' ? raw : {};
  const interval = Number(r.interval_minutes);
  return {
    enabled: !!r.enabled,
    mode: r.mode === 'times' ? 'times' : 'interval',
    interval_minutes: Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_AUTO_SYNC_STATUS.interval_minutes,
    times: Array.isArray(r.times) ? r.times.filter((x: unknown) => typeof x === 'string') : [],
    running: !!r.running,
    last_run_at: r.last_run_at ?? null,
    last_run_result: r.last_run_result ?? null,
    next_run_at: r.next_run_at ?? null,
  };
};

export const getAutoSyncStatus = async (): Promise<AutoSyncStatus> => {
  const res = await apiClient.get('/scheduler/status');
  return normalizeAutoSyncStatus(res.data);
};

export interface ToggleAutoSyncOptions {
  mode?: AutoSyncMode;
  times?: string[];
}

/** POST /scheduler/toggle — returns the full status after applying. */
export const toggleAutoSyncApi = async (
  enable: boolean,
  intervalMinutes: number = 10,
  options: ToggleAutoSyncOptions = {}
): Promise<AutoSyncStatus> => {
  const body: Record<string, unknown> = { enable, interval_minutes: intervalMinutes };
  if (options.mode) body.mode = options.mode;
  if (options.times) body.times = options.times;
  const res = await apiClient.post('/scheduler/toggle', body);
  return normalizeAutoSyncStatus(res.data);
};

export const runSyncNowApi = async (): Promise<{ status: RunSyncNowStatus }> => {
  const res = await apiClient.post('/scheduler/run-now');
  return res.data;
};

// Color Rules
export const getColorRulesApi = async (targetTable?: string): Promise<ColorRule[]> => {
  const params: any = {};
  if (targetTable && targetTable !== 'all') params.target_table = targetTable;
  const res = await apiClient.get<ColorRule[]>('/color-rules', { params });
  return res.data;
};

export const createColorRuleApi = async (rule: Partial<ColorRule>): Promise<ColorRule> => {
  const res = await apiClient.post<ColorRule>('/color-rules', rule);
  return res.data;
};

export const updateColorRuleApi = async (id: number, rule: Partial<ColorRule>): Promise<ColorRule> => {
  const res = await apiClient.put<ColorRule>(`/color-rules/${id}`, rule);
  return res.data;
};

export const deleteColorRuleApi = async (id: number): Promise<void> => {
  await apiClient.delete(`/color-rules/${id}`);
};

export const resetColorRulesApi = async (): Promise<ColorRule[]> => {
  const res = await apiClient.post<ColorRule[]>('/color-rules/reset');
  return res.data;
};

// Dashboard
export const getDashboardSummaryApi = async (collectionId?: number): Promise<import('../types').DashboardSummary> => {
  const params: any = {};
  if (collectionId !== undefined && collectionId !== null) {
    params.collection_id = collectionId;
  }
  const res = await apiClient.get<import('../types').DashboardSummary>('/dashboard/summary', { params });
  return res.data;
};

// AI & System Settings
export const getAISettingsApi = async (): Promise<import('../types').AISettings> => {
  const res = await apiClient.get<import('../types').AISettings>('/settings/ai');
  return res.data;
};

export const saveAISettingsApi = async (settings: {
  gemini_api_key?: string;
  gemini_model?: string;
  ocr_engine?: string;
}): Promise<{ status: string; message: string }> => {
  const res = await apiClient.post('/settings/ai', settings);
  return res.data;
};

export type AIKeyErrorType = 'invalid_key' | 'model_not_found' | 'quota' | 'network' | 'unknown';

export interface AIKeyTestResult {
  valid: boolean;
  message: string;
  /** Present on newer backends */
  error_type?: AIKeyErrorType | null;
}

export const testAIApiKeyApi = async (
  apiKey: string,
  model?: string
): Promise<AIKeyTestResult> => {
  const res = await apiClient.post('/settings/ai/test', {
    gemini_api_key: apiKey,
    gemini_model: model || DEFAULT_GEMINI_MODEL,
  });
  return res.data;
};

/** GET /settings/ai/models — falls back to a static list on any error. */
export const getAIModelsApi = async (apiKey?: string): Promise<string[]> => {
  try {
    const params: Record<string, string> = {};
    if (apiKey) params.api_key = apiKey;
    const res = await apiClient.get<{ models: string[] }>('/settings/ai/models', { params });
    const models = Array.isArray(res.data?.models) ? res.data.models.filter((m) => typeof m === 'string' && m) : [];
    return models.length > 0 ? models : [...FALLBACK_GEMINI_MODELS];
  } catch (e) {
    console.warn('Failed to load AI models, using fallback list:', e);
    return [...FALLBACK_GEMINI_MODELS];
  }
};


import axios from 'axios';
import { Collection, Booking, VesselSchedule, VesselWatchlist, ContainerInfo, ContainerWatchlist } from '../types';

const API_BASE = 'http://127.0.0.1:8000/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 60000,
});

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

export const uploadPDFs = async (collectionId: number, files: File[]): Promise<{ count: number; items: Booking[] }> => {
  const formData = new FormData();
  formData.append('collection_id', collectionId.toString());
  files.forEach((file) => {
    formData.append('files', file);
  });
  const res = await apiClient.post('/bookings/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const deleteBooking = async (id: number): Promise<void> => {
  await apiClient.delete(`/bookings/${id}`);
};

export const clearBookings = async (collectionId: number): Promise<void> => {
  await apiClient.delete(`/bookings/clear/${collectionId}`);
};

// Vessels
export const getVessels = async (collectionId: number, query?: string, field?: string): Promise<VesselSchedule[]> => {
  const params: any = { collection_id: collectionId };
  if (query) params.search_query = query;
  if (field && field !== 'all') params.search_field = field;
  const res = await apiClient.get<VesselSchedule[]>('/vessels', { params });
  return res.data;
};

export const searchVesselsApi = async (collectionId: number, siteId: string, vesselName: string, voyage?: string): Promise<any> => {
  const res = await apiClient.post('/vessels/search', {
    collection_id: collectionId,
    site_id: siteId,
    vessel_name: vesselName,
    voyage: voyage || null,
  });
  return res.data;
};

export const deleteVessel = async (id: number): Promise<void> => {
  await apiClient.delete(`/vessels/${id}`);
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
  const res = await apiClient.post(`/vessels/watchlist/sync?collection_id=${collectionId}`);
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

export const searchContainersApi = async (collectionId: number, siteId: string, containerNos: string): Promise<any> => {
  const res = await apiClient.post('/containers/search', {
    collection_id: collectionId,
    site_id: siteId,
    container_nos: containerNos,
  });
  return res.data;
};

export const deleteContainer = async (id: number): Promise<void> => {
  await apiClient.delete(`/containers/${id}`);
};

export const clearContainers = async (collectionId: number): Promise<void> => {
  await apiClient.delete(`/containers/clear/${collectionId}`);
};

export const getContainerWatchlist = async (collectionId: number): Promise<ContainerWatchlist[]> => {
  const res = await apiClient.get<ContainerWatchlist[]>('/containers/watchlist', { params: { collection_id: collectionId } });
  return res.data;
};

export const addContainerWatchlist = async (collectionId: number, siteId: string, containerNo: string): Promise<void> => {
  await apiClient.post('/containers/watchlist', {
    collection_id: collectionId,
    site_id: siteId,
    container_no: containerNo,
  });
};

export const deleteContainerWatchlist = async (watchlistId: number): Promise<void> => {
  await apiClient.delete(`/containers/watchlist/${watchlistId}`);
};

export const syncContainerWatchlist = async (collectionId: number): Promise<any> => {
  const res = await apiClient.post(`/containers/watchlist/sync?collection_id=${collectionId}`);
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

export const restoreBackupDb = async (backupData: any): Promise<any> => {
  const res = await apiClient.post('/restore', backupData);
  return res.data;
};

export const getAutoSyncStatus = async (): Promise<{ enabled: boolean; interval_minutes: number }> => {
  const res = await apiClient.get('/scheduler/status');
  return res.data;
};

export const toggleAutoSyncApi = async (enable: boolean, intervalMinutes: number = 10): Promise<any> => {
  const res = await apiClient.post('/scheduler/toggle', { enable, interval_minutes: intervalMinutes });
  return res.data;
};

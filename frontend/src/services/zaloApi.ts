import { apiClient } from './api';
import type { ZaloBookingScan, ZaloConversation, ZaloMessage, ZaloTemplate, ZaloUnlinkedDriver } from '../types';

export type ZaloFilter = 'all' | 'drivers' | 'unread' | 'pending' | 'watching' | 'hidden';

export interface ZaloConversationsResponse {
  items: ZaloConversation[];
  counts: {
    all: number;
    drivers: number;
    unread: number;
    pending: number;
    unread_messages: number;
    hidden?: number;
    watching?: number;
  };
}

export const getZaloSession = async () => {
  const res = await apiClient.get('/zalo/session');
  return res.data;
};

export const getZaloConversations = async (filter: ZaloFilter = 'all', q = ''): Promise<ZaloConversationsResponse> => {
  const res = await apiClient.get<ZaloConversationsResponse>('/zalo/conversations', { params: { filter, q } });
  return res.data;
};

export const getZaloConversation = async (threadId: string): Promise<ZaloConversation> => {
  const res = await apiClient.get<ZaloConversation>(`/zalo/conversations/${encodeURIComponent(threadId)}`);
  return res.data;
};

export const markZaloConversationRead = async (threadId: string): Promise<ZaloConversation> => {
  const res = await apiClient.post<ZaloConversation>(`/zalo/conversations/${encodeURIComponent(threadId)}/read`);
  return res.data;
};

export const patchZaloConversation = async (
  threadId: string,
  payload: {
    needs_attention?: boolean;
    driver_id?: number | null;
    unlink_driver?: boolean;
    display_name?: string;
    phone?: string;
    hidden?: boolean;
  }
): Promise<ZaloConversation> => {
  const res = await apiClient.patch<ZaloConversation>(`/zalo/conversations/${encodeURIComponent(threadId)}`, payload);
  return res.data;
};

export const getZaloMessages = async (threadId: string, limit = 80, beforeId?: number): Promise<ZaloMessage[]> => {
  const res = await apiClient.get<ZaloMessage[]>(`/zalo/conversations/${encodeURIComponent(threadId)}/messages`, {
    params: { limit, ...(beforeId ? { before_id: beforeId } : {}) },
  });
  return res.data;
};

export const recordOutgoingZaloMessage = async (payload: {
  thread_id: string;
  thread_type?: 'user' | 'group';
  display_name?: string;
  phone?: string;
  content: string;
  booking_no?: string;
}) => {
  const res = await apiClient.post('/zalo/messages/outgoing', payload);
  return res.data;
};

export interface ZaloLinkCandidate {
  id: number;
  name: string;
  phone: string;
  status: string;
  vehicle_plate?: string | null;
  linked_thread_id?: string | null;
  linked_name?: string | null;
}

export const getZaloLinkCandidates = async (): Promise<ZaloLinkCandidate[]> => {
  const res = await apiClient.get<ZaloLinkCandidate[]>('/zalo/drivers/link-candidates');
  return res.data;
};

export const getZaloUnlinkedDrivers = async (): Promise<ZaloUnlinkedDriver[]> => {
  const res = await apiClient.get<ZaloUnlinkedDriver[]>('/zalo/drivers/unlinked');
  return res.data;
};

export const getZaloTemplates = async (): Promise<ZaloTemplate[]> => {
  const res = await apiClient.get<ZaloTemplate[]>('/zalo/templates');
  return res.data;
};

export const createZaloTemplate = async (payload: {
  name: string;
  shortcut?: string;
  category?: string;
  content: string;
}): Promise<ZaloTemplate> => {
  const res = await apiClient.post<ZaloTemplate>('/zalo/templates', payload);
  return res.data;
};

export const deleteZaloTemplate = async (id: number): Promise<void> => {
  await apiClient.delete(`/zalo/templates/${id}`);
};

export const getZaloMediaUrl = (url: string): string => {
  if (!url) return '';
  const clean = url.toLowerCase().split('?')[0];
  if (clean.endsWith('.jxl')) {
    const base = apiClient.defaults.baseURL || '';
    return `${base}/zalo/media?url=${encodeURIComponent(url)}`;
  }
  return url;
};

// ---- Watched chats and booking scans ----------------------------------------------------------
export type ZaloImageScanMode = 'manual' | 'caption' | 'auto';

export interface ZaloHistoryCounts {
  '7': { pdf: number; image: number };
  '30': { pdf: number; image: number };
  all: { pdf: number; image: number };
}

export const setZaloWatch = async (
  threadId: string,
  watch: boolean
): Promise<{ conversation: ZaloConversation; history: ZaloHistoryCounts | null }> => {
  const res = await apiClient.post(`/zalo/conversations/${encodeURIComponent(threadId)}/watch`, { watch });
  return res.data;
};

export const scanZaloHistory = async (threadId: string, days: number | null): Promise<{ queued: number }> => {
  const res = await apiClient.post(`/zalo/conversations/${encodeURIComponent(threadId)}/scan-history`, { days });
  return res.data;
};

export const scanZaloMessage = async (messageId: number): Promise<ZaloBookingScan> => {
  const res = await apiClient.post<ZaloBookingScan>(`/zalo/messages/${messageId}/scan`);
  return res.data;
};

export const getZaloBookingQueue = async (status = 'pending_review'): Promise<ZaloBookingScan[]> => {
  const res = await apiClient.get<ZaloBookingScan[]>('/zalo/booking-scans', { params: { status } });
  return res.data;
};

export const getZaloBookingSummary = async (): Promise<{ pending_review: number; in_progress: number; version: number }> => {
  const res = await apiClient.get('/zalo/booking-scans/summary');
  return res.data;
};

/** The booking file kept on this machine (Zalo's own link may have expired). */
export const getZaloBookingFile = async (scan: Pick<ZaloBookingScan, 'message_id' | 'file_name' | 'kind'>): Promise<File> => {
  const res = await apiClient.get(`/zalo/booking-scans/${scan.message_id}/file`, { responseType: 'blob' });
  const isPdf = scan.kind === 'pdf';
  const name = isPdf ? scan.file_name || 'booking.pdf' : (scan.file_name || 'zalo_booking').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([res.data], name, { type: isPdf ? 'application/pdf' : 'image/jpeg' });
};

export const getZaloBookingFileUrl = (messageId: number): string =>
  `${apiClient.defaults.baseURL || ''}/zalo/booking-scans/${messageId}/file`;

export const markZaloScanSaved = async (messageId: number, bookingId: number, collectionId?: number | null) => {
  const res = await apiClient.post(`/zalo/booking-scans/${messageId}/saved`, {
    booking_id: bookingId,
    collection_id: collectionId ?? null,
  });
  return res.data as ZaloBookingScan;
};

export const dismissZaloScan = async (messageId: number): Promise<ZaloBookingScan> => {
  const res = await apiClient.post<ZaloBookingScan>(`/zalo/booking-scans/${messageId}/dismiss`);
  return res.data;
};

export const getZaloBookingSettings = async (): Promise<{ collection_id: number | null; image_mode: ZaloImageScanMode }> => {
  const res = await apiClient.get('/zalo/booking-settings');
  return res.data;
};

export const saveZaloBookingSettings = async (payload: { collection_id: number | null; image_mode: ZaloImageScanMode }) => {
  const res = await apiClient.put('/zalo/booking-settings', payload);
  return res.data as { collection_id: number | null; image_mode: ZaloImageScanMode };
};

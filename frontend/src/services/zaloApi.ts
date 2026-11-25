import { apiClient } from './api';
import type { ZaloConversation, ZaloMessage, ZaloTemplate, ZaloUnlinkedDriver } from '../types';

export type ZaloFilter = 'all' | 'drivers' | 'unread' | 'pending';

export interface ZaloConversationsResponse {
  items: ZaloConversation[];
  counts: {
    all: number;
    drivers: number;
    unread: number;
    pending: number;
    unread_messages: number;
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

export const markZaloConversationRead =async (threadId: string): Promise<ZaloConversation> => {
  const res = await apiClient.post<ZaloConversation>(`/zalo/conversations/${encodeURIComponent(threadId)}/read`);
  return res.data;
};

export const patchZaloConversation = async (
  threadId: string,
  payload: { needs_attention?: boolean; driver_id?: number | null; unlink_driver?: boolean; display_name?: string; phone?: string }
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

import { apiClient, LONG_TIMEOUT } from './api';

export interface GmailAccount {
  id: number;
  email: string;
  display_name: string;
  avatar: string;
  history_id: string;
  status: 'connected' | 'disconnected' | 'error';
  last_error: string;
  last_sync_at: string;
  unread_count: number;
}

export interface GmailAttachment {
  id: number;
  attachment_id: string;
  filename: string;
  mime_type: string;
  size: number;
  is_pdf: number;
  imported_booking_no: string;
  /** Content-ID of an image the HTML body shows as <img src="cid:…"> */
  content_id?: string;
}

export interface GmailThread {
  account_id: number;
  thread_id: string;
  subject: string;
  snippet: string;
  participants: string;
  labels: string[];
  is_unread: number;
  is_starred: number;
  has_attachments: number;
  has_pdf: number;
  message_count: number;
  last_message_ms: number;
  last_message_at: string;
}

export interface GmailMessage {
  account_id: number;
  message_id: string;
  thread_id: string;
  from_addr: string;
  to_addrs: string;
  cc_addrs: string;
  subject: string;
  snippet: string;
  body_text: string;
  body_html: string;
  labels: string[];
  is_unread: number;
  is_starred: number;
  internal_date_ms: number;
  date_iso: string;
  rfc_message_id: string;
  references_header: string;
  attachments: GmailAttachment[];
}

export interface GmailThreadDetail extends GmailThread {
  messages: GmailMessage[];
}

export interface GmailTemplate {
  id: number;
  name: string;
  shortcut: string;
  category: string;
  subject_tpl: string;
  body_tpl: string;
}

export interface GmailConfig {
  has_oauth_config: boolean;
  using_embedded_oauth?: boolean;
  client_id: string;
  has_client_secret: boolean;
  redirect_uri: string;
  sync: {
    auto_sync_enabled: boolean;
    interval_minutes: number;
    auto_import_pdf: boolean;
    auto_import_collection_id: number | null;
    auto_import_query: string;
  };
}

export const clearGmailOAuthConfig = async (): Promise<void> => {
  await apiClient.delete('/gmail/config/oauth');
};

export const getGmailConfig = async (): Promise<GmailConfig> =>
  (await apiClient.get<GmailConfig>('/gmail/config')).data;

export const saveGmailOAuthConfig = async (client_id: string, client_secret: string): Promise<void> => {
  await apiClient.put('/gmail/config/oauth', { client_id, client_secret });
};

export const startGmailOAuth = async (): Promise<{ auth_url: string; state: string }> =>
  (await apiClient.post<{ auth_url: string; state: string }>('/gmail/oauth/start')).data;

export const getGmailAccounts = async (): Promise<{ items: GmailAccount[]; total_unread: number }> =>
  (await apiClient.get<{ items: GmailAccount[]; total_unread: number }>('/gmail/accounts')).data;

export const deleteGmailAccount = async (accountId: number): Promise<void> => {
  await apiClient.delete(`/gmail/accounts/${accountId}`);
};

export const syncGmailAccount = async (
  accountId: number,
  params?: { max_results?: number; q?: string }
): Promise<{ account_id: number; synced_threads: number; history_id: string }> =>
  (await apiClient.post(`/gmail/accounts/${accountId}/sync`, null, { params, timeout: LONG_TIMEOUT })).data;

export const getGmailUnreadCount = async (): Promise<number> => {
  const res = await apiClient.get<{ unread: number }>('/gmail/unread-count');
  return res.data.unread || 0;
};

export const getGmailThreads = async (params: {
  account_id: number;
  label?: string;
  search?: string;
  only_unread?: boolean;
  only_pdf?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: GmailThread[]; total: number }> =>
  (await apiClient.get<{ items: GmailThread[]; total: number }>('/gmail/threads', { params })).data;

export const getGmailThreadDetail = async (
  accountId: number,
  threadId: string,
  refresh = false
): Promise<GmailThreadDetail> =>
  (await apiClient.get<GmailThreadDetail>(`/gmail/threads/${accountId}/${threadId}`, { params: { refresh } })).data;

export const patchGmailThread = async (
  accountId: number,
  threadId: string,
  action: 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'untrash'
): Promise<{ ok: boolean; thread: GmailThreadDetail }> =>
  (await apiClient.patch(`/gmail/threads/${accountId}/${threadId}`, { action })).data;

export const sendGmailMessage = async (payload: {
  account_id: number;
  to_addrs: string;
  subject: string;
  body_text: string;
  cc_addrs?: string;
  bcc_addrs?: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
  files?: File[];
}): Promise<{ ok: boolean; id: string; thread_id: string }> => {
  const form = new FormData();
  form.append('account_id', String(payload.account_id));
  form.append('to_addrs', payload.to_addrs);
  form.append('subject', payload.subject);
  form.append('body_text', payload.body_text);
  if (payload.cc_addrs) form.append('cc_addrs', payload.cc_addrs);
  if (payload.bcc_addrs) form.append('bcc_addrs', payload.bcc_addrs);
  if (payload.thread_id) form.append('thread_id', payload.thread_id);
  if (payload.in_reply_to) form.append('in_reply_to', payload.in_reply_to);
  if (payload.references) form.append('references', payload.references);
  for (const f of payload.files || []) {
    form.append('files', f);
  }
  return (
    await apiClient.post('/gmail/messages/send', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: LONG_TIMEOUT,
    })
  ).data;
};

export const getGmailAttachmentDownloadUrl = (attachmentRowId: number): string => {
  const base = apiClient.defaults.baseURL || 'http://127.0.0.1:8000/api/v1';
  return `${base}/gmail/attachments/${attachmentRowId}/download`;
};

export const importGmailAttachmentToBooking = async (
  attachmentRowId: number,
  collectionId?: number
): Promise<{ status: string; booking_id?: number; booking_no: string; collection_id: number; message: string }> =>
  (
    await apiClient.post(
      `/gmail/attachments/${attachmentRowId}/import-booking`,
      { collection_id: collectionId || null },
      { timeout: LONG_TIMEOUT }
    )
  ).data;

export const getGmailTemplates = async (): Promise<GmailTemplate[]> =>
  (await apiClient.get<{ items: GmailTemplate[] }>('/gmail/templates')).data.items;

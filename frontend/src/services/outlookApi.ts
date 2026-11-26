import { apiClient, LONG_TIMEOUT } from './api';

export interface OutlookAccount {
  id: number;
  email: string;
  display_name: string;
  status: 'connected' | 'error';
  last_error: string;
}

export interface OutlookConfig {
  has_oauth_config: boolean;
  /** Signs in with the Microsoft app shipped in this build (no ids to enter) */
  using_builtin: boolean;
  /** Link an IT admin opens once to approve the app for the whole company */
  admin_consent_url: string;
  client_id: string;
  tenant_id: string;
  redirect_uri: string;
  redirect_path: string;
}

export interface OutlookFolder {
  id: string;
  name: string;
  parent_id: string;
  /** inbox | sentitems | drafts | archive | deleteditems | junkemail | '' for the user's own folders */
  well_known: string;
  unread: number;
  total: number;
  child_count: number;
  pinned: boolean;
}

export interface OutlookListItem {
  message_id: string;
  conversation_id: string;
  folder_id: string;
  subject: string;
  snippet: string;
  from_addr: string;
  to_addrs: string;
  is_unread: number;
  is_flagged: number;
  has_attachments: number;
  is_important: number;
  date_iso: string;
  internal_date_ms: number;
}

export interface OutlookAttachment {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  is_pdf: number;
  is_inline: number;
  content_id: string;
  imported_booking_no: string;
}

export interface OutlookMessage extends OutlookListItem {
  cc_addrs: string;
  body_html: string;
  body_text: string;
  rfc_message_id: string;
  attachments: OutlookAttachment[];
}

export interface OutlookConversation {
  conversation_id: string;
  subject: string;
  is_unread: number;
  is_flagged: number;
  latest_message_id: string;
  messages: OutlookMessage[];
}

export type OutlookAction = 'read' | 'unread' | 'flag' | 'unflag' | 'move' | 'archive' | 'delete';

const base = (accountId: number) => `/outlook/accounts/${accountId}`;

export const getOutlookConfig = async (): Promise<OutlookConfig> =>
  (await apiClient.get<OutlookConfig>('/outlook/config')).data;

export const saveOutlookConfig = async (clientId: string, tenantId: string): Promise<void> => {
  await apiClient.put('/outlook/config/oauth', { client_id: clientId, tenant_id: tenantId });
};

export const clearOutlookConfig = async (): Promise<void> => {
  await apiClient.delete('/outlook/config/oauth');
};

export const startOutlookOAuth = async (): Promise<{ auth_url: string }> =>
  (await apiClient.post<{ auth_url: string }>('/outlook/oauth/start')).data;

export const getOutlookAccounts = async (): Promise<OutlookAccount[]> =>
  (await apiClient.get<{ items: OutlookAccount[] }>('/outlook/accounts')).data.items;

export const deleteOutlookAccount = async (accountId: number): Promise<void> => {
  await apiClient.delete(`/outlook/accounts/${accountId}`);
};

export const getOutlookUnreadCount = async (): Promise<number> =>
  (await apiClient.get<{ unread: number }>('/outlook/unread-count', { timeout: LONG_TIMEOUT })).data.unread;

export const getOutlookFolders = async (accountId: number): Promise<{ folders: OutlookFolder[]; total_unread: number }> =>
  (await apiClient.get(`${base(accountId)}/folders`, { timeout: LONG_TIMEOUT })).data;

export const setOutlookFolderPinned = async (accountId: number, folderId: string, pinned: boolean): Promise<void> => {
  await apiClient.put(`${base(accountId)}/pin`, { folder_id: folderId, pinned });
};

export const getOutlookMessages = async (
  accountId: number,
  params: { folder_id?: string; search?: string; only_unread?: boolean; only_attachments?: boolean; cursor?: string }
): Promise<{ items: OutlookListItem[]; next_cursor: string }> =>
  (await apiClient.get(`${base(accountId)}/messages`, { params, timeout: LONG_TIMEOUT })).data;

export const getOutlookConversation = async (
  accountId: number,
  conversationId: string,
  markRead = true
): Promise<OutlookConversation> =>
  (
    await apiClient.get(`${base(accountId)}/conversation`, {
      params: { conversation_id: conversationId, mark_read: markRead },
      timeout: LONG_TIMEOUT,
    })
  ).data;

export const runOutlookAction = async (
  accountId: number,
  messageIds: string[],
  action: OutlookAction,
  destination = ''
): Promise<number> =>
  (
    await apiClient.post(
      `${base(accountId)}/actions`,
      { message_ids: messageIds, action, destination },
      { timeout: LONG_TIMEOUT }
    )
  ).data.count;

export const getOutlookAttachmentUrl = (accountId: number, messageId: string, attachmentId: string): string => {
  const root = apiClient.defaults.baseURL || 'http://127.0.0.1:8000/api/v1';
  const q = new URLSearchParams({ message_id: messageId, attachment_id: attachmentId });
  return `${root}${base(accountId)}/attachment?${q.toString()}`;
};

export const importOutlookAttachment = async (
  accountId: number,
  messageId: string,
  attachmentId: string,
  collectionId?: number
): Promise<{ status: 'imported' | 'duplicate'; booking_no: string; message: string }> =>
  (
    await apiClient.post(
      `${base(accountId)}/import-booking`,
      { message_id: messageId, attachment_id: attachmentId, collection_id: collectionId ?? null },
      { timeout: LONG_TIMEOUT }
    )
  ).data;

export const sendOutlookMail = async (
  accountId: number,
  payload: {
    mode: 'new' | 'reply' | 'forward';
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    replyToMessageId?: string;
    files: File[];
  }
): Promise<{ ok: boolean; conversation_id?: string }> => {
  const form = new FormData();
  form.append('mode', payload.mode);
  form.append('to_addrs', payload.to);
  form.append('cc_addrs', payload.cc);
  form.append('bcc_addrs', payload.bcc);
  form.append('subject', payload.subject);
  form.append('body_text', payload.body);
  form.append('reply_to_message_id', payload.replyToMessageId || '');
  payload.files.forEach((f) => form.append('files', f));
  return (
    await apiClient.post(`${base(accountId)}/send`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: LONG_TIMEOUT,
    })
  ).data;
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  LogOut,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Truck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { getBookingTasksApi } from '../../services/api';
import {
  createZaloTemplate,
  deleteZaloTemplate,
  getZaloConversation,
  getZaloConversations,
  getZaloMediaUrl,
  getZaloMessages,
  getZaloSession,
  getZaloTemplates,
  getZaloUnlinkedDrivers,
  markZaloConversationRead,
  patchZaloConversation,
  ZaloFilter,
} from '../../services/zaloApi';
import type {
  BookingTask,
  ZaloBridgeState,
  ZaloConversation,
  ZaloMessage,
  ZaloTemplate,
  ZaloUnlinkedDriver,
} from '../../types';

export interface ZaloDraftRequest {
  id: number;
  text: string;
  threadId?: string;
  bookingNo?: string;
}

interface ZaloTabProps {
  initialThreadId?: string;
  draftRequest?: ZaloDraftRequest | null;
  onDraftHandled?: (id: number) => void;
  onUnreadCountChange?: (count: number) => void;
}

const FILTER_OPTIONS: { id: ZaloFilter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'drivers', label: 'Tài xế' },
  { id: 'unread', label: 'Chưa đọc' },
  { id: 'pending', label: 'Chờ xử lý' },
];

// Template fields a booking fills in. {driver_name}/{vehicle_plate} come from the conversation instead.
const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

function findPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_RE)].map((m) => m[0]))];
}

function taskPlaceholderValues(task: BookingTask): Record<string, string> {
  const qty = task["Q'ty"];
  const eq = task['Equipment Type'] || '';
  return {
    booking_no: task['Booking No'] || '',
    qty_type: qty && eq ? `${qty}x${eq}` : eq,
    empty_pickup_cy: task['Empty pickup CY'] || '',
    full_return_cy: task['Full return CY'] || '',
    cutoff_time: task['Hạn cut-off'] || '',
    vessel: task.Vessel || '',
  };
}

/** Fill the placeholders that have a value; ones without stay as {name} so the send check still catches them. */
function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, key: string) => (values[key] ? values[key] : whole));
}

const MESSAGE_PAGE = 50;
const OLDER_SYNC_OPTIONS = [
  { days: 90, label: '90 ngày' },
  { days: 365, label: '1 năm' },
];

/** Union of two message lists, ordered like the chat (oldest first by time, then id). */
function mergeMessages(a: ZaloMessage[], b: ZaloMessage[]): ZaloMessage[] {
  const byId = new Map<number, ZaloMessage>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) =>
    x.created_at === y.created_at ? x.id - y.id : x.created_at < y.created_at ? -1 : 1
  );
}

// Zalo stores a sticker as "[^categoryId,stickerId^]" (phone sync, and the bridge for live ones).
const STICKER_RE = /^\[\^(\d+),(\d+)\^\]$/;

function stickerImageUrl(content: string): string {
  const m = STICKER_RE.exec((content || '').trim());
  return m ? `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${m[2]}&size=130` : '';
}

/** List preview: stickers read as "[Sticker]" instead of their raw code. */
function previewText(text: string): string {
  return STICKER_RE.test((text || '').trim()) ? '[Sticker]' : text;
}

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;

/** Message text with http(s) links clickable; Electron opens them in the system browser. */
const LinkifiedText: React.FC<{ text: string; isOut: boolean }> = ({ text, isOut }) => (
  <>
    {text.split(URL_RE).map((part, i) =>
      i % 2 === 1 ? (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer"
          className={`underline break-all ${isOut ? 'text-white hover:text-blue-100' : 'text-blue-600 dark:text-blue-300 hover:text-blue-700'}`}
        >
          {part}
        </a>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    )}
  </>
);

function formatZaloDateTime(iso?: string, shortOnly = false): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, , month, day, hour, minute] = m;
  if (shortOnly) return `${day}/${month} ${hour}:${minute}`;
  return `${hour}:${minute} • ${day}/${month}`;
}

export const ZaloTab: React.FC<ZaloTabProps> = ({
  initialThreadId,
  draftRequest,
  onDraftHandled,
  onUnreadCountChange,
}) => {
  const { addToast } = useToast();
  const { t } = useApp();
  const electronAPI = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const hasZaloBridge = !!electronAPI?.zaloLoginQR;

  const [bridgeState, setBridgeState] = useState<ZaloBridgeState>({
    status: 'disconnected',
    uid: '',
    displayName: '',
    phone: '',
    avatar: '',
    lastError: '',
  });
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1);
  const [setupStatusText, setSetupStatusText] = useState('');
  const [setupError, setSetupError] = useState('');
  const [qrState, setQrState] = useState<{
    stage: 'loading' | 'generated' | 'scanned' | 'expired' | 'declined';
    image?: string;
    displayName?: string;
  }>({ stage: 'loading' });

  const [filter, setFilter] = useState<ZaloFilter>('all');
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState<ZaloConversation[]>([]);
  const [counts, setCounts] = useState({ all: 0, drivers: 0, unread: 0, pending: 0, unread_messages: 0 });
  const [selectedThreadId, setSelectedThreadId] = useState<string>('');
  // The open conversation can drop out of the filtered list (e.g. "Chưa đọc" once it is read): keep its
  // last known row so the chat stays open.
  const [selectedConvSnapshot, setSelectedConvSnapshot] = useState<ZaloConversation | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [messages, setMessages] = useState<ZaloMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);

  const [templates, setTemplates] = useState<ZaloTemplate[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [newTplName, setNewTplName] = useState('');
  const [newTplShortcut, setNewTplShortcut] = useState('');
  const [newTplContent, setNewTplContent] = useState('');

  const [unlinkedDrivers, setUnlinkedDrivers] = useState<ZaloUnlinkedDriver[]>([]);
  const [showFindDriverModal, setShowFindDriverModal] = useState(false);
  const [findingDriverId, setFindingDriverId] = useState<number | null>(null);

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchText, setBatchText] = useState('');
  const [batchSending, setBatchSending] = useState(false);
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [syncingMessages, setSyncingMessages] = useState(false);
  const [syncProgressText, setSyncProgressText] = useState('');

  const [todayTasks, setTodayTasks] = useState<BookingTask[]>([]);
  const messagesBoxRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<ZaloMessage[]>([]);
  messagesRef.current = messages;
  // Follow new messages only while the user is at the bottom; reading older ones must not be yanked down.
  const stickToBottomRef = useRef(true);
  // Set before prepending an older page so the visible messages stay put.
  const scrollRestoreRef = useRef<{ height: number; top: number } | null>(null);
  const loadingOlderRef = useRef(false);
  const autoQrTriggeredRef = useRef(false);
  const qrGeneratedRef = useRef(false);
  const selectedThreadIdRef = useRef('');
  selectedThreadIdRef.current = selectedThreadId;

  const selectedConv = useMemo(
    () =>
      conversations.find((c) => c.thread_id === selectedThreadId) ||
      (selectedConvSnapshot?.thread_id === selectedThreadId ? selectedConvSnapshot : null),
    [conversations, selectedThreadId, selectedConvSnapshot]
  );
  const isConnected = bridgeState.status === 'connected' && !!electronAPI?.zaloSendMessage;
  const composerPlaceholders = useMemo(() => findPlaceholders(composerText), [composerText]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await getZaloConversations(filter, search);
      setConversations(res.items);
      setCounts(res.counts);
      onUnreadCountChange?.(res.counts.unread_messages);
    } catch {
      // ignore transient fetch errors
    }
  }, [filter, search, onUnreadCountChange]);

  // `silent` refreshes an already open chat (new message arrived) without the loading placeholder.
  const loadMessages = useCallback(
    async (threadId: string, conv?: ZaloConversation | null, silent = false) => {
      if (!threadId) {
        setMessages([]);
        return;
      }
      if (!silent) setLoadingMessages(true);
      try {
        let rows = await getZaloMessages(threadId, MESSAGE_PAGE);
        if (rows.length === 0 && conv?.thread_type === 'group' && electronAPI?.zaloFetchGroupHistory && bridgeState.status === 'connected') {
          const fetched = await electronAPI.zaloFetchGroupHistory(threadId).catch(() => ({ inserted: 0 }));
          if (fetched.inserted > 0) {
            rows = await getZaloMessages(threadId, MESSAGE_PAGE);
          }
        }
        if (selectedThreadIdRef.current !== threadId) return;
        if (silent) {
          // Keep older pages the user already scrolled through; only add what is new.
          setMessages((prev) => mergeMessages(prev, rows));
        } else {
          stickToBottomRef.current = true;
          setMessages(rows);
          setHasOlder(rows.length === MESSAGE_PAGE);
        }
        // The chat is on screen, so whatever just arrived in it has been read.
        const read = await markZaloConversationRead(threadId).catch(() => null);
        if (read && selectedThreadIdRef.current === threadId) setSelectedConvSnapshot(read);
        loadConversations();
      } catch {
        if (!silent) addToast('Không tải được lịch sử tin nhắn', 'error');
      } finally {
        if (!silent) setLoadingMessages(false);
      }
    },
    [addToast, electronAPI, bridgeState.status, loadConversations]
  );

  const loadOlderMessages = useCallback(async () => {
    const threadId = selectedThreadIdRef.current;
    const oldest = messagesRef.current[0];
    if (!threadId || !oldest || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const rows = await getZaloMessages(threadId, MESSAGE_PAGE, oldest.id);
      if (selectedThreadIdRef.current !== threadId) return;
      const box = messagesBoxRef.current;
      if (box && rows.length > 0) scrollRestoreRef.current = { height: box.scrollHeight, top: box.scrollTop };
      setMessages((prev) => mergeMessages(rows, prev));
      setHasOlder(rows.length === MESSAGE_PAGE);
    } catch {
      addToast('Không tải được tin nhắn cũ hơn', 'error');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [addToast]);

  const handleMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const box = e.currentTarget;
    stickToBottomRef.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    if (box.scrollTop < 40 && hasOlder && !loadingOlderRef.current) void loadOlderMessages();
  };

  // Latest loaders for the long-lived Electron event subscriptions below.
  const loadConversationsRef = useRef(loadConversations);
  loadConversationsRef.current = loadConversations;
  const loadMessagesRef = useRef(loadMessages);
  loadMessagesRef.current = loadMessages;

  const loadTemplatesAndDrivers = useCallback(async () => {
    try {
      const [tpls, drivers] = await Promise.all([getZaloTemplates(), getZaloUnlinkedDrivers()]);
      setTemplates(tpls);
      setUnlinkedDrivers(drivers);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadTemplatesAndDrivers();
    getBookingTasksApi()
      .then((res) => setTodayTasks([...(res.late || []), ...(res.today || [])].slice(0, 15)))
      .catch(() => {});
  }, [loadTemplatesAndDrivers]);

  useEffect(() => {
    if (initialThreadId) {
      setSelectedThreadId(initialThreadId);
    }
  }, [initialThreadId]);

  useEffect(() => {
    if (draftRequest) {
      setComposerText(draftRequest.text);
      if (draftRequest.threadId) setSelectedThreadId(draftRequest.threadId);
      onDraftHandled?.(draftRequest.id);
    }
  }, [draftRequest, onDraftHandled]);

  useEffect(() => {
    if (selectedThreadId) {
      const conv = conversations.find((c) => c.thread_id === selectedThreadId) || null;
      setSelectedConvSnapshot(conv);
      if (!conv) {
        // Opened from outside the current filter (notification, driver lookup): fetch the row itself.
        getZaloConversation(selectedThreadId)
          .then((c) => {
            if (selectedThreadIdRef.current === c.thread_id) setSelectedConvSnapshot(c);
          })
          .catch(() => {});
      }
      loadMessages(selectedThreadId, conv);
    } else {
      setSelectedConvSnapshot(null);
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId]);

  useEffect(() => {
    const row = conversations.find((c) => c.thread_id === selectedThreadIdRef.current);
    if (row) setSelectedConvSnapshot(row);
  }, [conversations]);

  // Pin the chat to its newest message. Instant, not smooth: the warning lines above the composer can
  // appear in the same render and shrink the list, which cut a smooth scroll short.
  const hasPlaceholders = composerPlaceholders.length > 0;
  useEffect(() => {
    const box = messagesBoxRef.current;
    if (!box) return;
    const restore = scrollRestoreRef.current;
    if (restore) {
      scrollRestoreRef.current = null;
      box.scrollTop = box.scrollHeight - restore.height + restore.top;
    } else if (stickToBottomRef.current) {
      box.scrollTop = box.scrollHeight;
    }
  }, [messages, loadingMessages, isConnected, hasPlaceholders]);

  // Bridge state once per mount. Auto-open the QR only when there is no saved session to reconnect with.
  useEffect(() => {
    if (electronAPI?.zaloGetState) {
      electronAPI
        .zaloGetState()
        .then((st) => {
          setBridgeState(st);
          if (st.status === 'disconnected' && !st.hasSavedSession && !autoQrTriggeredRef.current && electronAPI.zaloLoginQR) {
            autoQrTriggeredRef.current = true;
            void runQrLogin();
          }
        })
        .catch(() => {});
    } else {
      getZaloSession()
        .then((s) =>
          setBridgeState({
            status: (s.status as ZaloBridgeState['status']) || 'disconnected',
            uid: s.uid || '',
            displayName: s.display_name || '',
            phone: s.phone || '',
            avatar: s.avatar || '',
            lastError: s.last_error || '',
          })
        )
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [electronAPI]);

  // Electron events. Subscribed once; reads the open thread and loaders through refs.
  useEffect(() => {
    const unsubStatus = electronAPI?.onZaloStatus?.((st) => {
      setBridgeState(st);
      if (st.status === 'connected') {
        setSetupStep(2);
        setSetupStatusText('Đăng nhập thành công! Đang chuẩn bị đồng bộ danh bạ...');
        setSetupError('');
      }
    });
    const unsubQR = electronAPI?.onZaloQR?.((data) => {
      if (data.stage === 'generated') qrGeneratedRef.current = true;
      setQrState({ stage: data.stage, image: data.image, displayName: data.displayName });
    });
    const unsubMsg = electronAPI?.onZaloMessageReceived?.((payload) => {
      loadConversationsRef.current();
      const openId = selectedThreadIdRef.current;
      if (!openId) return;
      const threadId = payload?.message?.thread_id || payload?.conversation?.thread_id;
      // History/contact syncs carry no thread id: refresh the open chat too.
      if (!threadId || threadId === openId) {
        loadMessagesRef.current(openId, undefined, true);
      }
    });
    const unsubProgress = electronAPI?.onZaloSyncProgress?.((p) => {
      if (p.stage === 'syncing_contacts') {
        setSetupStep(2);
        setSetupStatusText(p.message || 'Đang đồng bộ danh bạ & nhóm...');
      } else if (p.stage === 'contacts_done') {
        setSetupStep(3);
        setSetupStatusText(p.message || 'Đã xong danh bạ, chuyển sang đồng bộ tin nhắn...');
      } else if (p.stage === 'waiting_phone' || p.stage === 'syncing') {
        setSetupStep(3);
        setSyncingMessages(true);
        setSyncProgressText(p.message || '');
        setSetupStatusText(p.message || '');
      } else if (p.stage === 'done') {
        setSyncingMessages(false);
        setSyncProgressText('');
        setSetupStatusText(p.message || 'Hoàn tất đồng bộ!');
        setQrModalOpen(false);
        loadConversationsRef.current();
      } else if (p.stage === 'error') {
        setSyncingMessages(false);
        setSyncProgressText('');
        setSetupError(p.message || 'Đồng bộ gặp lỗi');
      }
    });
    return () => {
      unsubStatus?.();
      unsubQR?.();
      unsubMsg?.();
      unsubProgress?.();
    };
  }, [electronAPI]);

  const runQrLogin = async () => {
    if (!electronAPI?.zaloLoginQR) return;
    qrGeneratedRef.current = false;
    setSetupStep(1);
    setSetupStatusText('Mở Zalo trên điện thoại và quét mã QR bên dưới');
    setSetupError('');
    setQrState({ stage: 'loading' });
    setQrModalOpen(true);
    try {
      const st = await electronAPI.zaloLoginQR();
      // A session restore finished first: no QR was needed, so don't leave the modal spinning.
      if (st?.status === 'connected' && !qrGeneratedRef.current) setQrModalOpen(false);
    } catch (e: any) {
      setSetupError(e?.message || 'Đăng nhập Zalo thất bại');
      addToast(e?.message || 'Đăng nhập Zalo thất bại', 'error');
    }
  };

  const handleReconnect = async () => {
    if (!electronAPI?.zaloReconnect || reconnecting) return;
    setReconnecting(true);
    try {
      const st = await electronAPI.zaloReconnect();
      setBridgeState(st);
      if (st.status === 'connected') addToast('Đã kết nối lại Zalo', 'success');
      else addToast(st.lastError || 'Không kết nối lại được, hãy quét QR', 'error');
    } catch (e: any) {
      addToast(e?.message || 'Không kết nối lại được, hãy quét QR', 'error');
    } finally {
      setReconnecting(false);
    }
  };

  const handleStartQRLogin = async () => {
    if (!electronAPI?.zaloLoginQR) {
      addToast('Đăng nhập QR chỉ khả dụng trên ứng dụng Desktop (Electron)', 'info');
      return;
    }
    await runQrLogin();
  };

  const handleLogout = async () => {
    if (!electronAPI?.zaloLogout) return;
    await electronAPI.zaloLogout();
    setSelectedThreadId('');
    setMessages([]);
    setConversations([]);
    setCounts({ all: 0, drivers: 0, unread: 0, pending: 0, unread_messages: 0 });
    onUnreadCountChange?.(0);
    autoQrTriggeredRef.current = false;
    await Promise.all([loadConversations(), loadTemplatesAndDrivers()]);
    addToast('Đã đăng xuất và xóa dữ liệu Zalo cũ', 'info');
  };

  const handleSyncContacts = async () => {
    if (!electronAPI?.zaloSyncContacts || bridgeState.status !== 'connected' || syncingContacts) return;
    setSyncingContacts(true);
    try {
      const res = await electronAPI.zaloSyncContacts();
      await loadConversations();
      addToast(`Đã đồng bộ ${res?.synced || 0} bạn bè & nhóm Zalo`, 'success');
    } catch (e: any) {
      addToast(e?.message || 'Đồng bộ danh bạ thất bại', 'error');
    } finally {
      setSyncingContacts(false);
    }
  };

  const handleSyncMessages = async (days?: number) => {
    if (!electronAPI?.zaloSyncMessages || bridgeState.status !== 'connected' || syncingMessages) return;
    setSyncingMessages(true);
    setSyncProgressText('Đang gửi yêu cầu đồng bộ tới điện thoại... Mở Zalo trên điện thoại và bấm Xác nhận.');
    const openId = selectedThreadIdRef.current;
    const oldestBefore = messagesRef.current[0];
    try {
      const res = await electronAPI.zaloSyncMessages(days ? { days } : undefined);
      await loadConversations();
      if (openId) await loadMessages(openId);
      addToast(`Đã đồng bộ ${res?.inserted || 0} tin nhắn mới từ ${res?.conversations || 0} hội thoại`, 'success');
      // Say plainly when the phone had nothing older for the chat the user is looking at.
      if (days && openId && oldestBefore) {
        const older = await getZaloMessages(openId, 1, oldestBefore.id).catch(() => []);
        if (older.length === 0) addToast('Điện thoại không có tin nào cũ hơn trong hội thoại này', 'info');
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      addToast(
        /not confirmed/i.test(msg)
          ? 'Chưa bấm Xác nhận đồng bộ trên điện thoại trong 2 phút — hãy thử lại và xác nhận trên điện thoại.'
          : msg || 'Đồng bộ tin nhắn thất bại (kiểm tra xác nhận trên điện thoại)',
        'error'
      );
    } finally {
      setSyncingMessages(false);
      setSyncProgressText('');
    }
  };

  const applyTemplate = (tpl: ZaloTemplate) => {
    const text = fillPlaceholders(tpl.content, {
      driver_name: selectedConv?.driver_name || selectedConv?.display_name || '',
      vehicle_plate: selectedConv?.vehicle_plate || '',
    });
    setComposerText((prev) => (prev ? `${prev}\n${text}` : text));
  };

  // With a template's booking fields still open, a booking fills them; otherwise it adds a summary line.
  const insertTaskIntoComposer = (task: BookingTask) => {
    const values = taskPlaceholderValues(task);
    setComposerText((prev) => {
      if (findPlaceholders(prev).some((p) => values[p.slice(1, -1)])) return fillPlaceholders(prev, values);
      const line = `Booking ${values.booking_no} (${values.qty_type}) — Lấy rỗng: ${values.empty_pickup_cy || '-'} — Hạ: ${values.full_return_cy || '-'} — Cut-off: ${values.cutoff_time || '-'}`;
      return prev ? `${prev}\n${line}` : line;
    });
  };

  const handleSend = async () => {
    const text = composerText.trim();
    if (!text || !selectedConv || sending) return;
    if (!isConnected || !electronAPI?.zaloSendMessage) {
      addToast('Zalo chưa kết nối — tin nhắn CHƯA được gửi. Hãy kết nối lại rồi gửi.', 'error');
      return;
    }
    const missing = findPlaceholders(text);
    if (missing.length > 0) {
      addToast(`Tin còn ô chưa điền: ${missing.join(', ')}`, 'error');
      return;
    }
    setSending(true);
    try {
      await electronAPI.zaloSendMessage({
        threadId: selectedConv.thread_id,
        threadType: selectedConv.thread_type,
        text,
        displayName: selectedConv.display_name,
        phone: selectedConv.phone,
      });
      setComposerText('');
      stickToBottomRef.current = true;
      await loadMessages(selectedConv.thread_id, selectedConv, true);
    } catch (e: any) {
      addToast(e?.message || 'Gửi tin nhắn thất bại', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleToggleAttention = async () => {
    if (!selectedConv) return;
    const next = !selectedConv.needs_attention;
    await patchZaloConversation(selectedConv.thread_id, { needs_attention: next });
    await loadConversations();
  };

  const handleFindDriverZalo = async (d: ZaloUnlinkedDriver) => {
    if (!electronAPI?.zaloFindUser || bridgeState.status !== 'connected') {
      addToast('Vui lòng kết nối Zalo trước khi tìm theo SĐT', 'info');
      return;
    }
    setFindingDriverId(d.id);
    try {
      const conv = await electronAPI.zaloFindUser({
        phone: d.phone,
        driverId: d.id,
        driverName: d.name,
      });
      addToast(`Đã liên kết Zalo tài xế ${d.name}`, 'success');
      setShowFindDriverModal(false);
      await Promise.all([loadConversations(), loadTemplatesAndDrivers()]);
      if (conv?.thread_id) setSelectedThreadId(conv.thread_id);
    } catch (e: any) {
      addToast(e?.message || `Không tìm thấy Zalo cho SĐT ${d.phone}`, 'error');
    } finally {
      setFindingDriverId(null);
    }
  };

  const handleBatchSend = async () => {
    const text = batchText.trim();
    if (!text || batchSelectedIds.length === 0 || batchSending) return;
    if (!electronAPI?.zaloSendBatch || bridgeState.status !== 'connected') {
      addToast('Vui lòng kết nối Zalo trước khi gửi hàng loạt', 'info');
      return;
    }
    const missing = findPlaceholders(text);
    if (missing.length > 0) {
      addToast(`Tin còn ô chưa điền: ${missing.join(', ')}`, 'error');
      return;
    }
    setBatchSending(true);
    try {
      const recipients = conversations
        .filter((c) => batchSelectedIds.includes(c.thread_id))
        .map((c) => ({
          threadId: c.thread_id,
          threadType: c.thread_type,
          displayName: c.display_name,
          phone: c.phone,
        }));
      const results = await electronAPI.zaloSendBatch({ recipients, text });
      const okCount = results.filter((r) => r.ok).length;
      addToast(`Đã gửi thành công ${okCount}/${recipients.length} tài xế`, okCount === recipients.length ? 'success' : 'info');
      setShowBatchModal(false);
      setBatchText('');
      setBatchSelectedIds([]);
      await loadConversations();
    } catch (e: any) {
      addToast(e?.message || 'Gửi nhóm thất bại', 'error');
    } finally {
      setBatchSending(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!newTplName.trim() || !newTplContent.trim()) return;
    try {
      await createZaloTemplate({
        name: newTplName,
        shortcut: newTplShortcut,
        content: newTplContent,
      });
      setNewTplName('');
      setNewTplShortcut('');
      setNewTplContent('');
      setShowTemplateModal(false);
      await loadTemplatesAndDrivers();
      addToast('Đã thêm mẫu tin nhắn', 'success');
    } catch {
      addToast('Không thể tạo mẫu tin nhắn', 'error');
    }
  };

  const handleDeleteTemplate = async (id: number) => {
    await deleteZaloTemplate(id);
    await loadTemplatesAndDrivers();
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Top connection bar */}
      <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Quản lý Tin nhắn Zalo</h2>
          </div>
          {bridgeState.status === 'connected' ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Đã kết nối: {bridgeState.displayName || bridgeState.uid}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              Chưa kết nối Zalo
            </span>
          )}
          {bridgeState.lastError && (
            <span className="text-xs text-rose-600 dark:text-rose-400 truncate max-w-md">{bridgeState.lastError}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setBatchSelectedIds(conversations.filter((c) => c.driver_id !== null).slice(0, 3).map((c) => c.thread_id));
              setShowBatchModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5" />
            Gửi 2–3 tài xế
          </button>

          <button
            onClick={() => setShowFindDriverModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Tìm tài xế ({unlinkedDrivers.length})
          </button>

          {bridgeState.status === 'connected' ? (
            <>
              <button
                onClick={handleSyncContacts}
                disabled={syncingContacts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingContacts ? 'animate-spin' : ''}`} />
                {syncingContacts ? 'Đang đồng bộ...' : 'Đồng bộ danh bạ'}
              </button>
              <button
                onClick={() => handleSyncMessages()}
                disabled={syncingMessages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingMessages ? 'animate-spin' : ''}`} />
                {syncingMessages ? 'Đang đồng bộ tin...' : 'Đồng bộ tin nhắn'}
              </button>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Đăng xuất
              </button>
            </>
          ) : (
            <>
            {bridgeState.hasSavedSession && electronAPI?.zaloReconnect && (
              <button
                onClick={handleReconnect}
                disabled={reconnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${reconnecting ? 'animate-spin' : ''}`} />
                {reconnecting ? 'Đang kết nối...' : 'Kết nối lại'}
              </button>
            )}
            <button
              onClick={handleStartQRLogin}
              disabled={!hasZaloBridge}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white cursor-pointer"
            >
              <QrCode className="w-3.5 h-3.5" />
              Đăng nhập QR Zalo
            </button>
            </>
          )}
        </div>
      </div>

      {/* Sync progress banner */}
      {syncingMessages && syncProgressText && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/60 border-b border-blue-200 dark:border-blue-800 text-xs font-medium text-blue-700 dark:text-blue-200 flex items-center gap-2 shrink-0">
          <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span>{syncProgressText}</span>
        </div>
      )}

      {/* 3-Column Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Conversation list & filters */}
        <div className="w-80 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0">
          <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm tài xế, biển số, SĐT..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              {FILTER_OPTIONS.map((opt) => {
                const active = filter === opt.id;
                const count = counts[opt.id];
                return (
                  <button
                    key={opt.id}
                    onClick={() => setFilter(opt.id)}
                    className={`px-1.5 py-1 rounded text-[11px] font-semibold truncate cursor-pointer transition-colors ${
                      active
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {opt.label} {count > 0 ? `(${count})` : ''}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
            {conversations.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                Chưa có hội thoại nào. Hãy đăng nhập QR hoặc bấm <b>Tìm tài xế</b> để bắt đầu nhắn tin.
              </div>
            ) : (
              conversations.map((conv) => {
                const isSelected = conv.thread_id === selectedThreadId;
                const title = conv.driver_name || conv.display_name || conv.thread_id;
                // Unread rows read like Zalo's: bold name + preview, blue time, count pill, tinted row.
                const isUnread = conv.unread_count > 0;
                return (
                  <button
                    key={conv.thread_id}
                    onClick={() => setSelectedThreadId(conv.thread_id)}
                    className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/40 border-l-2 border-blue-600'
                        : isUnread
                        ? 'bg-sky-50/70 dark:bg-sky-950/20 hover:bg-sky-100/70 dark:hover:bg-sky-950/40 border-l-2 border-sky-500'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 border-l-2 border-transparent'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-700 dark:text-slate-200 shrink-0 overflow-hidden">
                      {conv.avatar ? (
                        <img src={conv.avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        title.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={`text-xs truncate ${
                            isUnread ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {title}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {conv.last_message_at && (
                            <span className={`text-[10px] ${isUnread ? 'font-semibold text-sky-600 dark:text-sky-400' : 'text-slate-400'}`}>
                              {formatZaloDateTime(conv.last_message_at, true)}
                            </span>
                          )}
                          {isUnread && (
                            <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold bg-rose-500 text-white">
                              {conv.unread_count > 99 ? '99+' : conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {conv.driver_id !== null && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            <Truck className="w-2.5 h-2.5" />
                            {conv.vehicle_plate || 'Tài xế'}
                          </span>
                        )}
                        {conv.needs_attention ? (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                            <Clock className="w-2.5 h-2.5" />
                            Chờ xử lý
                          </span>
                        ) : null}
                      </div>
                      <p
                        className={`text-[11px] truncate mt-1 ${
                          isUnread ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {conv.last_direction === 'out' ? 'Bạn: ' : ''}
                        {previewText(conv.last_message_preview) || 'Chưa có tin nhắn'}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Center: Chat stream & composer */}
        <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-950 min-w-0">
          {!selectedConv ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
              <MessageCircle className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                Chọn một tài xế hoặc hội thoại ở cột bên trái để xem tin nhắn
              </p>
              <p className="text-xs mt-1 max-w-md">
                Tin nhắn tài xế gửi tới sẽ tự động hiển thị ở đây, gắn với hồ sơ Tài xế & Biển số xe.
              </p>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {selectedConv.driver_name || selectedConv.display_name}
                    </h3>
                    {selectedConv.vehicle_plate && (
                      <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[11px] font-semibold">
                        {selectedConv.vehicle_plate}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    SĐT: {selectedConv.driver_phone || selectedConv.phone || 'Chưa có'} • Thread: {selectedConv.thread_id}
                  </p>
                </div>

                <button
                  onClick={handleToggleAttention}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    selectedConv.needs_attention
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {selectedConv.needs_attention ? 'Đánh dấu đã xử lý' : 'Đánh dấu chờ xử lý'}
                </button>
              </div>

              {/* Messages */}
              <div ref={messagesBoxRef} onScroll={handleMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-2.5">
                {!loadingMessages && messages.length > 0 && (
                  <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400 min-h-[24px]">
                    {loadingOlder ? (
                      <span className="inline-flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Đang tải tin cũ hơn...
                      </span>
                    ) : hasOlder ? (
                      <button
                        onClick={() => void loadOlderMessages()}
                        className="px-2.5 py-1 rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-300/70 dark:hover:bg-slate-700 font-medium cursor-pointer"
                      >
                        Xem tin cũ hơn
                      </button>
                    ) : (
                      <div className="w-full max-w-md rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-center space-y-1.5">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          Đây là tin cũ nhất đang có trong app ({formatZaloDateTime(messages[0].created_at, true)})
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Zalo trên máy tính không giữ lịch sử cũ. Muốn xem tin trước đó, lấy từ điện thoại rồi bấm{' '}
                          <b>Xác nhận đồng bộ</b> trong Zalo trên điện thoại (trong 2 phút).
                        </p>
                        {isConnected ? (
                          <div className="flex items-center justify-center gap-2 pt-0.5">
                            {OLDER_SYNC_OPTIONS.map((opt) => (
                              <button
                                key={opt.days}
                                onClick={() => handleSyncMessages(opt.days)}
                                disabled={syncingMessages}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer"
                              >
                                <RefreshCw className={`w-3 h-3 ${syncingMessages ? 'animate-spin' : ''}`} />
                                Lấy tin {opt.label}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-rose-600 dark:text-rose-400">Kết nối Zalo trước để lấy tin cũ.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {loadingMessages ? (
                  <div className="text-center text-xs text-slate-400 py-4">Đang tải tin nhắn...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-xs text-slate-400 py-8">Chưa có tin nhắn nào trong hội thoại này.</div>
                ) : (
                  messages.map((m) => {
                    const isOut = m.direction === 'out';
                    const sticker = stickerImageUrl(m.content);
                    if (sticker) {
                      // Stickers stand on their own like in Zalo: no bubble, time underneath.
                      return (
                        <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                          <div className={`flex flex-col ${isOut ? 'items-end' : 'items-start'}`}>
                            <img
                              src={sticker}
                              alt="Sticker"
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="w-28 h-28 object-contain"
                              onError={(e) => {
                                const span = document.createElement('span');
                                span.textContent = '[Sticker]';
                                span.className = 'text-xs text-slate-400';
                                e.currentTarget.replaceWith(span);
                              }}
                            />
                            <span className="text-[10px] text-slate-400 mt-0.5">{formatZaloDateTime(m.created_at)}</span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[72%] rounded-xl px-3.5 py-2 text-xs shadow-sm ${
                            isOut
                              ? 'bg-blue-600 text-white rounded-br-none'
                              : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-bl-none'
                          }`}
                        >
                          {m.msg_type === 'image' && m.media_url && (
                            <a href={getZaloMediaUrl(m.media_url)} target="_blank" rel="noreferrer" className="block mb-1.5">
                              <img
                                src={getZaloMediaUrl(m.media_url)}
                                referrerPolicy="no-referrer"
                                alt="Zalo media"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                                className="max-h-64 rounded-lg object-contain bg-slate-100 dark:bg-slate-900"
                              />
                            </a>
                          )}
                          {m.msg_type === 'file' && m.media_url && (
                            <a
                              href={m.media_url}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg mb-1 text-xs font-medium underline ${
                                isOut
                                  ? 'bg-blue-700/60 text-white'
                                  : 'bg-slate-100 dark:bg-slate-700 text-blue-600 dark:text-blue-300'
                              }`}
                            >
                              <FileText className="w-4 h-4 shrink-0" />
                              <span className="truncate max-w-[220px]">{m.content || 'Tải tệp đính kèm'}</span>
                            </a>
                          )}
                          {m.content && !(m.msg_type === 'file' && m.media_url) && (
                            <div className="whitespace-pre-wrap break-words leading-relaxed">
                              <LinkifiedText text={m.content} isOut={isOut} />
                            </div>
                          )}
                          <div
                            className={`text-[10px] mt-1 flex items-center gap-2 ${
                              isOut ? 'text-blue-100 justify-end' : 'text-slate-400'
                            }`}
                          >
                            <span>{formatZaloDateTime(m.created_at)}</span>
                            {m.booking_no && <span className="font-semibold">#{m.booking_no}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Templates bar & Composer */}
              <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <span className="text-[11px] font-semibold text-slate-400 shrink-0">Mẫu nhanh:</span>
                  {templates.map((tpl) => (
                    <div key={tpl.id} className="inline-flex items-center shrink-0 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                      <button
                        onClick={() => applyTemplate(tpl)}
                        className="px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:text-blue-600 cursor-pointer"
                        title={tpl.content}
                      >
                        {tpl.name}
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="pr-1.5 text-slate-400 hover:text-rose-500 cursor-pointer"
                        title="Xóa mẫu"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setShowTemplateModal(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40 shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Thêm mẫu
                  </button>
                </div>

                {!isConnected && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    Zalo chưa kết nối — không gửi được tin. Bấm "Kết nối lại" hoặc đăng nhập QR ở trên.
                  </p>
                )}
                {composerPlaceholders.length > 0 && (
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    Còn ô chưa điền: {composerPlaceholders.join(', ')} — bấm "+ Chèn vào tin" ở booking bên phải hoặc sửa tay.
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    rows={3}
                    value={composerText}
                    onChange={(e) => setComposerText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="Nhập tin nhắn gửi tài xế... (Enter để gửi, Shift+Enter xuống dòng)"
                    className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!composerText.trim() || sending || !isConnected || composerPlaceholders.length > 0}
                    className="px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sending ? 'Đang gửi...' : 'Gửi'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Context Panel (Today's tasks & safe tips) */}
        <div className="w-72 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col shrink-0 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Việc hôm nay (Chèn nhanh)</span>
            <span title={t.tabs.zalo}>
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
            {todayTasks.length === 0 ? (
              <p className="text-[11px] text-slate-400 text-center py-4">Không có booking cần xử lý hôm nay.</p>
            ) : (
              todayTasks.map((task) => (
                <div
                  key={task.id}
                  className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                      {task['Booking No']}
                    </span>
                    <button
                      onClick={() => insertTaskIntoComposer(task)}
                      disabled={!selectedConv}
                      className="text-[10px] font-semibold text-blue-600 hover:underline disabled:opacity-40 cursor-pointer"
                    >
                      + Chèn vào tin
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {task.Carrier} • {task["Q'ty"]}x{task['Equipment Type']}
                  </p>
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 truncate">
                    Cut-off: {task['Hạn cut-off'] || '-'}
                  </p>
                </div>
              ))
            )}
          </div>
          <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 text-[11px] text-slate-500 dark:text-slate-400">
            Gửi nhóm tự động giãn cách <b>1.5–3s/người</b> để bảo vệ tài khoản Zalo.
          </div>
        </div>
      </div>

      {/* 3-Step Setup & Guide Modal */}
      {qrModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Thiết lập & Kết nối Zalo (3 bước)
              </h3>
              <button
                onClick={() => setQrModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Stepper Guide */}
            <div className="space-y-2 bg-slate-50 dark:bg-slate-800/60 rounded-lg p-3 border border-slate-200 dark:border-slate-700/70">
              {[
                { num: 1, title: 'Quét mã QR Zalo để đăng nhập', desc: 'Mở Zalo trên điện thoại → Quét mã QR' },
                { num: 2, title: 'Đồng bộ danh bạ & nhóm', desc: 'Tự động tải danh sách bạn bè, nhóm & ghép SĐT tài xế' },
                { num: 3, title: 'Đồng bộ tin nhắn (14 ngày)', desc: 'Bấm Xác nhận đồng bộ trên điện thoại Zalo khi có thông báo' },
              ].map((s) => {
                const isDone = setupStep > s.num;
                const isCurrent = setupStep === s.num;
                return (
                  <div key={s.num} className="flex items-start gap-2.5">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5 ${
                        isDone
                          ? 'bg-emerald-500 text-white'
                          : isCurrent
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                      }`}
                    >
                      {isDone ? '✓' : s.num}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-xs font-semibold ${
                          isCurrent
                            ? 'text-blue-600 dark:text-blue-400'
                            : isDone
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {s.title}
                      </div>
                      <div className="text-[11px] text-slate-400">{s.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Step Content */}
            <div className="flex flex-col items-center justify-center py-2 space-y-3">
              {setupStep === 1 && (
                <>
                  {qrState.stage === 'loading' && (
                    <div className="flex items-center gap-2 text-xs text-slate-500 py-8">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Đang tạo mã QR...
                    </div>
                  )}
                  {qrState.stage === 'generated' && qrState.image && (
                    <>
                      <img src={qrState.image} alt="Zalo QR" className="w-52 h-52 rounded-lg border border-slate-200" />
                      <p className="text-xs text-slate-500 text-center">
                        Mở Zalo trên điện thoại → Quét mã QR này để đăng nhập
                      </p>
                    </>
                  )}
                  {qrState.stage === 'scanned' && (
                    <p className="text-xs font-semibold text-emerald-600 py-6">
                      Đã quét mã ({qrState.displayName || 'Zalo'}) — Vui lòng bấm Xác nhận trên điện thoại...
                    </p>
                  )}
                  {(qrState.stage === 'expired' || qrState.stage === 'declined') && (
                    <button
                      onClick={handleStartQRLogin}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                    >
                      Mã hết hạn — Tạo lại mã QR
                    </button>
                  )}
                </>
              )}

              {setupStep >= 2 && (
                <div className="w-full text-center py-4 space-y-3">
                  {!setupError ? (
                    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-200 text-xs font-medium">
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>{setupStatusText || 'Đang đồng bộ dữ liệu...'}</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-rose-600 dark:text-rose-400">{setupError}</p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleSyncMessages()}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          Thử đồng bộ lại
                        </button>
                        <button
                          onClick={() => setQrModalOpen(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold cursor-pointer"
                        >
                          Vào màn hình chat
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Find Unlinked Drivers Modal */}
      {showFindDriverModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Tìm Zalo tài xế theo SĐT</h3>
              <button onClick={() => setShowFindDriverModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {unlinkedDrivers.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">Tất cả tài xế đang làm đều đã liên kết Zalo.</p>
              ) : (
                unlinkedDrivers.map((d) => (
                  <div key={d.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{d.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {d.phone || 'Chưa có SĐT'} {d.vehicle_plate ? `• ${d.vehicle_plate}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleFindDriverZalo(d)}
                      disabled={!d.phone || findingDriverId === d.id}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold cursor-pointer"
                    >
                      {findingDriverId === d.id ? 'Đang tìm...' : 'Tìm Zalo'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch Send Modal (2-3 drivers) */}
      {showBatchModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Gửi tin nhắn cho nhiều tài xế</h3>
              <button onClick={() => setShowBatchModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2 space-y-1">
              {conversations.map((c) => {
                const checked = batchSelectedIds.includes(c.thread_id);
                return (
                  <label key={c.thread_id} className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setBatchSelectedIds((prev) =>
                          checked ? prev.filter((id) => id !== c.thread_id) : [...prev, c.thread_id]
                        )
                      }
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{c.driver_name || c.display_name}</span>
                    {c.vehicle_plate && <span className="text-[11px] text-slate-400">({c.vehicle_plate})</span>}
                  </label>
                );
              })}
            </div>
            <textarea
              rows={4}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="Nội dung tin nhắn gửi cho các tài xế đã chọn..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs text-slate-800 dark:text-slate-100"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-500">Đã chọn: {batchSelectedIds.length} người (giãn cách 1.5–3s/người)</span>
              <button
                onClick={handleBatchSend}
                disabled={batchSelectedIds.length === 0 || !batchText.trim() || batchSending}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {batchSending ? 'Đang gửi lần lượt...' : 'Gửi ngay'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Thêm mẫu tin nhắn nhanh</h3>
              <button onClick={() => setShowTemplateModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={newTplName}
              onChange={(e) => setNewTplName(e.target.value)}
              placeholder="Tên mẫu (vd: Báo lấy rỗng)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs"
            />
            <input
              type="text"
              value={newTplShortcut}
              onChange={(e) => setNewTplShortcut(e.target.value)}
              placeholder="Phím tắt (vd: /lay-rong)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs"
            />
            <textarea
              rows={4}
              value={newTplContent}
              onChange={(e) => setNewTplContent(e.target.value)}
              placeholder="Nội dung mẫu... Hỗ trợ {driver_name}, {vehicle_plate}"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2.5 text-xs"
            />
            <div className="flex justify-end">
              <button
                onClick={handleCreateTemplate}
                disabled={!newTplName.trim() || !newTplContent.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                Lưu mẫu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

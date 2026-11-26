import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileInput,
  FileText,
  Flag,
  Folder,
  FolderInput,
  FolderOpen,
  Forward,
  Inbox,
  LogIn,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  Pin,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import {
  getOutlookAccounts,
  getOutlookAttachmentUrl,
  getOutlookConfig,
  getOutlookConversation,
  getOutlookFolders,
  getOutlookMessages,
  importOutlookAttachment,
  OutlookAccount,
  OutlookAction,
  OutlookAttachment,
  OutlookConversation,
  OutlookFolder,
  OutlookListItem,
  runOutlookAction,
  sendOutlookMail,
  setOutlookFolderPinned,
} from '../../services/outlookApi';
import { useToast } from '../../context/ToastContext';
import { useApp } from '../../context/AppContext';
import { GmailComposeDraft, GmailComposeModal, ComposeSendPayload } from '../gmail/GmailComposeModal';
import { GmailMessageCard, MailAttachmentView } from '../gmail/GmailMessageCard';
import { decodeEntities, shortName, splitAddresses, visibleAttachments } from '../gmail/gmailFormat';
import { buildFolderTree, filterFolderTree, flattenFolderTree, folderLabel, FolderNode, replyTarget } from './outlookFolders';
import { connectOutlookAccount, OutlookSettingsModal } from './OutlookSettingsModal';

interface OutlookTabProps {
  onUnreadCountChange?: (count: number) => void;
}

const REFRESH_MS = 2 * 60 * 1000;

const SYSTEM_ICONS: Record<string, React.ElementType> = {
  inbox: Inbox,
  sentitems: Send,
  drafts: PenSquare,
  archive: Archive,
  deleteditems: Trash2,
  junkemail: Mail,
};

function formatShortDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const withPrefix = (subject: string, prefix: 'RE' | 'FW') =>
  new RegExp(`^${prefix}:`, 'i').test(subject.trim()) ? subject : `${prefix}: ${subject}`;

// ---------- folder tree row ----------

interface FolderRowProps {
  node: FolderNode;
  activeId: string;
  expanded: Set<string>;
  forceOpen: boolean;
  onSelect: (f: OutlookFolder) => void;
  onToggle: (id: string) => void;
  onPin: (f: OutlookFolder) => void;
}

const FolderRow: React.FC<FolderRowProps> = ({ node, activeId, expanded, forceOpen, onSelect, onToggle, onPin }) => {
  const open = forceOpen || expanded.has(node.id);
  const active = node.id === activeId;
  const Icon = node.well_known ? SYSTEM_ICONS[node.well_known] || Folder : active ? FolderOpen : Folder;
  return (
    <>
      <div
        className={`group flex items-center gap-1 pr-1.5 rounded-lg text-xs cursor-pointer ${
          active
            ? 'bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300 font-semibold'
            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
        }`}
        style={{ paddingLeft: 4 + node.depth * 14 }}
        onClick={() => onSelect(node)}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (node.children.length) onToggle(node.id);
          }}
          className={`w-4 h-6 flex items-center justify-center shrink-0 text-slate-400 ${node.children.length ? 'cursor-pointer' : 'invisible'}`}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-80" />
        <span className={`truncate flex-1 py-1.5 ${node.unread > 0 && !active ? 'font-semibold text-slate-900 dark:text-white' : ''}`}>
          {node.label}
        </span>
        {!node.well_known && (
          <button
            type="button"
            title={node.pinned ? 'Bỏ ghim' : 'Ghim lên đầu'}
            onClick={(e) => {
              e.stopPropagation();
              onPin(node);
            }}
            className={`p-0.5 rounded shrink-0 cursor-pointer ${
              node.pinned ? 'text-amber-500' : 'text-slate-400 opacity-0 group-hover:opacity-100 hover:text-amber-500'
            }`}
          >
            <Pin className={`w-3 h-3 ${node.pinned ? 'fill-amber-500' : ''}`} />
          </button>
        )}
        {node.unread > 0 && (
          <span className="min-w-[18px] text-center text-[10px] font-bold text-primary-600 dark:text-primary-400 shrink-0">
            {node.unread}
          </span>
        )}
      </div>
      {open &&
        node.children.map((c) => (
          <FolderRow
            key={c.id}
            node={c}
            activeId={activeId}
            expanded={expanded}
            forceOpen={forceOpen}
            onSelect={onSelect}
            onToggle={onToggle}
            onPin={onPin}
          />
        ))}
    </>
  );
};

// ---------- move-to-folder picker ----------

const MovePicker: React.FC<{
  tree: FolderNode[];
  currentId: string;
  onPick: (f: FolderNode) => void;
  onClose: () => void;
}> = ({ tree, currentId, onPick, onClose }) => {
  const [q, setQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  const list = flattenFolderTree(filterFolderTree(tree, q)).filter((f) => f.id !== currentId);
  return (
    <div
      ref={boxRef}
      className="absolute right-0 top-full mt-1 w-72 z-30 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && list[0]) onPick(list[0]);
        }}
        placeholder="Tìm thư mục (vd: NESTLE)..."
        className="w-full mb-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <ul className="max-h-72 overflow-y-auto">
        {list.length === 0 && <li className="px-2 py-3 text-center text-[11px] text-slate-400">Không có thư mục nào khớp</li>}
        {list.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-md text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              style={{ paddingLeft: 8 + (q ? 0 : f.depth * 12) }}
            >
              <Folder className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{f.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

// ---------- tab ----------

export const OutlookTab: React.FC<OutlookTabProps> = ({ onUnreadCountChange }) => {
  const { addToast } = useToast();
  const { activeCollection } = useApp();

  const [accounts, setAccounts] = useState<OutlookAccount[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const account = useMemo(() => accounts.find((a) => a.id === accountId) || null, [accounts, accountId]);

  const [folders, setFolders] = useState<OutlookFolder[]>([]);
  const [foldersError, setFoldersError] = useState('');
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderId, setFolderId] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState('');
  const [searchAll, setSearchAll] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [onlyAttachments, setOnlyAttachments] = useState(false);
  const [items, setItems] = useState<OutlookListItem[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const listSeq = useRef(0);

  const [conversation, setConversation] = useState<OutlookConversation | null>(null);
  const [openConversationId, setOpenConversationId] = useState('');
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [importingKey, setImportingKey] = useState('');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canSignIn, setCanSignIn] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const stopSignInRef = useRef<(() => void) | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeDraft, setComposeDraft] = useState<GmailComposeDraft | null>(null);

  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const allTree = useMemo(() => [...tree.system, ...tree.custom], [tree]);
  const pinnedFolders = useMemo(() => flattenFolderTree(allTree).filter((f) => f.pinned), [allTree]);
  const visibleCustom = useMemo(() => filterFolderTree(tree.custom, folderFilter), [tree.custom, folderFilter]);
  const visibleSystem = useMemo(() => filterFolderTree(tree.system, folderFilter), [tree.system, folderFilter]);
  const currentFolder = folders.find((f) => f.id === folderId) || null;

  // ----- loading -----

  const loadAccounts = useCallback(async () => {
    try {
      const list = await getOutlookAccounts();
      setAccounts(list);
      setAccountId((prev) => (prev && list.some((a) => a.id === prev) ? prev : list[0]?.id ?? null));
    } catch {
      /* backend offline: keep what we have */
    } finally {
      setAccountsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  // With the Microsoft app shipped in the build, the empty tab is just one "Đăng nhập" button.
  useEffect(() => {
    if (accountsLoaded && accounts.length === 0) {
      getOutlookConfig()
        .then((cfg) => setCanSignIn(cfg.has_oauth_config))
        .catch(() => {});
    }
  }, [accountsLoaded, accounts.length, settingsOpen]);
  useEffect(() => () => stopSignInRef.current?.(), []);

  const signIn = async () => {
    setSigningIn(true);
    try {
      stopSignInRef.current?.();
      stopSignInRef.current = await connectOutlookAccount(
        accounts.length,
        () => {
          setSigningIn(false);
          addToast('Đã kết nối tài khoản Outlook', 'success');
          loadAccounts();
        },
        (msg) => {
          setSigningIn(false);
          addToast(msg, 'error');
        }
      );
    } catch (err: any) {
      setSigningIn(false);
      addToast(err?.response?.data?.detail || 'Không mở được trang đăng nhập Microsoft', 'error');
    }
  };

  const loadFolders = useCallback(
    async (silent = false) => {
      if (!accountId) return;
      if (!silent) setLoadingFolders(true);
      try {
        const res = await getOutlookFolders(accountId);
        setFolders(res.folders);
        setFoldersError('');
        onUnreadCountChange?.(res.total_unread);
        setFolderId((prev) => {
          if (prev && res.folders.some((f) => f.id === prev)) return prev;
          return res.folders.find((f) => f.well_known === 'inbox')?.id || res.folders[0]?.id || '';
        });
        setExpandedFolders((prev) => {
          if (prev.size > 0) return prev;
          const inbox = res.folders.find((f) => f.well_known === 'inbox');
          return inbox ? new Set([inbox.id]) : prev;
        });
      } catch (err: any) {
        setFoldersError(err?.response?.data?.detail || 'Không tải được thư mục Outlook');
      } finally {
        if (!silent) setLoadingFolders(false);
      }
    },
    [accountId, onUnreadCountChange]
  );

  useEffect(() => {
    setFolders([]);
    setFolderId('');
    setItems([]);
    setConversation(null);
    setOpenConversationId('');
    loadFolders();
  }, [accountId, loadFolders]);

  // Search waits for typing to pause.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadList = useCallback(
    async (silent = false) => {
      if (!accountId || (!folderId && !(debouncedSearch && searchAll))) return;
      const mine = ++listSeq.current;
      if (!silent) setLoadingList(true);
      try {
        const res = await getOutlookMessages(accountId, {
          folder_id: debouncedSearch && searchAll ? '' : folderId,
          search: debouncedSearch,
          only_unread: onlyUnread,
          only_attachments: onlyAttachments,
        });
        if (mine !== listSeq.current) return;
        setItems(res.items);
        setNextCursor(res.next_cursor);
      } catch (err: any) {
        if (mine === listSeq.current && !silent) {
          setItems([]);
          addToast(err?.response?.data?.detail || 'Không tải được danh sách email', 'error');
        }
      } finally {
        if (mine === listSeq.current && !silent) setLoadingList(false);
      }
    },
    [accountId, folderId, debouncedSearch, searchAll, onlyUnread, onlyAttachments, addToast]
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadMore = async () => {
    if (!accountId || !nextCursor) return;
    setLoadingMore(true);
    const mine = listSeq.current;
    try {
      const res = await getOutlookMessages(accountId, {
        cursor: nextCursor,
        search: debouncedSearch,
        only_unread: onlyUnread,
        only_attachments: onlyAttachments,
      });
      if (mine !== listSeq.current) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.message_id));
        return [...prev, ...res.items.filter((i) => !seen.has(i.message_id))];
      });
      setNextCursor(res.next_cursor);
    } catch (err: any) {
      addToast(err?.response?.data?.detail || 'Không tải thêm được', 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  // New mail shows up without pressing anything: folder counts and the first page refresh every 2 minutes.
  const refreshRef = useRef<() => void>(() => {});
  refreshRef.current = () => {
    loadFolders(true);
    if (!loadingMore && items.length <= 50) loadList(true);
  };
  useEffect(() => {
    if (!accountId) return undefined;
    const t = window.setInterval(() => refreshRef.current(), REFRESH_MS);
    return () => window.clearInterval(t);
  }, [accountId]);

  // ----- conversation -----

  const openConversation = useCallback(
    async (item: OutlookListItem) => {
      if (!accountId) return;
      setOpenConversationId(item.conversation_id);
      setLoadingConversation(true);
      setMoveOpen(false);
      try {
        const conv = await getOutlookConversation(accountId, item.conversation_id);
        setConversation(conv);
        const msgs = conv.messages;
        const open = new Set(msgs.filter((m) => m.is_unread).map((m) => m.message_id));
        if (msgs.length) open.add(msgs[msgs.length - 1].message_id);
        setExpandedMsgs(open);
        if (conv.is_unread) {
          // Opening marked them read in Outlook; mirror that here and refresh the counts.
          setItems((prev) => prev.map((i) => (i.conversation_id === item.conversation_id ? { ...i, is_unread: 0 } : i)));
          loadFolders(true);
        }
      } catch (err: any) {
        setConversation(null);
        addToast(err?.response?.data?.detail || 'Không mở được email', 'error');
      } finally {
        setLoadingConversation(false);
      }
    },
    [accountId, addToast, loadFolders]
  );

  const reloadConversation = async () => {
    if (!accountId || !conversation) return;
    try {
      setConversation(await getOutlookConversation(accountId, conversation.conversation_id, false));
    } catch {
      /* keep the old view */
    }
  };

  const toggleMsg = (id: string) =>
    setExpandedMsgs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The conversation's messages that live in the open folder (what Outlook moves / deletes together). */
  const messagesHere = (conv: OutlookConversation): string[] => {
    const here = conv.messages.filter((m) => m.folder_id === folderId).map((m) => m.message_id);
    return here.length ? here : [conv.latest_message_id];
  };

  const runAction = async (action: OutlookAction, destination?: FolderNode) => {
    if (!accountId || !conversation) return;
    const ids =
      action === 'read' || action === 'unread'
        ? conversation.messages.map((m) => m.message_id)
        : action === 'flag' || action === 'unflag'
          ? [conversation.latest_message_id]
          : messagesHere(conversation);
    setBusyAction(true);
    try {
      await runOutlookAction(accountId, ids, action, destination?.id || '');
      if (action === 'move' || action === 'archive' || action === 'delete') {
        const label = action === 'move' ? `Đã chuyển vào “${destination?.label}”` : action === 'archive' ? 'Đã lưu trữ' : 'Đã chuyển vào Đã xoá';
        addToast(label, 'success');
        setItems((prev) => prev.filter((i) => !ids.includes(i.message_id)));
        setConversation(null);
        setOpenConversationId('');
      } else {
        setItems((prev) =>
          prev.map((i) =>
            i.conversation_id !== conversation.conversation_id
              ? i
              : action === 'read' || action === 'unread'
                ? { ...i, is_unread: action === 'unread' ? 1 : 0 }
                : ids.includes(i.message_id)
                  ? { ...i, is_flagged: action === 'flag' ? 1 : 0 }
                  : i
          )
        );
        setConversation((c) =>
          c
            ? {
                ...c,
                is_unread: action === 'unread' ? 1 : action === 'read' ? 0 : c.is_unread,
                is_flagged: action === 'flag' ? 1 : action === 'unflag' ? 0 : c.is_flagged,
              }
            : c
        );
      }
      loadFolders(true);
    } catch (err: any) {
      addToast(err?.response?.data?.detail || 'Thao tác thất bại', 'error');
    } finally {
      setBusyAction(false);
      setMoveOpen(false);
    }
  };

  const handleImport = async (messageId: string, att: OutlookAttachment) => {
    if (!accountId) return;
    const key = `${messageId}|${att.id}`;
    setImportingKey(key);
    try {
      const res = await importOutlookAttachment(accountId, messageId, att.id, activeCollection?.id);
      addToast(res.message, res.status === 'duplicate' ? 'info' : 'success');
      await reloadConversation();
    } catch (err: any) {
      addToast(err?.response?.data?.detail || 'Không đọc được PDF vào Booking', 'error');
    } finally {
      setImportingKey('');
    }
  };

  const togglePin = async (f: OutlookFolder) => {
    if (!accountId) return;
    setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, pinned: !f.pinned } : x)));
    try {
      await setOutlookFolderPinned(accountId, f.id, !f.pinned);
    } catch {
      setFolders((prev) => prev.map((x) => (x.id === f.id ? { ...x, pinned: f.pinned } : x)));
      addToast('Không ghim được thư mục', 'error');
    }
  };

  const selectFolder = (f: OutlookFolder) => {
    setFolderId(f.id);
    setSearchAll(false);
    setConversation(null);
    setOpenConversationId('');
  };

  // ----- compose -----

  const openCompose = (mode: 'new' | 'reply' | 'forward') => {
    if (!account) return;
    if (mode === 'new' || !conversation) {
      setComposeDraft({ mode: 'new' });
    } else {
      const last = conversation.messages[conversation.messages.length - 1];
      const target = replyTarget(conversation.messages, account.email);
      setComposeDraft(
        mode === 'reply' && target
          ? { mode, to: target.to, subject: withPrefix(conversation.subject, 'RE'), replyToMessageId: target.messageId }
          : { mode: 'forward', to: '', subject: withPrefix(conversation.subject, 'FW'), replyToMessageId: last.message_id }
      );
    }
    setComposeOpen(true);
  };

  const sendFromCompose = async (p: ComposeSendPayload) => {
    if (!accountId) throw new Error('no account');
    const res = await sendOutlookMail(accountId, {
      mode: p.draft?.mode || 'new',
      to: p.to,
      cc: p.cc,
      bcc: p.bcc,
      subject: p.subject,
      body: p.body,
      replyToMessageId: p.draft?.replyToMessageId,
      files: p.files,
    });
    return { thread_id: res.conversation_id };
  };

  const attachmentUrl = useCallback(
    (messageId: string) => (att: MailAttachmentView) =>
      accountId ? getOutlookAttachmentUrl(accountId, messageId, String(att.id)) : '',
    [accountId]
  );

  // ----- render -----

  if (accountsLoaded && accounts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-7 text-center shadow-sm space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 dark:bg-sky-950/40 text-sky-600 flex items-center justify-center mx-auto">
            <Mail className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Outlook công ty ngay trong ứng dụng</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Kết nối tài khoản Microsoft 365 để xem thư theo từng thư mục khách (NESTLE, U1, TEKCOM…), tìm theo số booking,
              trả lời bằng mẫu và đọc PDF đính kèm vào Booking.
            </p>
          </div>
          {canSignIn ? (
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={signIn}
                disabled={signingIn}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                {signingIn ? 'Đang chờ đăng nhập trên trình duyệt...' : 'Đăng nhập bằng tài khoản Microsoft'}
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:underline cursor-pointer"
              >
                Cần IT duyệt? / Cài đặt nâng cao
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5" />
              Cấu hình & kết nối Outlook
            </button>
          )}
        </div>
        <OutlookSettingsModal
          open={settingsOpen}
          accounts={accounts}
          onClose={() => setSettingsOpen(false)}
          onAccountsChanged={loadAccounts}
        />
      </div>
    );
  }

  const searchingAll = Boolean(debouncedSearch && searchAll);
  const listTitle = searchingAll ? `Kết quả trong toàn hộp thư` : currentFolder ? folderLabel(currentFolder) : '';

  return (
    <div className="flex-1 flex overflow-hidden bg-white dark:bg-slate-900">
      {/* Left: account + folders */}
      <aside className="w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/60 dark:bg-slate-950/40">
        <div className="p-3 space-y-2.5">
          {accounts.length > 1 ? (
            <select
              value={accountId ?? ''}
              onChange={(e) => setAccountId(Number(e.target.value))}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.email}
                </option>
              ))}
            </select>
          ) : (
            <div className="px-1 text-xs font-semibold text-slate-700 dark:text-slate-300 truncate" title={account?.email}>
              {account?.email}
            </div>
          )}
          <button
            type="button"
            onClick={() => openCompose('new')}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold cursor-pointer"
          >
            <PenSquare className="w-3.5 h-3.5" />
            Soạn thư mới
          </button>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={folderFilter}
              onChange={(e) => setFolderFilter(e.target.value)}
              placeholder="Lọc thư mục khách..."
              className="w-full pl-8 pr-7 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {folderFilter && (
              <button
                type="button"
                onClick={() => setFolderFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
          {loadingFolders && folders.length === 0 && (
            <div className="px-2 py-4 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải thư mục...
            </div>
          )}
          {foldersError && (
            <div className="mx-1 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-[11px] text-rose-600 dark:text-rose-400 space-y-1.5">
              <p>{foldersError}</p>
              <button type="button" onClick={() => setSettingsOpen(true)} className="font-semibold underline cursor-pointer">
                Mở cài đặt / đăng nhập lại
              </button>
            </div>
          )}

          {visibleSystem.length > 0 && (
            <div>
              {visibleSystem.map((n) => (
                <FolderRow
                  key={n.id}
                  node={n}
                  activeId={searchingAll ? '' : folderId}
                  expanded={expandedFolders}
                  forceOpen={Boolean(folderFilter)}
                  onSelect={selectFolder}
                  onToggle={(id) => setExpandedFolders((p) => toggleIn(p, id))}
                  onPin={togglePin}
                />
              ))}
            </div>
          )}

          {pinnedFolders.length > 0 && !folderFilter && (
            <div>
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Ghim</div>
              {pinnedFolders.map((n) => (
                <FolderRow
                  key={`pin-${n.id}`}
                  node={{ ...n, depth: 0, children: [] }}
                  activeId={searchingAll ? '' : folderId}
                  expanded={expandedFolders}
                  forceOpen={false}
                  onSelect={selectFolder}
                  onToggle={() => {}}
                  onPin={togglePin}
                />
              ))}
            </div>
          )}

          {visibleCustom.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                Thư mục ({flattenFolderTree(tree.custom).length})
              </div>
              {visibleCustom.map((n) => (
                <FolderRow
                  key={n.id}
                  node={n}
                  activeId={searchingAll ? '' : folderId}
                  expanded={expandedFolders}
                  forceOpen={Boolean(folderFilter)}
                  onSelect={selectFolder}
                  onToggle={(id) => setExpandedFolders((p) => toggleIn(p, id))}
                  onPin={togglePin}
                />
              ))}
            </div>
          )}
          {folderFilter && visibleCustom.length === 0 && visibleSystem.length === 0 && (
            <p className="px-2 text-[11px] text-slate-400">Không có thư mục nào khớp “{folderFilter}”.</p>
          )}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              loadFolders();
              loadList();
            }}
            disabled={loadingFolders || loadingList}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingFolders || loadingList ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Cài đặt Outlook"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Middle: message list */}
      <section className="w-80 lg:w-96 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-2.5 border-b border-slate-200 dark:border-slate-800 space-y-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm số booking, người gửi, tiêu đề..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Chip active={onlyUnread} onClick={() => setOnlyUnread((v) => !v)}>
              Chưa đọc
            </Chip>
            <Chip active={onlyAttachments} onClick={() => setOnlyAttachments((v) => !v)}>
              <Paperclip className="w-3 h-3" /> Có đính kèm
            </Chip>
            {search.trim() && (
              <Chip active={searchAll} onClick={() => setSearchAll((v) => !v)}>
                Tìm cả hộp thư
              </Chip>
            )}
          </div>
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate">{listTitle}</span>
            {currentFolder && !searchingAll && (
              <span className="text-[10px] text-slate-400 shrink-0">
                {currentFolder.unread > 0 ? `${currentFolder.unread} chưa đọc · ` : ''}
                {currentFolder.total} thư
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80">
          {loadingList && items.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải thư...
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              {debouncedSearch ? 'Không tìm thấy email nào.' : 'Thư mục này chưa có email.'}
            </div>
          ) : (
            <>
              {items.map((m) => (
                <MessageRow
                  key={m.message_id}
                  item={m}
                  selected={m.conversation_id === openConversationId}
                  folderName={
                    searchingAll || folderId !== m.folder_id
                      ? folders.find((f) => f.id === m.folder_id)
                      : undefined
                  }
                  sentView={currentFolder?.well_known === 'sentitems'}
                  onOpen={() => openConversation(m)}
                />
              ))}
              {nextCursor && (
                <div className="p-3 text-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                  >
                    {loadingMore ? 'Đang tải...' : 'Tải thêm thư cũ hơn'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Right: conversation */}
      <section className="flex-1 flex flex-col overflow-hidden bg-slate-50/40 dark:bg-slate-950/30">
        {!conversation ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
            {loadingConversation ? <Loader2 className="w-6 h-6 animate-spin opacity-60" /> : <MailOpen className="w-8 h-8 opacity-40" />}
            <span>{loadingConversation ? 'Đang tải nội dung...' : 'Chọn một email để xem chi tiết'}</span>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate" title={conversation.subject}>
                {conversation.subject}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => openCompose('reply')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/40 cursor-pointer"
                >
                  <Reply className="w-3.5 h-3.5" /> Trả lời
                </button>
                <button
                  type="button"
                  onClick={() => openCompose('forward')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Forward className="w-3.5 h-3.5" /> Chuyển tiếp
                </button>
                <div className="relative">
                  <IconBtn title="Chuyển vào thư mục" disabled={busyAction} onClick={() => setMoveOpen((v) => !v)}>
                    <FolderInput className="w-3.5 h-3.5" />
                  </IconBtn>
                  {moveOpen && (
                    <MovePicker
                      tree={allTree}
                      currentId={folderId}
                      onPick={(f) => runAction('move', f)}
                      onClose={() => setMoveOpen(false)}
                    />
                  )}
                </div>
                <IconBtn
                  title={conversation.is_flagged ? 'Bỏ cờ' : 'Gắn cờ'}
                  disabled={busyAction}
                  onClick={() => runAction(conversation.is_flagged ? 'unflag' : 'flag')}
                >
                  <Flag className={`w-3.5 h-3.5 ${conversation.is_flagged ? 'text-rose-500 fill-rose-500' : ''}`} />
                </IconBtn>
                <IconBtn
                  title="Đánh dấu chưa đọc"
                  disabled={busyAction}
                  onClick={() => runAction('unread')}
                >
                  <Mail className="w-3.5 h-3.5" />
                </IconBtn>
                <IconBtn title="Lưu trữ" disabled={busyAction} onClick={() => runAction('archive')}>
                  <Archive className="w-3.5 h-3.5" />
                </IconBtn>
                <IconBtn title="Xoá (chuyển vào Đã xoá)" disabled={busyAction} danger onClick={() => runAction('delete')}>
                  <Trash2 className="w-3.5 h-3.5" />
                </IconBtn>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {conversation.messages.map((msg) => {
                const shown = visibleAttachments(msg.attachments, msg.body_html);
                return (
                  <GmailMessageCard
                    key={msg.message_id}
                    msg={msg}
                    expanded={expandedMsgs.has(msg.message_id)}
                    onToggle={() => toggleMsg(msg.message_id)}
                    attachmentUrl={attachmentUrl(msg.message_id)}
                    attachments={
                      shown.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {shown.map((att) => (
                            <AttachmentChip
                              key={att.id}
                              att={att}
                              href={accountId ? getOutlookAttachmentUrl(accountId, msg.message_id, att.id) : '#'}
                              importing={importingKey === `${msg.message_id}|${att.id}`}
                              onImport={() => handleImport(msg.message_id, att)}
                            />
                          ))}
                        </div>
                      ) : undefined
                    }
                  />
                );
              })}
            </div>
          </>
        )}
      </section>

      <OutlookSettingsModal
        open={settingsOpen}
        accounts={accounts}
        onClose={() => setSettingsOpen(false)}
        onAccountsChanged={loadAccounts}
      />

      <GmailComposeModal
        open={composeOpen}
        account={account}
        draft={composeDraft}
        onClose={() => setComposeOpen(false)}
        onSend={sendFromCompose}
        onSent={() => {
          loadList(true);
          loadFolders(true);
          reloadConversation();
        }}
      />
    </div>
  );
};

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// ---------- small pieces ----------

const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer ${
      active
        ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-950/40 dark:border-primary-700 dark:text-primary-300'
        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
    }`}
  >
    {children}
  </button>
);

const IconBtn: React.FC<{
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ title, onClick, disabled, danger, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer ${
      danger ? 'hover:text-rose-600' : 'hover:text-slate-700 dark:hover:text-slate-200'
    }`}
  >
    {children}
  </button>
);

const MessageRow: React.FC<{
  item: OutlookListItem;
  selected: boolean;
  folderName?: OutlookFolder;
  sentView: boolean;
  onOpen: () => void;
}> = ({ item, selected, folderName, sentView, onOpen }) => {
  const unread = Boolean(item.is_unread);
  const who = sentView ? `Đến: ${splitAddresses(item.to_addrs).map(shortName).join(', ')}` : shortName(item.from_addr);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`relative w-full text-left pl-4 pr-3 py-2.5 transition-colors cursor-pointer ${
        selected
          ? 'bg-primary-50 dark:bg-primary-950/50'
          : unread
            ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/70'
            : 'bg-slate-50/70 dark:bg-slate-950/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/50'
      }`}
    >
      {(selected || unread) && (
        <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${selected ? 'bg-primary-600' : 'bg-primary-500/80'}`} />
      )}
      <div className="flex items-center gap-2 mb-0.5">
        <span
          className={`text-xs truncate flex-1 ${unread ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-600 dark:text-slate-400'}`}
          title={item.from_addr}
        >
          {who || '(Không rõ người gửi)'}
        </span>
        <span
          className={`text-[10px] shrink-0 ${unread ? 'font-bold text-primary-600 dark:text-primary-400' : 'text-slate-400 dark:text-slate-500'}`}
        >
          {formatShortDate(item.internal_date_ms)}
        </span>
      </div>
      <div className={`text-xs truncate mb-0.5 ${unread ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>
        {item.is_important ? <span className="text-rose-500 font-bold mr-1">!</span> : null}
        {item.subject}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[11px] truncate flex-1 ${unread ? 'text-slate-600 dark:text-slate-400' : 'text-slate-400 dark:text-slate-500'}`}>
          {decodeEntities(item.snippet)}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {folderName && (
            <span className="px-1.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] text-slate-500 dark:text-slate-400 max-w-[90px] truncate">
              {folderLabel(folderName)}
            </span>
          )}
          {Boolean(item.is_flagged) && <Flag className="w-3 h-3 text-rose-500 fill-rose-500" />}
          {Boolean(item.has_attachments) && <Paperclip className="w-3 h-3 text-slate-400" />}
          {unread && <span className="w-2 h-2 rounded-full bg-primary-500" title="Chưa đọc" />}
        </div>
      </div>
    </button>
  );
};

const AttachmentChip: React.FC<{
  att: OutlookAttachment;
  href: string;
  importing: boolean;
  onImport: () => void;
}> = ({ att, href, importing, onImport }) => (
  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-xs">
    <FileText className={`w-4 h-4 ${att.is_pdf ? 'text-rose-500' : 'text-slate-400'}`} />
    <div className="min-w-0">
      <div className="font-medium text-slate-800 dark:text-slate-200 max-w-[220px] truncate" title={att.filename}>
        {att.filename}
      </div>
      <div className="text-[10px] text-slate-400">{formatBytes(att.size)}</div>
    </div>
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 hover:text-primary-600"
      title="Tải xuống / Xem"
    >
      <Download className="w-3.5 h-3.5" />
    </a>
    {Boolean(att.is_pdf) &&
      (att.imported_booking_no ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold">
          <CheckCircle2 className="w-3 h-3" /> Đã nhập: {att.imported_booking_no}
        </span>
      ) : (
        <button
          type="button"
          onClick={onImport}
          disabled={importing}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-[11px] font-semibold cursor-pointer"
        >
          <FileInput className="w-3 h-3" />
          {importing ? 'Đang đọc...' : 'Đọc vào Booking'}
        </button>
      ))}
  </div>
);

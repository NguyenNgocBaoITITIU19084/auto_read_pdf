const fs = require('fs');
const path = require('path');
const { Zalo, LoginQRCallbackEventType, ThreadType, CloseReason } = require('zca-js');

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSafeDelayMs() {
  return 1500 + Math.floor(Math.random() * 1500);
}

function formatTs(tsMs) {
  const num = Number(tsMs);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  try {
    const d = new Date(num);
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(d);
    return parts.replace('T', ' ');
  } catch {
    return undefined;
  }
}

function safeJsonParse(str) {
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isImageUrlOrExt(url, name = '') {
  const s = `${url} ${name}`.toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/.test(s);
}

function parseObjectPayload(obj, rawMsgType = '') {
  if (!obj || typeof obj !== 'object') return null;
  const params = safeJsonParse(obj.params) || (typeof obj.params === 'object' ? obj.params : null);
  const href = String(obj.hdUrl || obj.href || obj.url || params?.hdUrl || params?.href || '');
  const thumb = String(obj.thumb || params?.thumb || '');
  const title = String(obj.title || params?.fileName || params?.name || obj.fileName || '');
  const desc = String(obj.description || '');
  const mt = String(obj.type || rawMsgType || '').toLowerCase();

  if (href || thumb) {
    const looksLikeFile =
      mt.includes('file') ||
      (title && !isImageUrlOrExt(href, title) && (params?.fileSize || params?.checksum || /\.\w{2,5}$/.test(title)));
    if (looksLikeFile) {
      return {
        msgType: 'file',
        mediaUrl: href || thumb,
        content: title || desc || 'Tệp đính kèm',
      };
    }
    if (mt.includes('voice') || mt.includes('audio')) {
      return { msgType: 'file', mediaUrl: href || thumb, content: title || '[Tin nhắn thoại]' };
    }
    if (mt.includes('video')) {
      return { msgType: 'file', mediaUrl: href || thumb, content: title || '[Video]' };
    }
    const preferredImage =
      href && href.toLowerCase().split('?')[0].endsWith('.jxl') && thumb && !thumb.toLowerCase().split('?')[0].endsWith('.jxl')
        ? thumb
        : href || thumb;
    return {
      msgType: 'image',
      mediaUrl: preferredImage,
      content: title || desc || '',
    };
  }
  if (title || desc) {
    return { msgType: 'text', mediaUrl: '', content: [title, desc].filter(Boolean).join(' — ') };
  }
  return null;
}

function parseSyncedMessage(m) {
  let msgType = 'text';
  let content = typeof m.content === 'string' ? m.content : '';
  let mediaUrl = '';

  const attachs = Array.isArray(m.meta?.attachs) ? m.meta.attachs : Array.isArray(m.meta?.attachments) ? m.meta.attachments : [];
  if (attachs.length > 0) {
    const parsedAtt = parseObjectPayload(attachs[0], String(m.msgType || ''));
    if (parsedAtt) {
      msgType = parsedAtt.msgType;
      mediaUrl = parsedAtt.mediaUrl;
      if (!content || safeJsonParse(content)) {
        content = parsedAtt.content;
      }
    }
  }

  const jsonContent = safeJsonParse(content);
  if (jsonContent) {
    const parsedObj = parseObjectPayload(jsonContent, String(m.msgType || ''));
    if (parsedObj) {
      msgType = parsedObj.msgType;
      if (!mediaUrl) mediaUrl = parsedObj.mediaUrl;
      content = parsedObj.content;
    } else if (jsonContent.msg || jsonContent.text) {
      content = String(jsonContent.msg || jsonContent.text);
    } else if (jsonContent.callType !== undefined || jsonContent.duration !== undefined) {
      content = `[Cuộc gọi${jsonContent.duration ? ` • ${jsonContent.duration}s` : ''}]`;
    } else {
      content = String(jsonContent.title || jsonContent.description || '[Tin nhắn đa phương tiện]');
    }
  }

  if (!content && !mediaUrl) {
    content = '[Tin nhắn đa phương tiện]';
  }

  return { msgType, content, mediaUrl };
}

function parseIncomingMessage(msg) {
  const data = msg?.data || {};
  const isGroup = msg?.type === ThreadType.Group;
  const threadId = String(msg?.threadId || data.idTo || data.uidFrom || '');
  const senderId = String(data.uidFrom || threadId);
  const senderName = String(data.dName || '');
  const msgId = String(data.msgId || data.cliMsgId || '');

  let msgType = 'text';
  let content = '';
  let mediaUrl = '';

  if (typeof data.content === 'string') {
    const parsed = safeJsonParse(data.content);
    const objRes = parsed ? parseObjectPayload(parsed, data.msgType) : null;
    if (objRes) {
      msgType = objRes.msgType;
      content = objRes.content;
      mediaUrl = objRes.mediaUrl;
    } else {
      content = data.content;
    }
  } else if (data.content && typeof data.content === 'object') {
    const objRes = parseObjectPayload(data.content, data.msgType);
    if (objRes) {
      msgType = objRes.msgType;
      content = objRes.content;
      mediaUrl = objRes.mediaUrl;
    } else {
      msgType = 'other';
      content = String(data.content.title || data.content.description || '');
    }
  }

  return {
    thread_id: threadId,
    msg_id: msgId || undefined,
    thread_type: isGroup ? 'group' : 'user',
    display_name: isGroup ? '' : senderName,
    sender_id: senderId,
    sender_name: senderName,
    msg_type: msgType,
    content,
    media_url: mediaUrl,
    created_at: formatTs(data.ts),
  };
}

function createZaloBridge({ userDataDir, backendRequest, sendToRenderer, showMainWindow, isAppFocused, Notification, log }) {
  const sessionFile = path.join(userDataDir, 'zalo-session.json');
  let api = null;
  let listenerConnected = false;
  // start() on a zca-js listener throws "Already started" while its socket exists, so track it ourselves.
  let listenerStarted = false;
  // One restore/login at a time: a backend restart re-fires `ready`, and a second login on the same
  // credentials kicks the first one (DuplicateConnection).
  let connectPromise = null;
  let state = {
    status: 'disconnected', // 'disconnected' | 'qr_pending' | 'connected' | 'error'
    uid: '',
    displayName: '',
    phone: '',
    avatar: '',
    lastError: '',
  };

  async function syncSessionToBackend() {
    try {
      await backendRequest('POST', '/api/v1/zalo/session', {
        uid: state.uid,
        display_name: state.displayName,
        phone: state.phone,
        avatar: state.avatar,
        status: state.status,
        last_error: state.lastError,
      });
    } catch (e) {
      log(`Failed to sync session to backend: ${e.message}`);
    }
  }

  function getState() {
    return { ...state, hasSavedSession: !!readSavedCredentials() };
  }

  function emitState(extra = {}) {
    sendToRenderer('zalo-status', { ...getState(), ...extra });
  }

  function readSavedCredentials() {
    try {
      if (!fs.existsSync(sessionFile)) return null;
      const raw = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
      if (raw && raw.cookie && raw.imei && raw.userAgent) return raw;
    } catch (e) {
      log(`Could not read saved session: ${e.message}`);
    }
    return null;
  }

  function saveCredentials(creds) {
    try {
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify(creds, null, 2), 'utf8');
    } catch (e) {
      log(`Could not save session: ${e.message}`);
    }
  }

  function clearCredentials() {
    try {
      if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);
    } catch (e) {}
  }

  // Detach the current api first, then close its socket: the `closed` event of a stopped api then sees
  // it is no longer current and is ignored instead of being reported as a lost connection.
  function stopListener() {
    const old = api;
    api = null;
    listenerConnected = false;
    listenerStarted = false;
    try {
      if (old?.listener) old.listener.stop();
    } catch (e) {}
  }

  function startListener(target) {
    if (listenerStarted) return;
    listenerStarted = true;
    try {
      target.listener.start({ retryOnClose: false });
    } catch (e) {
      listenerStarted = false;
      throw e;
    }
  }

  async function attachConnectedApi(connectedApi, { autoSyncMessages = false } = {}) {
    if (api && api !== connectedApi) stopListener();
    api = connectedApi;
    const isCurrent = () => api === connectedApi;
    let uid = '';
    let displayName = '';
    let avatar = '';
    let phone = '';

    try {
      uid = String(api.getOwnId?.() || '');
      const info = await api.fetchAccountInfo?.();
      const profile = info?.profile || info || {};
      displayName = String(profile.displayName || profile.zaloName || '');
      avatar = String(profile.avatar || '');
      phone = String(profile.phoneNumber || '');
      if (!uid && profile.userId) uid = String(profile.userId);
    } catch (e) {
      log(`fetchAccountInfo warning: ${e.message}`);
    }

    state = {
      status: 'connected',
      uid,
      displayName,
      phone,
      avatar,
      lastError: '',
    };
    await syncSessionToBackend();
    emitState();

    const listener = connectedApi.listener;

    listener.on('connected', () => {
      if (!isCurrent()) return;
      listenerConnected = true;
      log('Zalo listener connected');
    });

    listener.on('old_messages', async (messages) => {
      if (!isCurrent()) return;
      if (!Array.isArray(messages) || messages.length === 0) return;
      let anyNew = false;
      for (const msg of messages) {
        try {
          const parsed = parseIncomingMessage(msg);
          if (!parsed.thread_id) continue;
          parsed.is_history = true;
          const endpoint = msg.isSelf ? '/api/v1/zalo/messages/outgoing' : '/api/v1/zalo/messages/incoming';
          const res = await backendRequest('POST', endpoint, parsed);
          if (res && !res.duplicate) anyNew = true;
        } catch (e) {
          // skip malformed history entry
        }
      }
      if (anyNew) {
        sendToRenderer('zalo-message-received', { history: true });
      }
    });

    listener.on('message', async (msg) => {
      if (!isCurrent()) return;
      try {
        const parsed = parseIncomingMessage(msg);
        if (!parsed.thread_id) return;
        const endpoint = msg.isSelf ? '/api/v1/zalo/messages/outgoing' : '/api/v1/zalo/messages/incoming';
        const res = await backendRequest('POST', endpoint, parsed);
        if (res && !res.duplicate) {
          sendToRenderer('zalo-message-received', res);
          const conv = res.conversation;
          if (!msg.isSelf && conv && conv.driver_id && !isAppFocused() && Notification?.isSupported?.()) {
            const title = `Zalo tài xế: ${conv.driver_name || conv.display_name}`;
            const body = parsed.content || (parsed.msg_type === 'image' ? 'Đã gửi một hình ảnh' : 'Tin nhắn mới');
            const n = new Notification({ title, body });
            n.on('click', () => {
              showMainWindow();
              sendToRenderer('zalo-open-thread', { threadId: parsed.thread_id });
            });
            n.show();
          }
        }
      } catch (e) {
        log(`Incoming message error: ${e.message}`);
      }
    });

    // retryOnClose is off (no reconnect loop), so any close of the current socket means messages stop
    // arriving: say so instead of keeping the "connected" badge. Reconnecting is left to the user.
    listener.on('closed', async (code, reason) => {
      if (!isCurrent()) return;
      log(`Zalo listener closed (${code}): ${reason || ''}`);
      api = null;
      listenerConnected = false;
      listenerStarted = false;
      const kicked = code === CloseReason.DuplicateConnection || code === CloseReason.KickConnection;
      state = {
        ...state,
        status: 'disconnected',
        lastError: kicked
          ? 'Phiên Zalo bị ngắt do đăng nhập ở nơi khác. Bấm "Kết nối lại" hoặc quét lại QR.'
          : `Mất kết nối Zalo (mã ${code}). Bấm "Kết nối lại" để nhận tin tiếp.`,
      };
      await syncSessionToBackend();
      emitState();
    });

    listener.on('error', (err) => {
      if (!isCurrent()) return;
      log(`Zalo listener error: ${err?.message || err}`);
    });

    startListener(connectedApi);

    // Run post-login sync strictly sequentially: wait listener -> syncContacts -> syncMessagesFromPhone
    (async () => {
      try {
        await ensureListenerConnected();
        sendToRenderer('zalo-sync-progress', { stage: 'syncing_contacts', message: 'Đang đồng bộ danh bạ & nhóm Zalo...' });
        const contactRes = await syncContacts();
        sendToRenderer('zalo-sync-progress', {
          stage: 'contacts_done',
          message: `Đã đồng bộ ${contactRes?.synced || 0} bạn bè & nhóm.`,
        });
        if (autoSyncMessages) {
          await syncMessagesFromPhone();
        } else {
          sendToRenderer('zalo-sync-progress', { stage: 'done', message: 'Hoàn tất kết nối.' });
        }
      } catch (e) {
        log(`Sequential post-login sync warning: ${e.message}`);
        sendToRenderer('zalo-sync-progress', { stage: 'error', message: e?.message || 'Lỗi đồng bộ dữ liệu' });
      }
    })();
  }

  async function syncContacts() {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    const items = [];
    try {
      const friends = await api.getAllFriends?.();
      if (Array.isArray(friends)) {
        for (const f of friends) {
          if (!f?.userId) continue;
          items.push({
            thread_id: String(f.userId),
            thread_type: 'user',
            display_name: String(f.displayName || f.zaloName || f.username || f.userId),
            avatar: String(f.avatar || ''),
            phone: String(f.phoneNumber || ''),
          });
        }
      }
    } catch (e) {
      log(`getAllFriends warning: ${e.message}`);
    }

    try {
      const groupsRes = await api.getAllGroups?.();
      const groupIds = Object.keys(groupsRes?.gridVerMap || {});
      if (groupIds.length > 0 && api.getGroupInfo) {
        for (let i = 0; i < groupIds.length; i += 40) {
          const chunk = groupIds.slice(i, i + 40);
          const infoRes = await api.getGroupInfo(chunk);
          const map = infoRes?.gridInfoMap || {};
          for (const gid of chunk) {
            const g = map[gid];
            items.push({
              thread_id: String(gid),
              thread_type: 'group',
              display_name: String(g?.name || `Nhóm ${gid}`),
              avatar: String(g?.avt || g?.fullAvt || ''),
              phone: '',
            });
          }
        }
      }
    } catch (e) {
      log(`getAllGroups warning: ${e.message}`);
    }

    if (items.length > 0) {
      await backendRequest('POST', '/api/v1/zalo/conversations/batch', items);
      sendToRenderer('zalo-message-received', { synced: items.length });
    }
    return { synced: items.length };
  }

  async function ensureListenerConnected() {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    if (listenerConnected) return;
    const target = api;
    await new Promise((resolve, reject) => {
      const onConn = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        target.listener.removeListener('connected', onConn);
        reject(new Error('Không thể kết nối WebSocket Zalo (timeout)'));
      }, 15000);
      target.listener.once('connected', onConn);
      // attachConnectedApi already started the socket; only start it here if nothing has.
      if (!listenerStarted) {
        try {
          startListener(target);
        } catch (e) {
          clearTimeout(timer);
          target.listener.removeListener('connected', onConn);
          reject(e);
        }
      }
    });
  }

  // `days` widens the window past zca-js's default (14 days) to pull older history from the phone.
  async function syncMessagesFromPhone({ days } = {}) {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    if (typeof api.syncMessages !== 'function') {
      throw new Error('Phiên bản zca-js hiện tại không hỗ trợ đồng bộ từ điện thoại');
    }

    try {
      await ensureListenerConnected();
      const ownId = String(api.getOwnId?.() || state.uid || '');
      sendToRenderer('zalo-sync-progress', { stage: 'waiting_phone', message: 'Vui lòng mở Zalo trên điện thoại và bấm Xác nhận đồng bộ...' });

      const res = await api.syncMessages({
        deviceName: 'Auto Read PDF Pro',
        messages: true,
        ...(Number(days) > 0 ? { from: Date.now() - Math.min(Number(days), 365) * 86400000 } : {}),
        confirmTimeout: 120000,
        batchTimeout: 60000,
        onProgress: (p) => {
          if (p.type === 'device_status') {
            sendToRenderer('zalo-sync-progress', {
              stage: 'waiting_phone',
              message: `Trạng thái điện thoại: ${p.status} — vui lòng mở Zalo trên điện thoại để xác nhận.`,
            });
          } else if (p.type === 'conversations') {
            sendToRenderer('zalo-sync-progress', {
              stage: 'syncing',
              message: `Đang nhận ${p.total} cuộc hội thoại từ điện thoại...`,
            });
          } else if (p.type === 'messages') {
            sendToRenderer('zalo-sync-progress', {
              stage: 'syncing',
              message: `Đang đồng bộ ${p.conversations}/${p.totalConversations} hội thoại (${p.messages} tin nhắn)...`,
            });
          }
        },
      });

      const batch = [];
      const userThreadsToResolve = new Set();
      for (const conv of res?.conversations || []) {
        const tid = String(conv?.threadId || '');
        if (!tid) continue;
        const tType = conv.type === ThreadType.Group ? 'group' : 'user';
        if (tType === 'user') userThreadsToResolve.add(tid);
        for (const m of conv.messages || []) {
          const msgId = m.msgId && m.msgId !== '0' ? String(m.msgId) : String(m.cliMsgId || '');
          const uidFrom = String(m.uidFrom || '');
          const isSelf = !!ownId && uidFrom === ownId;
          const parsed = parseSyncedMessage(m);
          batch.push({
            thread_id: tid,
            msg_id: msgId || undefined,
            thread_type: tType,
            direction: isSelf ? 'out' : 'in',
            sender_id: uidFrom,
            sender_name: '',
            msg_type: parsed.msgType,
            content: parsed.content,
            media_url: parsed.mediaUrl,
            created_at: formatTs(m.ts),
          });
        }
      }

      let inserted = 0;
      for (let i = 0; i < batch.length; i += 250) {
        const chunk = batch.slice(i, i + 250);
        const r = await backendRequest('POST', '/api/v1/zalo/messages/batch', chunk);
        inserted += Number(r?.inserted || 0);
      }

      // Resolve display names & avatars for non-friend user threads
      if (userThreadsToResolve.size > 0 && typeof api.getUserInfo === 'function') {
        const uids = [...userThreadsToResolve];
        const profileUpdates = [];
        for (let i = 0; i < uids.length; i += 30) {
          try {
            const infoRes = await api.getUserInfo(uids.slice(i, i + 30));
            const profiles = infoRes?.changed_profiles || {};
            for (const [uid, p] of Object.entries(profiles)) {
              if (!p) continue;
              profileUpdates.push({
                thread_id: String(uid),
                thread_type: 'user',
                display_name: String(p.displayName || p.zaloName || ''),
                avatar: String(p.avatar || ''),
                phone: String(p.phoneNumber || ''),
              });
            }
          } catch {}
        }
        if (profileUpdates.length > 0) {
          await backendRequest('POST', '/api/v1/zalo/conversations/batch', profileUpdates).catch(() => {});
        }
      }

      sendToRenderer('zalo-sync-progress', { stage: 'done', message: `Đã đồng bộ ${inserted} tin nhắn mới.` });
      sendToRenderer('zalo-message-received', { history: true });
      return { conversations: (res?.conversations || []).length, inserted };
    } catch (e) {
      const errMsg = e?.message || String(e);
      log(`syncMessagesFromPhone error: ${errMsg}`);
      sendToRenderer('zalo-sync-progress', { stage: 'error', message: `Lỗi đồng bộ: ${errMsg}` });
      throw new Error(errMsg);
    }
  }

  async function fetchGroupHistory(groupId) {
    if (!api || !groupId) return { inserted: 0 };
    if (typeof api.getGroupChatHistory !== 'function') return { inserted: 0 };
    const ownId = String(api.getOwnId?.() || state.uid || '');
    const res = await api.getGroupChatHistory(String(groupId), 40);
    const batch = [];
    for (const m of res?.groupMsgs || []) {
      const data = m?.data || m || {};
      const msgId = String(data.msgId || data.cliMsgId || '');
      const uidFrom = String(data.uidFrom || '');
      const isSelf = !!ownId && uidFrom === ownId;
      let content = '';
      let msgType = 'text';
      let mediaUrl = '';
      if (typeof data.content === 'string') {
        content = data.content;
      } else if (data.content && typeof data.content === 'object') {
        if (data.content.href || data.content.thumb || data.content.hdUrl) {
          msgType = 'image';
          mediaUrl = String(data.content.hdUrl || data.content.href || data.content.thumb || '');
          content = String(data.content.title || data.content.description || '');
        }
      }
      batch.push({
        thread_id: String(groupId),
        msg_id: msgId || undefined,
        thread_type: 'group',
        direction: isSelf ? 'out' : 'in',
        sender_id: uidFrom,
        sender_name: String(data.dName || ''),
        msg_type: msgType,
        content,
        media_url: mediaUrl,
        created_at: formatTs(data.ts),
      });
    }
    if (batch.length === 0) return { inserted: 0 };
    const r = await backendRequest('POST', '/api/v1/zalo/messages/batch', batch);
    return { inserted: Number(r?.inserted || 0) };
  }

  async function restoreSession() {
    if (api) return getState();
    if (connectPromise) return connectPromise;
    const creds = readSavedCredentials();
    if (!creds) return getState();
    connectPromise = (async () => {
      try {
        const zalo = new Zalo({ selfListen: true, checkUpdate: false });
        const restoredApi = await zalo.login(creds);
        await attachConnectedApi(restoredApi);
        log('Restored Zalo session successfully');
      } catch (e) {
        log(`Saved Zalo session expired or invalid: ${e.message}`);
        state = {
          status: 'disconnected',
          uid: '',
          displayName: '',
          phone: '',
          avatar: '',
          lastError: 'Phiên đăng nhập Zalo đã hết hạn, vui lòng quét mã QR.',
        };
        await syncSessionToBackend();
        emitState();
      }
      return getState();
    })().finally(() => {
      connectPromise = null;
    });
    return connectPromise;
  }

  async function loginQR() {
    // A restore still running (app start, backend restart) may connect on its own: wait for it rather
    // than racing it with a second login.
    if (connectPromise) await connectPromise.catch(() => {});
    if (api) return getState();
    stopListener();
    state = { ...state, status: 'qr_pending', lastError: '' };
    emitState();

    try {
      const zalo = new Zalo({ selfListen: true, checkUpdate: false });
      let capturedCreds = null;
      const loggedInApi = await zalo.loginQR(
        { userAgent: DEFAULT_USER_AGENT, language: 'vi' },
        (event) => {
          if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
            sendToRenderer('zalo-qr', {
              stage: 'generated',
              image: `data:image/png;base64,${event.data.image}`,
            });
          } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
            sendToRenderer('zalo-qr', {
              stage: 'scanned',
              displayName: event.data?.display_name || '',
              avatar: event.data?.avatar || '',
            });
          } else if (event.type === LoginQRCallbackEventType.QRCodeExpired) {
            sendToRenderer('zalo-qr', { stage: 'expired' });
          } else if (event.type === LoginQRCallbackEventType.QRCodeDeclined) {
            sendToRenderer('zalo-qr', { stage: 'declined' });
          } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
            capturedCreds = event.data;
          }
        }
      );

      if (capturedCreds) {
        saveCredentials(capturedCreds);
      } else {
        const cookie = await loggedInApi.getCookie?.();
        const ctx = loggedInApi.getContext?.();
        if (cookie && ctx?.imei) {
          saveCredentials({
            cookie: typeof cookie.toJSON === 'function' ? cookie.toJSON().cookies : cookie,
            imei: ctx.imei,
            userAgent: ctx.userAgent || DEFAULT_USER_AGENT,
          });
        }
      }

      await attachConnectedApi(loggedInApi, { autoSyncMessages: true });
      return getState();
    } catch (e) {
      log(`Zalo QR login failed: ${e.message}`);
      state = { ...state, status: 'error', lastError: e.message || 'Đăng nhập QR thất bại' };
      await syncSessionToBackend();
      emitState();
      throw e;
    }
  }

  async function logout() {
    try {
      if (api?.logout) await api.logout().catch(() => {});
    } finally {
      stopListener();
      clearCredentials();
      state = { status: 'disconnected', uid: '', displayName: '', phone: '', avatar: '', lastError: '' };
      try {
        await backendRequest('POST', '/api/v1/zalo/logout', {});
      } catch (e) {
        await syncSessionToBackend();
      }
      emitState();
    }
    return getState();
  }

  async function sendMessage({ threadId, threadType = 'user', text, bookingNo = '', displayName = '', phone = '' }) {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('Nội dung tin nhắn trống');

    const zType = threadType === 'group' ? ThreadType.Group : ThreadType.User;
    const res = await api.sendMessage(cleanText, String(threadId), zType);
    const msgId = res?.message?.msgId ? String(res.message.msgId) : `local_${Date.now()}`;

    const recorded = await backendRequest('POST', '/api/v1/zalo/messages/outgoing', {
      thread_id: String(threadId),
      msg_id: msgId,
      thread_type: threadType,
      display_name: displayName,
      phone,
      msg_type: 'text',
      content: cleanText,
      booking_no: bookingNo || '',
      status: 'sent',
    });
    sendToRenderer('zalo-message-received', recorded);
    return recorded;
  }

  async function sendBatch({ recipients = [], text, bookingNo = '' }) {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    const results = [];
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      if (i > 0) {
        await sleep(randomSafeDelayMs());
      }
      try {
        const res = await sendMessage({
          threadId: r.threadId,
          threadType: r.threadType || 'user',
          text,
          bookingNo,
          displayName: r.displayName || '',
          phone: r.phone || '',
        });
        results.push({ threadId: r.threadId, ok: true, data: res });
      } catch (e) {
        results.push({ threadId: r.threadId, ok: false, error: e.message });
      }
    }
    return results;
  }

  async function findUserByPhone({ phone, driverId = null, driverName = '' }) {
    if (!api) throw new Error('Chưa kết nối tài khoản Zalo');
    const cleanPhone = String(phone || '').trim();
    if (!cleanPhone) throw new Error('Số điện thoại trống');
    const user = await api.findUser(cleanPhone);
    if (!user || !user.uid) throw new Error(`Không tìm thấy Zalo cho SĐT ${cleanPhone}`);

    const conv = await backendRequest('POST', '/api/v1/zalo/conversations', {
      thread_id: String(user.uid),
      thread_type: 'user',
      display_name: String(user.display_name || user.zalo_name || driverName || cleanPhone),
      avatar: String(user.avatar || ''),
      phone: cleanPhone,
      driver_id: driverId,
    });
    return conv;
  }

  return {
    getState,
    restoreSession,
    loginQR,
    logout,
    sendMessage,
    sendBatch,
    findUserByPhone,
    syncContacts,
    syncMessagesFromPhone,
    fetchGroupHistory,
    stop: stopListener,
  };
}

module.exports = { createZaloBridge };

"""HTML page served at GET / on the mobile LAN app.

Single self-contained document (no external assets, no build step): camera
capture via a plain file input, client-side image normalization, sequential
upload with progress via XMLHttpRequest, and status polling. See
``.superpowers/sdd/task-5-brief.md`` for the product requirements this
implements.
"""

from __future__ import annotations

_HTML = r"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Auto Read PDF - Mobile</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f7;
    --fg: #1c1c1e;
    --muted: #6b6b70;
    --card: #ffffff;
    --border: #e0e0e3;
    --accent: #0a7cff;
    --accent-fg: #ffffff;
    --ok: #1a9e4c;
    --err: #d9362e;
    --warn: #b8860b;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #121214;
      --fg: #f2f2f4;
      --muted: #9a9aa0;
      --card: #1e1e21;
      --border: #333336;
      --accent: #3d9dff;
      --accent-fg: #06131f;
      --ok: #3cd873;
      --err: #ff6b61;
      --warn: #e0b23a;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 16px;
    padding-bottom: 48px;
    max-width: 480px;
    margin: 0 auto;
    min-height: 100vh;
  }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 12px; }
  .statusbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    font-size: 0.95rem;
    margin-bottom: 16px;
  }
  .statusbar .dot { font-size: 0.7rem; }
  .statusbar.connected .dot { color: var(--ok); }
  .statusbar.disconnected .dot { color: var(--warn); }
  .statusbar.expired .dot { color: var(--err); }
  .btn {
    display: block;
    width: 100%;
    border: none;
    border-radius: 14px;
    padding: 18px 16px;
    font-size: 1.05rem;
    font-weight: 600;
    text-align: center;
    cursor: pointer;
    margin-bottom: 12px;
    min-height: 56px;
  }
  .btn-primary { background: var(--accent); color: var(--accent-fg); }
  .btn-secondary {
    background: var(--card);
    color: var(--fg);
    border: 1px solid var(--border);
  }
  .hint {
    color: var(--muted);
    font-size: 0.85rem;
    text-align: center;
    margin: 0 0 20px;
  }
  .hidden-input { display: none; }
  h2 {
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--muted);
    margin: 24px 0 8px;
  }
  .photo-list { display: flex; flex-direction: column; gap: 8px; }
  .photo-item {
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 8px 12px;
  }
  .photo-item img {
    width: 52px;
    height: 52px;
    object-fit: cover;
    border-radius: 8px;
    background: var(--border);
    flex-shrink: 0;
  }
  .photo-info { flex: 1; min-width: 0; }
  .photo-state { font-size: 0.85rem; color: var(--muted); }
  .photo-state.ok { color: var(--ok); }
  .photo-state.err { color: var(--err); }
  .progress-track {
    height: 4px;
    background: var(--border);
    border-radius: 2px;
    margin-top: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    width: 0%;
    transition: width 0.15s ease-out;
  }
  .retry-btn {
    border: 1px solid var(--err);
    color: var(--err);
    background: transparent;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.85rem;
    cursor: pointer;
    flex-shrink: 0;
  }
  .empty {
    color: var(--muted);
    font-size: 0.9rem;
    text-align: center;
    padding: 16px 0;
  }
</style>
</head>
<body>
  <h1 id="title">Auto Read PDF</h1>
  <div class="statusbar disconnected" id="statusbar">
    <span class="dot">●</span>
    <span id="statusText">...</span>
  </div>

  <button type="button" class="btn btn-primary" id="captureBtn">📷 <span id="captureLabel"></span></button>
  <input type="file" accept="image/*" capture="environment" class="hidden-input" id="captureInput">

  <button type="button" class="btn btn-secondary" id="pickBtn">🖼 <span id="pickLabel"></span></button>
  <input type="file" accept="image/*" multiple class="hidden-input" id="pickInput">

  <p class="hint" id="hintText"></p>

  <h2 id="listTitle"></h2>
  <div class="photo-list" id="photoList"></div>
  <p class="empty" id="emptyText"></p>

<script>
(function () {
  "use strict";

  // -- i18n ------------------------------------------------------------
  var STRINGS = {
    vi: {
      title: "Auto Read PDF",
      captureLabel: "Chụp ảnh booking",
      pickLabel: "Chọn ảnh có sẵn",
      hint: "Chụp thẳng, đủ sáng, thấy rõ toàn bộ booking",
      listTitle: "Ảnh đã gửi",
      empty: "Chưa có ảnh nào được gửi",
      connected: "● Đã kết nối với máy tính",
      disconnected: "Mất kết nối – đang thử lại",
      expired: "Phiên đã hết hạn – quét lại mã QR trên máy tính",
      pairInvalid: "Mã QR đã được dùng hoặc hết hạn, hãy quét mã mới",
      uploading: "Đang gửi",
      sent: "Đã gửi",
      received: "Máy tính đã nhận ✓",
      failed: "Lỗi",
      retry: "Thử lại"
    },
    en: {
      title: "Auto Read PDF",
      captureLabel: "Take booking photo",
      pickLabel: "Choose existing photo",
      hint: "Shoot straight, good light, whole booking visible",
      listTitle: "Sent photos",
      empty: "No photos sent yet",
      connected: "● Connected to computer",
      disconnected: "Disconnected – retrying",
      expired: "Session expired – scan a new QR code on the computer",
      pairInvalid: "QR code already used or expired, please scan a new one",
      uploading: "Uploading",
      sent: "Sent",
      received: "Received by computer ✓",
      failed: "Failed",
      retry: "Retry"
    }
  };
  var lang = (navigator.language || "vi").toLowerCase().indexOf("vi") === 0 ? "vi" : "en";
  var t = STRINGS[lang];
  document.documentElement.lang = lang;

  document.getElementById("title").textContent = t.title;
  document.getElementById("captureLabel").textContent = t.captureLabel;
  document.getElementById("pickLabel").textContent = t.pickLabel;
  document.getElementById("hintText").textContent = t.hint;
  document.getElementById("listTitle").textContent = t.listTitle;
  document.getElementById("emptyText").textContent = t.empty;

  var statusbarEl = document.getElementById("statusbar");
  var statusTextEl = document.getElementById("statusText");

  function setStatus(kind, text) {
    statusbarEl.className = "statusbar " + kind;
    statusTextEl.textContent = text;
  }
  setStatus("disconnected", t.disconnected);

  // -- 1. Extract + immediately strip the pairing token from the hash --
  // This must run before anything else touches location.hash so the token
  // never lingers in browser history / can't be leaked by another script.
  var pairingToken = null;
  (function stripHashToken() {
    var hash = window.location.hash || "";
    if (hash.length > 1) {
      var params = new URLSearchParams(hash.slice(1));
      var p = params.get("p");
      if (p) {
        pairingToken = p;
      }
    }
    if (hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  })();

  var STORAGE_KEY = "device_token";

  function getDeviceToken() {
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }
  function setDeviceToken(token) {
    try {
      sessionStorage.setItem(STORAGE_KEY, token);
    } catch (e) {
      /* private mode / storage disabled: fall back to in-memory only */
    }
  }
  function clearDeviceToken() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
  }

  var deviceToken = getDeviceToken();

  function ensurePaired(callback) {
    if (deviceToken) {
      callback(null);
      return;
    }
    if (!pairingToken) {
      callback(new Error("no_pairing_token"));
      return;
    }
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/pair");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = function () {
      if (xhr.status === 200) {
        try {
          var resp = JSON.parse(xhr.responseText);
          deviceToken = resp.device_token;
          setDeviceToken(deviceToken);
          callback(null);
        } catch (e) {
          callback(e);
        }
      } else if (xhr.status === 401) {
        setStatus("expired", t.pairInvalid);
        callback(new Error("pair_invalid"));
      } else {
        callback(new Error("pair_failed:" + xhr.status));
      }
    };
    xhr.onerror = function () {
      callback(new Error("network_error"));
    };
    xhr.send(JSON.stringify({ pairing_token: pairingToken }));
  }

  // -- 3. Client-side image normalization --------------------------------
  var MAX_EDGE = 2400;
  var JPEG_QUALITY = 0.85;

  function normalizeImage(file) {
    return createBitmapNormalized(file).catch(function () {
      return imgElementNormalized(file);
    });
  }

  function drawToCanvasBlob(width, height, drawFn) {
    var scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    var outW = Math.max(1, Math.round(width * scale));
    var outH = Math.max(1, Math.round(height * scale));
    var canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    var ctx = canvas.getContext("2d");
    drawFn(ctx, outW, outH);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (blob) {
          if (blob) resolve(blob);
          else reject(new Error("toBlob_failed"));
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    });
  }

  function createBitmapNormalized(file) {
    if (typeof createImageBitmap !== "function") {
      return Promise.reject(new Error("createImageBitmap_unsupported"));
    }
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bitmap) {
      return drawToCanvasBlob(bitmap.width, bitmap.height, function (ctx, w, h) {
        ctx.drawImage(bitmap, 0, 0, w, h);
        if (bitmap.close) bitmap.close();
      });
    });
  }

  function imgElementNormalized(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        drawToCanvasBlob(img.naturalWidth, img.naturalHeight, function (ctx, w, h) {
          ctx.drawImage(img, 0, 0, w, h);
        })
          .then(function (blob) {
            URL.revokeObjectURL(url);
            resolve(blob);
          })
          .catch(function (e) {
            URL.revokeObjectURL(url);
            reject(e);
          });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("img_load_failed"));
      };
      img.src = url;
    });
  }

  // -- upload queue (sequential, XHR for progress, retry on network/5xx --
  var MAX_AUTO_RETRIES = 2;
  var queue = [];
  var uploading = false;

  function renderList() {
    var listEl = document.getElementById("photoList");
    var emptyEl = document.getElementById("emptyText");
    listEl.innerHTML = "";
    if (queue.length === 0) {
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";
    queue.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "photo-item";

      var thumb = document.createElement("img");
      if (item.thumbUrl) thumb.src = item.thumbUrl;
      row.appendChild(thumb);

      var info = document.createElement("div");
      info.className = "photo-info";

      var stateEl = document.createElement("div");
      var stateCls = "photo-state";
      var stateText = "";
      if (item.state === "uploading") {
        stateText = t.uploading + " " + item.progress + "%";
      } else if (item.state === "sent") {
        stateText = t.sent;
      } else if (item.state === "received") {
        stateText = t.received;
        stateCls += " ok";
      } else if (item.state === "failed") {
        stateText = t.failed;
        stateCls += " err";
      }
      stateEl.className = stateCls;
      stateEl.textContent = stateText;
      info.appendChild(stateEl);

      if (item.state === "uploading") {
        var track = document.createElement("div");
        track.className = "progress-track";
        var fill = document.createElement("div");
        fill.className = "progress-fill";
        fill.style.width = item.progress + "%";
        track.appendChild(fill);
        info.appendChild(track);
      }

      row.appendChild(info);

      if (item.state === "failed") {
        var retryBtn = document.createElement("button");
        retryBtn.type = "button";
        retryBtn.className = "retry-btn";
        retryBtn.textContent = t.retry;
        retryBtn.addEventListener("click", function () {
          item.retries = 0;
          item.state = "queued";
          renderList();
          pumpQueue();
        });
        row.appendChild(retryBtn);
      }

      listEl.appendChild(row);
    });
  }

  function pumpQueue() {
    if (uploading) return;
    var next = queue.find(function (i) {
      return i.state === "queued";
    });
    if (!next) return;
    uploading = true;
    next.state = "uploading";
    next.progress = 0;
    renderList();
    uploadOne(next);
  }

  function uploadOne(item) {
    ensurePaired(function (err) {
      if (err) {
        item.state = "failed";
        uploading = false;
        renderList();
        return;
      }
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/photos");
      xhr.setRequestHeader("X-Device-Token", deviceToken);
      xhr.upload.onprogress = function (evt) {
        if (evt.lengthComputable) {
          item.progress = Math.round((evt.loaded / evt.total) * 100);
          renderList();
        }
      };
      xhr.onload = function () {
        uploading = false;
        if (xhr.status === 201) {
          try {
            var resp = JSON.parse(xhr.responseText);
            item.photoId = resp.photo_id;
          } catch (e) {}
          item.state = "sent";
          item.progress = 100;
          renderList();
        } else if (xhr.status >= 500) {
          // Server-side failure: worth an automatic retry.
          retryOrFail(item);
        } else {
          // 4xx (unauthorized, too_large, bad_type/heic, queue_full,
          // rate_limited, ...): retrying the same bytes can never succeed
          // on its own, so surface the manual retry button instead of
          // burning auto-retries.
          item.state = "failed";
          renderList();
        }
        pumpQueue();
      };
      xhr.onerror = function () {
        uploading = false;
        retryOrFail(item);
        pumpQueue();
      };
      var form = new FormData();
      form.append("file", item.blob, "photo.jpg");
      xhr.send(form);
    });
  }

  function retryOrFail(item) {
    item.retries = (item.retries || 0) + 1;
    if (item.retries <= MAX_AUTO_RETRIES) {
      item.state = "queued";
    } else {
      item.state = "failed";
    }
    renderList();
  }

  function enqueueFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (file) {
      var item = {
        state: "normalizing",
        progress: 0,
        retries: 0,
        thumbUrl: null,
        blob: null,
        photoId: null
      };
      queue.push(item);
      renderList();
      normalizeImage(file)
        .then(function (blob) {
          item.blob = blob;
          item.thumbUrl = URL.createObjectURL(blob);
          item.state = "queued";
          renderList();
          pumpQueue();
        })
        .catch(function () {
          item.state = "failed";
          renderList();
        });
    });
  }

  document.getElementById("captureBtn").addEventListener("click", function () {
    document.getElementById("captureInput").click();
  });
  document.getElementById("pickBtn").addEventListener("click", function () {
    document.getElementById("pickInput").click();
  });
  document.getElementById("captureInput").addEventListener("change", function (evt) {
    enqueueFiles(evt.target.files);
    evt.target.value = "";
  });
  document.getElementById("pickInput").addEventListener("change", function (evt) {
    enqueueFiles(evt.target.files);
    evt.target.value = "";
  });

  // -- 5. Status polling every 3s -----------------------------------------
  var polling = false;
  function pollStatus() {
    if (!deviceToken || polling) return;
    polling = true;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "/api/status");
    xhr.setRequestHeader("X-Device-Token", deviceToken);
    xhr.onload = function () {
      polling = false;
      if (xhr.status === 401 || xhr.status === 409) {
        clearDeviceToken();
        deviceToken = null;
        setStatus("expired", t.expired);
        return;
      }
      if (xhr.status !== 200) return;
      try {
        var resp = JSON.parse(xhr.responseText);
      } catch (e) {
        return;
      }
      if (resp.connected) {
        setStatus("connected", t.connected);
      } else {
        setStatus("disconnected", t.disconnected);
      }
      if (resp.photos) {
        var byId = {};
        resp.photos.forEach(function (p) {
          byId[p.photo_id] = p.state;
        });
        var changed = false;
        queue.forEach(function (item) {
          if (item.photoId && byId[item.photoId] === "received" && item.state !== "received") {
            item.state = "received";
            changed = true;
          }
        });
        if (changed) renderList();
      }
    };
    xhr.onerror = function () {
      polling = false;
      setStatus("disconnected", t.disconnected);
    };
    xhr.send();
  }

  renderList();
  if (deviceToken) {
    pollStatus();
  } else if (pairingToken) {
    ensurePaired(function (err) {
      if (!err) pollStatus();
    });
  }
  setInterval(pollStatus, 3000);
})();
</script>
</body>
</html>
"""


def render_page() -> str:
    """Return the HTML document served at GET /."""
    return _HTML

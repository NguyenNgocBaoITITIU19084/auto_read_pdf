"""Microsoft 365 sign-in (OAuth 2.0 auth code + PKCE, public client, no secret) and Microsoft Graph requests."""
import asyncio
import base64
import hashlib
import logging
import secrets
import time
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from backend.app.core import outlook as outlook_core
from backend.app.core.config import BACKEND_PORT

logger = logging.getLogger("backend.outlook.client")

LOGIN_BASE = "https://login.microsoftonline.com"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
GRAPH_ME = f"{GRAPH_BASE}/me"
# Exactly the delegated permissions IT grants admin consent for (the account email comes from /me, not an id_token).
SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send"
# Path registered in Entra under "Mobile and desktop applications". Microsoft ignores the port of a localhost
# redirect but matches the path, so the app registration does not depend on which port the backend runs on.
REDIRECT_PATH = "/api/v1/outlook/oauth/callback"

_OAUTH_STATES: dict[str, dict[str, Any]] = {}
_OAUTH_STATE_TTL = 600
_MAX_RETRY_WAIT = 15


class OutlookClientError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def redirect_uri() -> str:
    # Always loopback: the browser that signs in runs on this machine (never BACKEND_HOST, which may be 0.0.0.0).
    return f"http://localhost:{BACKEND_PORT}{REDIRECT_PATH}"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _token_url(tenant: str) -> str:
    return f"{LOGIN_BASE}/{tenant}/oauth2/v2.0/token"


def create_oauth_url() -> dict[str, str]:
    cfg = outlook_core.get_oauth_config()
    if not cfg["client_id"] or not cfg["tenant_id"]:
        raise OutlookClientError(
            "Chưa cấu hình Microsoft 365. Vào Cài đặt Outlook để nhập Application (client) ID và Directory (tenant) ID.",
            status_code=400,
        )
    now = time.time()
    for key in [k for k, v in _OAUTH_STATES.items() if now - v["created_at"] > _OAUTH_STATE_TTL]:
        _OAUTH_STATES.pop(key, None)

    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    _OAUTH_STATES[state] = {"verifier": verifier, "redirect_uri": redirect_uri(), "created_at": now}
    params = {
        "client_id": cfg["client_id"],
        "response_type": "code",
        "redirect_uri": redirect_uri(),
        "response_mode": "query",
        "scope": SCOPES,
        "state": state,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode("ascii")).digest()),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    return {"auth_url": f"{LOGIN_BASE}/{cfg['tenant_id']}/oauth2/v2.0/authorize?{urlencode(params)}", "state": state}


def _token_error(res: httpx.Response) -> str:
    try:
        data = res.json()
        return str(data.get("error_description") or data.get("error") or res.text)[:400]
    except ValueError:
        return res.text[:400]


async def exchange_oauth_code(code: str, state: str) -> dict[str, Any]:
    pending = _OAUTH_STATES.pop(state, None)
    if not pending or time.time() - pending["created_at"] > _OAUTH_STATE_TTL:
        raise OutlookClientError("Phiên đăng nhập Microsoft đã hết hạn hoặc không hợp lệ. Hãy thử lại.", 400)
    cfg = outlook_core.get_oauth_config()
    payload = {
        "client_id": cfg["client_id"],
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending["redirect_uri"],
        "code_verifier": pending["verifier"],
        "scope": SCOPES,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(_token_url(cfg["tenant_id"]), data=payload)
        if res.status_code >= 400:
            raise OutlookClientError(f"Microsoft từ chối đăng nhập: {_token_error(res)}", 400)
        tok = res.json()
        access = tok["access_token"]
        me_res = await client.get(
            f"{GRAPH_ME}?$select=displayName,mail,userPrincipalName",
            headers={"Authorization": f"Bearer {access}"},
        )
        if me_res.status_code >= 400:
            raise OutlookClientError(f"Không lấy được thông tin tài khoản Microsoft: {me_res.text[:300]}", 400)
        me = me_res.json()

    email = me.get("mail") or me.get("userPrincipalName") or ""
    return outlook_core.upsert_account(
        email=email,
        display_name=me.get("displayName") or email,
        access_token=access,
        refresh_token=tok.get("refresh_token", ""),
        token_expiry=int(time.time()) + int(tok.get("expires_in", 3600)) - 60,
    )


async def _refresh(account: dict[str, Any]) -> str:
    if not account.get("refresh_token"):
        outlook_core.set_account_error(account["id"], "Thiếu refresh token, cần đăng nhập lại.")
        raise OutlookClientError("Phiên Outlook đã hết hạn, vui lòng kết nối lại tài khoản.", 401)
    cfg = outlook_core.get_oauth_config()
    payload = {
        "client_id": cfg["client_id"],
        "grant_type": "refresh_token",
        "refresh_token": account["refresh_token"],
        "scope": SCOPES,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        res = await client.post(_token_url(cfg["tenant_id"]), data=payload)
    if res.status_code >= 400:
        outlook_core.set_account_error(account["id"], f"Làm mới token thất bại: {_token_error(res)}")
        raise OutlookClientError("Phiên Outlook đã hết hạn, vui lòng kết nối lại tài khoản.", 401)
    tok = res.json()
    outlook_core.save_tokens(
        account["id"],
        tok["access_token"],
        int(time.time()) + int(tok.get("expires_in", 3600)) - 60,
        tok.get("refresh_token", ""),
    )
    return tok["access_token"]


async def _access_token(account_id: int, force_refresh: bool = False) -> str:
    acc = outlook_core.get_account(account_id, include_tokens=True)
    if not acc:
        raise OutlookClientError("Không tìm thấy tài khoản Outlook.", 404)
    if not force_refresh and acc["access_token"] and int(acc["token_expiry"] or 0) > int(time.time()):
        return acc["access_token"]
    return await _refresh(acc)


def _graph_url(path_or_url: str) -> str:
    """A path under /me, or a Graph @odata.nextLink. Anything else is refused so the token never leaves Graph."""
    if path_or_url.startswith("https://"):
        if not path_or_url.startswith(GRAPH_BASE + "/"):
            raise OutlookClientError("Liên kết phân trang không hợp lệ.", 400)
        return path_or_url
    return f"{GRAPH_ME}{path_or_url}"


async def graph_request(
    account_id: int,
    method: str,
    path_or_url: str,
    params: Optional[dict[str, Any]] = None,
    json_body: Optional[dict[str, Any]] = None,
    raw: bool = False,
) -> Any:
    """Call Graph as the account. Refreshes once on 401, waits out 429/503 (Retry-After), returns JSON or bytes."""
    url = _graph_url(path_or_url)
    # Immutable ids stay the same when a message moves to another folder.
    headers = {"Prefer": 'IdType="ImmutableId"'}
    token = await _access_token(account_id)
    refreshed = False
    attempts = 0
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        while True:
            res = await client.request(
                method, url, params=params, json=json_body,
                headers={**headers, "Authorization": f"Bearer {token}"},
            )
            if res.status_code == 401 and not refreshed:
                token = await _access_token(account_id, force_refresh=True)
                refreshed = True
                continue
            if res.status_code in (429, 503, 504) and attempts < 3:
                attempts += 1
                try:
                    wait = float(res.headers.get("Retry-After", "2"))
                except ValueError:
                    wait = 2.0
                await asyncio.sleep(min(max(wait, 1.0), _MAX_RETRY_WAIT))
                continue
            break
    if res.status_code >= 400:
        detail = ""
        try:
            detail = str((res.json().get("error") or {}).get("message") or "")
        except ValueError:
            detail = res.text[:300]
        status = res.status_code if res.status_code in (400, 401, 403, 404, 409, 413, 429) else 502
        raise OutlookClientError(f"Outlook báo lỗi ({res.status_code}): {detail or res.reason_phrase}", status)
    if raw:
        return res.content
    if res.status_code == 204 or not res.content:
        return {}
    return res.json()

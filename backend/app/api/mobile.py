"""Loopback-only API for the desktop app to control the phone-camera-QR feature.

Mounted on the *main* app (``backend/app/main.py``), which only binds
``127.0.0.1`` (see ``backend.app.core.config.BACKEND_HOST``) -- so these
routes are never reachable from the LAN. They start/stop the companion
LAN-bound server (``backend.app.services.lan_server.lan_server``) that
actually serves the phone-facing ``mobile_app``, and expose the current
session's status (paired devices, pending photos, and the QR pairing URL)
for the desktop UI to poll.

Security notes:
- Responses never include a device token or the internal ``pairing_token``
  itself -- only the already-composed ``pair_url`` (whose fragment carries
  the token; fragments are never sent to a server by a browser).
- No route path or query string ever carries a token value, so nothing here
  can leak a token into request logs even if request logging is added later.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel

from backend.app.mobile.app import mobile_app
from backend.app.services.lan_server import lan_server
from backend.app.services.lan_ip import list_lan_ipv4
from backend.app.services.mobile_bridge import bridge

router = APIRouter(prefix="/mobile", tags=["mobile"])


class StartSessionRequest(BaseModel):
    ip: Optional[str] = None


def _build_pair_url(ip: Optional[str], port: Optional[int], pairing_token: Optional[str]) -> Optional[str]:
    if not ip or not port or not pairing_token:
        return None
    # The pairing token lives in the URL *fragment* (`#p=...`), which
    # browsers never send to a server, so it can never leak into any
    # request log -- server-side or on the phone's own network stack.
    return f"http://{ip}:{port}/#p={pairing_token}"


def _inactive_response() -> dict:
    return {"active": False, "pair_url": None, "devices": [], "pending": []}


@router.post("/session")
def start_session(payload: StartSessionRequest):
    ips = list_lan_ipv4()
    if payload.ip is not None and payload.ip not in ips:
        raise HTTPException(status_code=400, detail={"code": "invalid_ip"})

    selected_ip = payload.ip or (ips[0] if ips else None)

    bridge.start()
    port = lan_server.start(mobile_app, host="0.0.0.0", preferred_port=8765)
    lan_server.selected_ip = selected_ip

    snap = bridge.snapshot()
    pair_url = _build_pair_url(selected_ip, port, snap.get("pairing_token"))

    return {
        "active": True,
        "session_id": snap.get("session_id"),
        "pair_url": pair_url,
        "ips": ips,
        "selected_ip": selected_ip,
        "port": port,
        "pairing_expires_at": snap.get("pairing_expires_at"),
    }


@router.get("/session")
def get_session():
    # Auto-rotate an expired-but-unused pairing token first, so the QR the
    # desktop UI is about to render (via the pair_url below) is always live.
    bridge.ensure_fresh_pairing_token()
    snap = bridge.snapshot()
    if not snap.get("active"):
        return _inactive_response()

    pair_url = _build_pair_url(lan_server.selected_ip, lan_server.port, snap.get("pairing_token"))

    devices = [
        {"id": d["id"], "label": d["label"], "last_seen": d["last_seen"]}
        for d in snap.get("devices", [])
    ]
    pending = [
        {
            "id": p.id,
            "filename": p.filename,
            "size": p.size,
            "received_at": p.received_at,
        }
        for p in bridge.pending()
    ]

    return {
        "active": True,
        "pair_url": pair_url,
        "devices": devices,
        "pending": pending,
    }


@router.get("/photos/{photo_id}")
def get_photo(photo_id: str):
    try:
        data = bridge.read_photo(photo_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return Response(content=data, media_type="image/jpeg")


@router.delete("/photos/{photo_id}", status_code=204)
def delete_photo(photo_id: str):
    try:
        bridge.ack(photo_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={"code": "not_found"})
    return Response(status_code=204)


@router.delete("/session", status_code=204)
def delete_session():
    bridge.stop()
    # Explicit as well as via bridge's on_stop callback (idempotent either
    # way) so the LAN server is always torn down when this route is hit,
    # even if the on_stop wiring ever changes.
    lan_server.stop()
    return Response(status_code=204)

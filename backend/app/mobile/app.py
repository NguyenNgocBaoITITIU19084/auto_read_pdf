"""LAN-only FastAPI app: phone pairing + photo upload.

This app is reachable from anywhere on the LAN once Task 4 binds a companion
uvicorn server to it on ``0.0.0.0`` — every response here is written as if a
stranger's browser will probe it with garbage input:

- No API docs (``docs_url``/``redoc_url``/``openapi_url`` disabled).
- No CORS middleware at all (the main app allows ``*`` origins; this one must
  not, since it is reachable from the whole LAN, not just localhost).
- Security headers (``Cache-Control: no-store``, ``Referrer-Policy:
  no-referrer``, ``X-Content-Type-Options: nosniff``) are stamped on every
  response via middleware, so they also cover 404s and error responses, not
  just the routes defined below.
- A ``Content-Length``-based pre-check rejects bodies over 16 MB with 413
  before any body is read.
- ``POST /api/photos`` streams and parses its multipart body in chunks
  (never buffering an unbounded amount) and gives up as soon as more than
  ~15 MB of file data has arrived, regardless of what ``Content-Length``
  claimed.

This module only builds ``mobile_app``; nothing here mounts it into the main
app or binds it to a socket (see Task 4).
"""

from __future__ import annotations

from typing import Optional

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from python_multipart.multipart import MultipartParser
from starlette.middleware.base import BaseHTTPMiddleware

from backend.app.mobile.page import render_page
from backend.app.services.mobile_bridge import (
    AuthError,
    BadType,
    MAX_PHOTO_BYTES,
    PairingError,
    QueueFull,
    RateLimited,
    SessionEnded,
    TooLarge,
    bridge,
)

# Coarse pre-check limit (Step 2 of the brief): reject anything claiming to
# be bigger than this before reading the body at all. The precise per-photo
# limit (MAX_PHOTO_BYTES, 15 MB) is enforced by mobile_bridge.add_photo and,
# defensively, by the chunked multipart reader below.
MAX_CONTENT_LENGTH_BYTES = 16 * 1024 * 1024

# Slack above the per-photo byte limit to accommodate multipart boundary and
# header overhead around the single "file" part, so a legitimate ~15 MB
# photo isn't truncated by framing bytes alone.
_MULTIPART_OVERHEAD_SLACK_BYTES = 64 * 1024
MAX_MULTIPART_BYTES = MAX_PHOTO_BYTES + _MULTIPART_OVERHEAD_SLACK_BYTES

_SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


def _error(status_code: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"code": code})


class _SecurityHeadersAndBodyCapMiddleware(BaseHTTPMiddleware):
    """Stamps security headers on every response and rejects oversized
    bodies by Content-Length before any route or body parsing runs."""

    async def dispatch(self, request: Request, call_next):
        content_length = _parse_content_length(request.headers.get("content-length"))
        if content_length is not None and content_length > MAX_CONTENT_LENGTH_BYTES:
            response = _error(413, "too_large")
        else:
            response = await call_next(request)
        for header, value in _SECURITY_HEADERS.items():
            response.headers[header] = value
        return response


def _parse_content_length(raw: Optional[str]) -> Optional[int]:
    """Parse a Content-Length header defensively.

    A LAN client can send anything here (missing, non-numeric, negative).
    Fail closed by treating anything unparseable as "unknown" rather than
    raising — an unparseable value falls through to the chunked reader's own
    15 MB cap instead of causing a 500.
    """
    if raw is None:
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


mobile_app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
mobile_app.add_middleware(_SecurityHeadersAndBodyCapMiddleware)


# -- exception -> HTTP response mapping (mobile_bridge domain errors) -------


@mobile_app.exception_handler(PairingError)
async def _handle_pairing_error(request: Request, exc: PairingError) -> JSONResponse:
    return _error(401, "pair_invalid")


@mobile_app.exception_handler(AuthError)
async def _handle_auth_error(request: Request, exc: AuthError) -> JSONResponse:
    return _error(401, "unauthorized")


@mobile_app.exception_handler(TooLarge)
async def _handle_too_large(request: Request, exc: TooLarge) -> JSONResponse:
    return _error(413, "too_large")


@mobile_app.exception_handler(BadType)
async def _handle_bad_type(request: Request, exc: BadType) -> JSONResponse:
    # mobile_bridge uses code="heic" for HEIC and code="unsupported" for
    # anything else; the brief's wire contract only names "bad_type"/"heic".
    code = "heic" if getattr(exc, "code", None) == "heic" else "bad_type"
    return _error(415, code)


@mobile_app.exception_handler(QueueFull)
async def _handle_queue_full(request: Request, exc: QueueFull) -> JSONResponse:
    return _error(429, "queue_full")


@mobile_app.exception_handler(RateLimited)
async def _handle_rate_limited(request: Request, exc: RateLimited) -> JSONResponse:
    return _error(429, "rate_limited")


@mobile_app.exception_handler(SessionEnded)
async def _handle_session_ended(request: Request, exc: SessionEnded) -> JSONResponse:
    # The session was torn down mid-upload; from the phone's point of view
    # that's indistinguishable from "there is no session anymore".
    return _error(409, "no_session")


# -- GET / -------------------------------------------------------------------


@mobile_app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    return HTMLResponse(content=render_page())


# -- POST /api/pair ------------------------------------------------------


class PairRequest(BaseModel):
    pairing_token: str


@mobile_app.post("/api/pair")
async def pair_endpoint(payload: PairRequest, request: Request):
    # mobile_bridge.pair() raises the same PairingError whether there is no
    # active session at all or the token is simply wrong/expired, but the
    # brief wants those distinguished (409 vs 401). snapshot() is public and
    # cheap, so check session liveness first.
    if not bridge.snapshot().get("active"):
        return _error(409, "no_session")

    device = bridge.pair(payload.pairing_token, request.headers.get("user-agent", ""))
    session = bridge.snapshot()
    return {"device_token": device.token, "session_id": session.get("session_id")}


# -- POST /api/photos ------------------------------------------------------


async def _read_multipart_file(request: Request) -> bytes:
    """Stream the request body and extract the (single) file part's bytes.

    Reads via ``request.stream()`` in whatever chunk sizes the ASGI server
    hands over (never materializing the whole declared Content-Length up
    front), feeding each chunk into a streaming multipart parser. Aborts as
    soon as the parser reports it could not accept a whole chunk (i.e. the
    configured max_size was hit), raising TooLarge without reading further.
    """
    content_type = request.headers.get("content-type", "")
    boundary = None
    if "boundary=" in content_type:
        boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
    if not boundary:
        # No multipart boundary at all: not a type we can even inspect.
        raise BadType("Malformed or missing multipart body")

    chunks: list[bytes] = []

    def on_part_data(data: bytes, start: int, end: int) -> None:
        chunks.append(data[start:end])

    parser = MultipartParser(
        boundary,
        callbacks={"on_part_data": on_part_data},
        max_size=MAX_MULTIPART_BYTES,
    )

    async for chunk in request.stream():
        if not chunk:
            continue
        written = parser.write(chunk)
        if written < len(chunk):
            # The parser silently truncates once max_size is reached rather
            # than raising; a short write is our signal to stop reading.
            raise TooLarge("Upload exceeds the per-photo size limit")

    return b"".join(chunks)


@mobile_app.post("/api/photos", status_code=201)
async def upload_photo(request: Request):
    device_token = request.headers.get("x-device-token")
    # Check the device token before buffering any of the (potentially large)
    # body, so an unpaired stranger can't make this endpoint do multi-MB of
    # work with no credentials at all.
    if not device_token or not bridge.device_status(device_token).get("connected"):
        return _error(401, "unauthorized")

    data = await _read_multipart_file(request)
    photo = bridge.add_photo(device_token, data)
    return JSONResponse(status_code=201, content={"photo_id": photo.id})


# -- GET /api/status -------------------------------------------------------


@mobile_app.get("/api/status")
async def status_endpoint(request: Request):
    device_token = request.headers.get("x-device-token")
    status = bridge.device_status(device_token) if device_token else {"connected": False}

    photos: list[dict] = []
    if device_token and status.get("connected"):
        # device_photos() is scoped to this device's id (unlike pending(),
        # which is queue-wide across all paired devices) and includes acked
        # photos so "received" can be reported alongside "queued".
        photos = [
            {
                "photo_id": photo.id,
                "state": "received" if photo.acked else "queued",
            }
            for photo in bridge.device_photos(device_token)
        ]
    return {"connected": bool(status.get("connected")), "photos": photos}

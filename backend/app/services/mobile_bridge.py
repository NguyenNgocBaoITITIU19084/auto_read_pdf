"""In-memory pairing / session / photo-queue service for the phone-camera-QR feature.

A phone pairs with the desktop app over LAN by scanning a QR code that encodes
a short-lived ``pairing_token``. Once paired, the phone uploads photos which are
queued here (never persisted to the database, never stored inside the repo) for
a later FastAPI route (a future task) to serve to the desktop OCR pipeline.

Concurrency: a single ``threading.Lock`` protects all mutable state because this
service is called both from the main API server thread and from a companion LAN
server thread (see the plan's Task 4) running concurrently.

Time is injected via a ``clock`` callable so tests never need real sleeps. The
default clock is ``time.time`` (wall-clock epoch seconds) rather than
``time.monotonic`` because photo filenames are derived from the same clock and
must map onto real Asia/Ho_Chi_Minh wall-clock time.
"""

from __future__ import annotations

import hmac
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from zoneinfo import ZoneInfo

TZ_HO_CHI_MINH = ZoneInfo("Asia/Ho_Chi_Minh")

# --- Limits (see plan Task 2 brief) -----------------------------------------
MAX_PHOTO_BYTES = 15 * 1024 * 1024
MAX_PENDING_PHOTOS = 30
MAX_SESSION_BYTES = 300 * 1024 * 1024
MAX_PHOTOS_PER_MINUTE = 60
PAIRING_TOKEN_TTL_SECONDS = 5 * 60
SESSION_IDLE_TIMEOUT_SECONDS = 30 * 60
RATE_LIMIT_WINDOW_SECONDS = 60.0


# --- Errors ------------------------------------------------------------------


class PairingError(Exception):
    """Raised when a pairing token is missing, wrong, reused, or expired."""


class AuthError(Exception):
    """Raised when a device token does not match any paired device."""


class TooLarge(Exception):
    """Raised when a photo exceeds the per-photo size limit."""


class BadType(Exception):
    """Raised when the uploaded bytes are not a supported image type.

    ``code`` optionally distinguishes specific reasons, e.g. ``"heic"`` for a
    HEIC upload (which is explicitly rejected rather than merely unsupported).
    """

    def __init__(self, message: str, code: Optional[str] = None):
        super().__init__(message)
        self.code = code


class QueueFull(Exception):
    """Raised when the session's pending-photo count or byte total is exceeded."""


class RateLimited(Exception):
    """Raised when a device exceeds the per-minute photo upload rate."""


class SessionEnded(Exception):
    """Raised when the session was torn down while a photo write was in flight.

    ``add_photo`` reserves the photo's queue slot/byte budget under the lock,
    then writes the (possibly EXIF-normalized) bytes to disk *outside* the
    lock. If a concurrent ``stop()``/``expire_if_idle()`` removes the
    session's ``tmp_dir`` while that write/replace is in progress, the
    write raises a raw ``OSError``/``FileNotFoundError``. That is translated
    into this domain error (after the queue-slot/rate-limit reservation is
    rolled back) so callers only ever need to catch this module's own
    exceptions, never an OS-level one.
    """


# --- Data types ----------------------------------------------------------


@dataclass
class MobilePhoto:
    id: str
    device_id: str
    filename: str
    size: int
    received_at: float
    path: Path
    acked: bool = False
    # False while the file is still being normalized/written to disk
    # (outside the lock, see add_photo). Invisible to pending()/read_photo()
    # until True, so no caller ever observes a half-written photo.
    ready: bool = True


@dataclass
class MobileDevice:
    id: str
    token: str
    label: str
    paired_at: float
    last_seen: float


@dataclass
class MobileSession:
    id: str
    pairing_token: str
    pairing_expires_at: float
    created_at: float
    last_activity: float
    tmp_dir: Path


def _tokens_match(expected: str, provided: object) -> bool:
    """Constant-time token comparison that tolerates non-str/non-ASCII input.

    ``hmac.compare_digest`` raises ``TypeError`` when comparing ``str``
    values that contain non-ASCII characters, and raises immediately if
    either argument isn't a ``str``/``bytes``. Client-supplied tokens are
    untrusted, so both cases must fail closed (return False) rather than
    raise, letting callers turn a mismatch into a normal PairingError /
    AuthError instead of leaking a 500.
    """
    if not isinstance(provided, str):
        return False
    try:
        return hmac.compare_digest(expected.encode("utf-8"), provided.encode("utf-8"))
    except (UnicodeEncodeError, UnicodeDecodeError):
        return False


def _label_from_user_agent(user_agent: str) -> str:
    """Derive a short, human-friendly device label from a User-Agent string."""
    ua = (user_agent or "").lower()
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return "iPhone"
    if "android" in ua:
        return "Android"
    return "Thiết bị"


_HEIC_FTYP_BRANDS = (
    b"ftypheic",
    b"ftypheix",
    b"ftypheif",
    b"ftypmif1",
    b"ftypmsf1",
)


def _detect_image_type(data: bytes) -> str:
    """Return "jpeg" / "png" / "webp", or raise BadType (code="heic" for HEIC)."""
    header = data[:32]
    if any(brand in header for brand in _HEIC_FTYP_BRANDS):
        raise BadType("HEIC images are not supported", code="heic")
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:4] == b"\x89PNG":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise BadType("Unsupported image type", code="unsupported")


class MobileBridge:
    """In-memory pairing/session/photo-queue service.

    Args:
        clock: injectable time source (default ``time.time``), used for all
            TTL/expiry math and for deriving photo filenames' timestamps.
        on_stop: optional callback invoked (with no arguments) whenever a
            session is torn down, whether via an explicit ``stop()`` or via
            ``expire_if_idle()``. A later task wires this to shut down the
            companion LAN server alongside the session. Invoked *after* the
            internal lock is released, so the callback may safely call back
            into this bridge (e.g. to inspect ``snapshot()``).
    """

    def __init__(
        self,
        clock: Callable[[], float] = time.time,
        on_stop: Optional[Callable[[], None]] = None,
    ):
        self._clock = clock
        self._on_stop = on_stop
        self._lock = threading.Lock()

        self._session: Optional[MobileSession] = None
        self._devices: dict[str, MobileDevice] = {}  # token -> device
        self._photos: dict[str, MobilePhoto] = {}  # id -> photo, insertion order
        self._rate_windows: dict[str, list[float]] = {}  # device.id -> timestamps
        self._photo_counter = 0

    # -- session lifecycle -------------------------------------------------

    def start(self) -> MobileSession:
        with self._lock:
            if self._session is not None:
                return self._session
            now = self._clock()
            session = MobileSession(
                id=secrets.token_hex(8),
                pairing_token=secrets.token_urlsafe(32),
                pairing_expires_at=now + PAIRING_TOKEN_TTL_SECONDS,
                created_at=now,
                last_activity=now,
                tmp_dir=Path(tempfile.mkdtemp(prefix="arp_mobile_")),
            )
            self._session = session
            self._devices = {}
            self._photos = {}
            self._rate_windows = {}
            self._photo_counter = 0
            return session

    def stop(self) -> None:
        with self._lock:
            callback = self._stop_locked()
        if callback is not None:
            callback()

    def _stop_locked(self) -> Optional[Callable[[], None]]:
        """Tear down the current session. Must be called with the lock held.

        Returns the ``on_stop`` callback to invoke *after* releasing the lock,
        or None if there was nothing to stop / no callback configured.
        """
        session = self._session
        if session is None:
            return None
        shutil.rmtree(session.tmp_dir, ignore_errors=True)
        self._session = None
        self._devices = {}
        self._photos = {}
        self._rate_windows = {}
        return self._on_stop

    def expire_if_idle(self) -> bool:
        """Stop the session if idle for more than 30 minutes. Returns True if stopped."""
        with self._lock:
            session = self._session
            if session is None:
                return False
            if self._clock() - session.last_activity <= SESSION_IDLE_TIMEOUT_SECONDS:
                return False
            callback = self._stop_locked()
        if callback is not None:
            callback()
        return True

    # -- pairing -------------------------------------------------------------

    def pair(self, pairing_token: str, user_agent: str) -> MobileDevice:
        with self._lock:
            session = self._session
            if session is None:
                raise PairingError("No active session")
            if not _tokens_match(session.pairing_token, pairing_token):
                raise PairingError("Invalid or already-used pairing token")
            now = self._clock()
            if now > session.pairing_expires_at:
                raise PairingError("Pairing token expired")

            device = MobileDevice(
                id=secrets.token_hex(8),
                token=secrets.token_urlsafe(32),
                label=_label_from_user_agent(user_agent),
                paired_at=now,
                last_seen=now,
            )
            self._devices[device.token] = device
            # Single-use: rotate the pairing token so it cannot be replayed.
            session.pairing_token = secrets.token_urlsafe(32)
            session.last_activity = now
            return device

    # -- device lookup helper --------------------------------------------

    def _find_device(self, device_token: str) -> MobileDevice:
        for device in self._devices.values():
            if _tokens_match(device.token, device_token):
                return device
        raise AuthError("Unknown or invalid device token")

    # -- photos --------------------------------------------------------------

    def add_photo(self, device_token: str, data: bytes) -> MobilePhoto:
        # Validation, limit checks, and all counter/bookkeeping mutations
        # happen under the lock below. The actual image normalization
        # (Pillow) and disk write happen *after* releasing it, so pairing,
        # status polling, and other devices' uploads aren't serialized
        # behind one photo's codec/I/O work. The photo is inserted into
        # self._photos immediately (reserving its slot/id and byte budget
        # for concurrent add_photo callers) but marked ready=False so
        # pending()/read_photo() can't observe it until the write completes.
        with self._lock:
            session = self._session
            if session is None:
                raise AuthError("No active session")
            device = self._find_device(device_token)

            if len(data) > MAX_PHOTO_BYTES:
                raise TooLarge(f"Photo exceeds {MAX_PHOTO_BYTES} bytes")

            _detect_image_type(data)  # raises BadType for unsupported/HEIC

            pending = [p for p in self._photos.values() if not p.acked]
            if len(pending) >= MAX_PENDING_PHOTOS:
                raise QueueFull("Too many pending photos")
            pending_bytes = sum(p.size for p in pending)
            if pending_bytes + len(data) > MAX_SESSION_BYTES:
                raise QueueFull("Session photo byte budget exceeded")

            now = self._clock()
            window = self._rate_windows.setdefault(device.id, [])
            window[:] = [t for t in window if now - t < RATE_LIMIT_WINDOW_SECONDS]
            if len(window) >= MAX_PHOTOS_PER_MINUTE:
                raise RateLimited("Too many photos per minute")
            window.append(now)

            self._photo_counter += 1
            n = self._photo_counter
            timestamp = datetime.fromtimestamp(now, tz=TZ_HO_CHI_MINH).strftime(
                "%Y%m%d_%H%M%S"
            )
            # image_type is validated above (rejects unsupported/HEIC); the
            # on-disk filename always uses a .jpg extension per the spec,
            # regardless of the submitted container format.
            filename = f"phone_{timestamp}_{n}.jpg"
            path = session.tmp_dir / filename

            photo = MobilePhoto(
                id=secrets.token_hex(8),
                device_id=device.id,
                filename=filename,
                size=len(data),
                received_at=now,
                path=path,
                ready=False,
            )
            self._photos[photo.id] = photo
            device.last_seen = now
            session.last_activity = now

        # -- outside the lock: codec work + disk I/O -----------------------
        try:
            out_bytes = self._normalize_exif(data)
            tmp_path = path.with_name(path.name + f".tmp{secrets.token_hex(4)}")
            tmp_path.write_bytes(out_bytes)
            tmp_path.replace(path)  # atomic on POSIX; same directory/filesystem
        except Exception as exc:
            with self._lock:
                self._photos.pop(photo.id, None)
                try:
                    window.remove(now)
                except ValueError:
                    pass
            # A concurrent stop()/expire_if_idle() can rmtree() the session's
            # tmp_dir while this write/replace is in flight, turning it into
            # a raw OSError (FileNotFoundError on POSIX). Translate that into
            # the module's own domain error so callers never need to catch
            # an OS-level exception; any other error is re-raised as-is.
            if isinstance(exc, OSError):
                raise SessionEnded(
                    "Session ended before the photo write completed"
                ) from exc
            raise

        with self._lock:
            # Only flip visibility if the photo (and session) weren't torn
            # down concurrently (e.g. session stop()/expire_if_idle()) while
            # the write was in flight.
            if photo.id in self._photos:
                photo.ready = True
        return photo

    @staticmethod
    def _normalize_exif(data: bytes) -> bytes:
        """Best-effort EXIF-orientation normalization via Pillow.

        Returns the original bytes byte-for-byte unchanged unless the image
        actually carries a non-default EXIF orientation tag (0x0112, values
        other than 1) that needs correcting — this avoids silently
        recompressing every photo that passes through here (which would
        degrade quality for an OCR pipeline and, for PNGs, flatten alpha via
        an unconditional RGB conversion). Falls back to the original bytes
        on any error: Pillow unavailable, data not decodable, etc.
        """
        try:
            import io as _io

            from PIL import Image, ImageOps

            img = Image.open(_io.BytesIO(data))
            img.load()
            orientation = img.getexif().get(0x0112, 1)
            if orientation in (0, 1):
                return data  # nothing to correct; keep submitted bytes as-is

            transposed = ImageOps.exif_transpose(img)
            if transposed is None:
                return data
            buf = _io.BytesIO()
            save_format = img.format or "JPEG"
            save_kwargs = {"quality": 95} if save_format == "JPEG" else {}
            transposed.save(buf, format=save_format, **save_kwargs)
            return buf.getvalue()
        except Exception:
            return data

    def pending(self) -> list[MobilePhoto]:
        with self._lock:
            return [p for p in self._photos.values() if not p.acked and p.ready]

    def read_photo(self, photo_id: str) -> bytes:
        # The existence/acked check and the actual disk read must happen
        # under the same lock acquisition: releasing the lock in between
        # would let a concurrent ack() delete the file after the check but
        # before the read, turning a clean KeyError into an unhandled
        # FileNotFoundError/OSError.
        with self._lock:
            photo = self._photos.get(photo_id)
            if photo is None or photo.acked or not photo.ready:
                raise KeyError(f"Unknown photo id: {photo_id}")
            try:
                return photo.path.read_bytes()
            except OSError as exc:
                raise KeyError(f"Unknown photo id: {photo_id}") from exc

    def ack(self, photo_id: str) -> None:
        with self._lock:
            photo = self._photos.get(photo_id)
            if photo is None or not photo.ready:
                raise KeyError(f"Unknown photo id: {photo_id}")
            photo.path.unlink(missing_ok=True)
            photo.acked = True

    def device_status(self, device_token: str) -> dict:
        with self._lock:
            try:
                device = self._find_device(device_token)
            except AuthError:
                return {"connected": False, "last_photo_received": False}
            received = any(
                p.device_id == device.id and p.acked for p in self._photos.values()
            )
            return {"connected": True, "last_photo_received": received}

    def snapshot(self) -> dict:
        """Return a status dict safe to expose via GET /mobile/session.

        Includes the current ``pairing_token`` (needed to render the QR code)
        but never any device token.
        """
        with self._lock:
            session = self._session
            if session is None:
                return {"active": False}
            devices = [
                {
                    "id": d.id,
                    "label": d.label,
                    "paired_at": d.paired_at,
                    "last_seen": d.last_seen,
                }
                for d in self._devices.values()
            ]
            # Kept consistent with pending(): a not-yet-ready (still being
            # written outside the lock) photo isn't "pending" from a caller's
            # point of view since it isn't visible via pending()/read_photo().
            pending_count = sum(
                1 for p in self._photos.values() if not p.acked and p.ready
            )
            return {
                "active": True,
                "session_id": session.id,
                "pairing_token": session.pairing_token,
                "pairing_expires_at": session.pairing_expires_at,
                "created_at": session.created_at,
                "last_activity": session.last_activity,
                "devices": devices,
                "pending_count": pending_count,
            }


bridge = MobileBridge()

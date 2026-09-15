"""Tests for the in-memory mobile pairing/session/photo-queue service.

Time is injected via a fake clock so tests never need real sleeps.
"""

import io
import struct
import threading
import time as real_time
from pathlib import Path

import pytest

from backend.app.services.mobile_bridge import (
    MobileBridge,
    PairingError,
    AuthError,
    TooLarge,
    BadType,
    QueueFull,
    RateLimited,
    SessionEnded,
)


class FakeClock:
    """A controllable clock: starts at an arbitrary epoch and can be advanced."""

    def __init__(self, start: float = 1_700_000_000.0):
        self._now = start

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


def make_jpeg_bytes() -> bytes:
    """Minimal but valid JPEG magic-byte prefix + filler (not decodable by Pillow)."""
    return b"\xff\xd8\xff" + b"\x00" * 100


def make_real_jpeg_bytes() -> bytes:
    """A real, Pillow-decodable JPEG image with no EXIF orientation tag."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(255, 0, 0)).save(buf, format="JPEG")
    return buf.getvalue()


def make_rotated_real_jpeg_bytes() -> bytes:
    """A real JPEG with a non-default EXIF orientation tag (needs correcting)."""
    from PIL import Image

    buf = io.BytesIO()
    exif = Image.Exif()
    exif[0x0112] = 6  # "rotate 270" orientation
    Image.new("RGB", (8, 4), color=(0, 255, 0)).save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


def make_real_png_bytes() -> bytes:
    """A real, Pillow-decodable PNG image (no EXIF orientation)."""
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), color=(0, 0, 255)).save(buf, format="PNG")
    return buf.getvalue()


def make_png_bytes() -> bytes:
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 50


def make_webp_bytes() -> bytes:
    payload = b"WEBPVP8 " + b"\x00" * 40
    return b"RIFF" + struct.pack("<I", len(payload)) + payload


def make_heic_bytes() -> bytes:
    # ftyp box with 'heic' brand, as real HEIC files start.
    return b"\x00\x00\x00\x18ftypheic" + b"\x00" * 40


def make_heic_mif1_bytes() -> bytes:
    # Some real iPhone HEIC files use the 'mif1' major brand instead of 'heic'.
    return b"\x00\x00\x00\x18ftypmif1" + b"\x00" * 40


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def bridge(clock):
    b = MobileBridge(clock=clock)
    yield b
    # best-effort cleanup in case a test forgot to stop the session
    try:
        b.stop()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# start() / stop()
# ---------------------------------------------------------------------------


class TestStartStop:
    def test_start_creates_session(self, bridge):
        session = bridge.start()
        assert session.id
        assert session.pairing_token
        assert session.tmp_dir.exists()

    def test_start_twice_returns_same_session(self, bridge):
        s1 = bridge.start()
        s2 = bridge.start()
        assert s1.id == s2.id
        assert s1.pairing_token == s2.pairing_token

    def test_stop_removes_tmp_dir(self, bridge):
        session = bridge.start()
        tmp_dir = session.tmp_dir
        bridge.stop()
        assert not tmp_dir.exists()

    def test_stop_idempotent(self, bridge):
        bridge.start()
        bridge.stop()
        bridge.stop()  # must not raise

    def test_stop_calls_on_stop_callback(self, clock):
        called = []
        b = MobileBridge(clock=clock, on_stop=lambda: called.append(True))
        b.start()
        b.stop()
        assert called == [True]

    def test_start_after_stop_creates_new_session(self, bridge):
        s1 = bridge.start()
        bridge.stop()
        s2 = bridge.start()
        assert s2.id != s1.id


# ---------------------------------------------------------------------------
# pair()
# ---------------------------------------------------------------------------


class TestPair:
    def test_pair_success_returns_device_and_rotates_token(self, bridge):
        session = bridge.start()
        old_token = session.pairing_token
        device = bridge.pair(old_token, "Mozilla/5.0 (iPhone; ...)")
        assert device.token
        assert device.label == "iPhone"
        # pairing token must have changed (single-use)
        assert bridge._session.pairing_token != old_token

    def test_pair_reuse_old_token_fails(self, bridge):
        session = bridge.start()
        old_token = session.pairing_token
        bridge.pair(old_token, "iPhone UA")
        with pytest.raises(PairingError):
            bridge.pair(old_token, "iPhone UA")

    def test_pair_expired_token_fails(self, bridge, clock):
        session = bridge.start()
        token = session.pairing_token
        clock.advance(5 * 60 + 1)
        with pytest.raises(PairingError):
            bridge.pair(token, "iPhone UA")

    def test_pair_no_session_fails(self, bridge):
        with pytest.raises(PairingError):
            bridge.pair("whatever", "iPhone UA")

    def test_pair_wrong_token_fails(self, bridge):
        bridge.start()
        with pytest.raises(PairingError):
            bridge.pair("not-the-real-token", "iPhone UA")

    def test_pair_label_android(self, bridge):
        bridge.start()
        session = bridge._session
        device = bridge.pair(session.pairing_token, "Mozilla/5.0 (Linux; Android 13)")
        assert device.label == "Android"

    def test_pair_label_unknown_device(self, bridge):
        bridge.start()
        session = bridge._session
        device = bridge.pair(session.pairing_token, "curl/8.0")
        assert device.label == "Thiết bị"

    def test_pair_non_ascii_token_raises_pairing_error_not_type_error(self, bridge):
        bridge.start()
        with pytest.raises(PairingError):
            bridge.pair("café-token-not-real", "iPhone UA")

    def test_pair_none_token_raises_pairing_error_not_type_error(self, bridge):
        bridge.start()
        with pytest.raises(PairingError):
            bridge.pair(None, "iPhone UA")


# ---------------------------------------------------------------------------
# add_photo()
# ---------------------------------------------------------------------------


@pytest.fixture
def paired(bridge):
    """Start a session and pair one device; return (bridge, device)."""
    session = bridge.start()
    device = bridge.pair(session.pairing_token, "iPhone UA")
    return device


class TestAddPhoto:
    def test_wrong_device_token_raises_auth_error(self, bridge, paired):
        with pytest.raises(AuthError):
            bridge.add_photo("not-a-real-token", make_jpeg_bytes())

    def test_too_large_raises(self, bridge, paired):
        data = b"\xff\xd8\xff" + b"\x00" * (15 * 1024 * 1024 + 1)
        with pytest.raises(TooLarge):
            bridge.add_photo(paired.token, data)

    def test_bad_type_raises(self, bridge, paired):
        with pytest.raises(BadType):
            bridge.add_photo(paired.token, b"not an image at all")

    def test_heic_raises_bad_type_with_code(self, bridge, paired):
        with pytest.raises(BadType) as exc_info:
            bridge.add_photo(paired.token, make_heic_bytes())
        assert exc_info.value.code == "heic"

    def test_heic_mif1_brand_raises_bad_type_with_code(self, bridge, paired):
        with pytest.raises(BadType) as exc_info:
            bridge.add_photo(paired.token, make_heic_mif1_bytes())
        assert exc_info.value.code == "heic"

    def test_jpeg_accepted(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        assert photo.filename.endswith(".jpg")
        assert photo.size == len(make_jpeg_bytes())

    def test_png_accepted(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_png_bytes())
        assert photo.id

    def test_webp_accepted(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_webp_bytes())
        assert photo.id

    def test_queue_full_by_count(self, bridge, paired):
        for _ in range(30):
            bridge.add_photo(paired.token, make_jpeg_bytes())
        with pytest.raises(QueueFull):
            bridge.add_photo(paired.token, make_jpeg_bytes())

    def test_queue_full_by_bytes(self, bridge, paired, clock):
        # Use a smaller per-photo size so we don't also trip the 15MB/photo cap,
        # but large enough that a handful exceed the 300MB session total.
        big = b"\xff\xd8\xff" + b"\x00" * (14 * 1024 * 1024)
        added = 0
        try:
            for _ in range(22):  # 22 * 14MB = 308MB > 300MB
                bridge.add_photo(paired.token, big)
                added += 1
        except QueueFull:
            pass
        else:
            pytest.fail("expected QueueFull before adding 22 photos")
        assert added < 22

    def test_rate_limited(self, bridge, paired, clock):
        for i in range(60):
            photo = bridge.add_photo(paired.token, make_jpeg_bytes())
            bridge.ack(photo.id)
        with pytest.raises(RateLimited):
            bridge.add_photo(paired.token, make_jpeg_bytes())

    def test_rate_limit_window_resets(self, bridge, paired, clock):
        for i in range(60):
            photo = bridge.add_photo(paired.token, make_jpeg_bytes())
            bridge.ack(photo.id)
        clock.advance(61)
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        assert photo.id

    def test_filename_uses_injected_clock_and_ho_chi_minh_tz(self, bridge, paired, clock):
        # Fixed epoch -> deterministic Asia/Ho_Chi_Minh (UTC+7) wall time.
        clock._now = 1_700_000_000.0
        from datetime import datetime
        from zoneinfo import ZoneInfo

        expected_ts = datetime.fromtimestamp(
            1_700_000_000.0, tz=ZoneInfo("Asia/Ho_Chi_Minh")
        ).strftime("%Y%m%d_%H%M%S")
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        assert photo.filename == f"phone_{expected_ts}_1.jpg"

    def test_real_jpeg_without_orientation_is_kept_byte_for_byte(self, bridge, paired):
        # No EXIF orientation tag -> nothing to correct -> no recompression.
        data = make_real_jpeg_bytes()
        photo = bridge.add_photo(paired.token, data)
        out = bridge.read_photo(photo.id)
        assert out == data

    def test_real_jpeg_with_orientation_is_transposed_and_still_decodable(
        self, bridge, paired
    ):
        data = make_rotated_real_jpeg_bytes()
        photo = bridge.add_photo(paired.token, data)
        out = bridge.read_photo(photo.id)
        assert out  # non-empty, decodable bytes
        from PIL import Image

        img = Image.open(io.BytesIO(out))
        img.verify()
        # The orientation tag should no longer instruct a rotation.
        img2 = Image.open(io.BytesIO(out))
        assert img2.getexif().get(0x0112, 1) in (0, 1)

    def test_real_png_without_orientation_roundtrips_byte_for_byte(self, bridge, paired):
        data = make_real_png_bytes()
        photo = bridge.add_photo(paired.token, data)
        out = bridge.read_photo(photo.id)
        assert out == data

    def test_synthetic_jpeg_falls_back_to_raw_bytes_and_roundtrips(self, bridge, paired):
        data = make_jpeg_bytes()
        photo = bridge.add_photo(paired.token, data)
        out = bridge.read_photo(photo.id)
        assert out == data

    def test_non_ascii_device_token_raises_auth_error_not_type_error(self, bridge, paired):
        with pytest.raises(AuthError):
            bridge.add_photo("café-token-not-real", make_jpeg_bytes())

    def test_none_device_token_raises_auth_error_not_type_error(self, bridge, paired):
        with pytest.raises(AuthError):
            bridge.add_photo(None, make_jpeg_bytes())


# ---------------------------------------------------------------------------
# pending() / read_photo() / ack() / device_status()
# ---------------------------------------------------------------------------


class TestAddPhotoWriteFailureRollback:
    """A write/replace failure mid-flight (e.g. the session's tmp_dir was
    removed by a concurrent stop()/expire_if_idle()) must surface as this
    module's own SessionEnded, never a raw OSError, and must not leak the
    queue-slot/byte/rate-limit reservation taken under the lock."""

    def test_write_failure_raises_session_ended_not_os_error(
        self, bridge, paired, monkeypatch
    ):
        def boom(self, data):
            raise OSError("simulated: tmp_dir removed mid-write")

        monkeypatch.setattr(Path, "write_bytes", boom)

        with pytest.raises(SessionEnded):
            bridge.add_photo(paired.token, make_jpeg_bytes())

    def test_write_failure_rolls_back_queue_and_rate_limit_reservation(
        self, bridge, paired, monkeypatch
    ):
        def boom(self, data):
            raise OSError("simulated: tmp_dir removed mid-write")

        monkeypatch.setattr(Path, "write_bytes", boom)

        snap_before = bridge.snapshot()
        assert snap_before["pending_count"] == 0

        with pytest.raises(SessionEnded):
            bridge.add_photo(paired.token, make_jpeg_bytes())

        # The failed attempt must not leave the photo registered, nor a
        # phantom rate-limit timestamp behind.
        snap_after = bridge.snapshot()
        assert snap_after["pending_count"] == 0
        assert bridge._photos == {}
        assert bridge._rate_windows.get(paired.id, []) == []

        # Prove the reservation was actually released (not merely
        # under-counted): undo the write failure and confirm a normal
        # add_photo call succeeds immediately afterwards, exactly as it
        # would if the failed attempt had never reserved a slot.
        monkeypatch.undo()
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        assert photo.id
        assert bridge.snapshot()["pending_count"] == 1


class TestQueueOperations:
    def test_pending_returns_in_received_order(self, bridge, paired):
        p1 = bridge.add_photo(paired.token, make_jpeg_bytes())
        p2 = bridge.add_photo(paired.token, make_png_bytes())
        pending = bridge.pending()
        assert [p.id for p in pending] == [p1.id, p2.id]

    def test_read_photo_returns_bytes(self, bridge, paired):
        data = make_jpeg_bytes()
        photo = bridge.add_photo(paired.token, data)
        assert bridge.read_photo(photo.id) == data

    def test_ack_removes_file_and_from_pending(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        path = photo.path
        bridge.ack(photo.id)
        assert not path.exists()
        assert photo.id not in [p.id for p in bridge.pending()]

    def test_read_photo_after_ack_raises(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        bridge.ack(photo.id)
        with pytest.raises(Exception):
            bridge.read_photo(photo.id)

    def test_device_status_reports_received_after_ack(self, bridge, paired):
        status_before = bridge.device_status(paired.token)
        assert status_before["last_photo_received"] is False
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        bridge.ack(photo.id)
        status_after = bridge.device_status(paired.token)
        assert status_after["last_photo_received"] is True
        assert status_after["connected"] is True


class TestDevicePhotos:
    def test_returns_queued_photo(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        result = bridge.device_photos(paired.token)
        assert [p.id for p in result] == [photo.id]
        assert result[0].acked is False

    def test_returns_acked_photo_with_acked_flag_set(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        bridge.ack(photo.id)
        result = bridge.device_photos(paired.token)
        assert [p.id for p in result] == [photo.id]
        assert result[0].acked is True

    def test_returns_both_queued_and_acked_sorted_by_received_at(
        self, bridge, paired, clock
    ):
        p1 = bridge.add_photo(paired.token, make_jpeg_bytes())
        bridge.ack(p1.id)
        clock.advance(1)
        p2 = bridge.add_photo(paired.token, make_png_bytes())
        result = bridge.device_photos(paired.token)
        assert [p.id for p in result] == [p1.id, p2.id]
        assert result[0].acked is True
        assert result[1].acked is False

    def test_does_not_return_another_devices_photos(self, bridge):
        session = bridge.start()
        device_a = bridge.pair(session.pairing_token, "iPhone UA")
        session2_pairing_token = bridge.snapshot()["pairing_token"]
        device_b = bridge.pair(session2_pairing_token, "Android UA")

        photo_a = bridge.add_photo(device_a.token, make_jpeg_bytes())
        photo_b = bridge.add_photo(device_b.token, make_png_bytes())

        result_a = bridge.device_photos(device_a.token)
        result_b = bridge.device_photos(device_b.token)
        assert [p.id for p in result_a] == [photo_a.id]
        assert [p.id for p in result_b] == [photo_b.id]

    def test_does_not_return_not_yet_ready_photos(self, bridge, paired):
        photo = bridge.add_photo(paired.token, make_jpeg_bytes())
        bridge._photos[photo.id].ready = False
        result = bridge.device_photos(paired.token)
        assert result == []

    def test_unknown_token_raises_auth_error(self, bridge, paired):
        with pytest.raises(AuthError):
            bridge.device_photos("not-a-real-token")


# ---------------------------------------------------------------------------
# expire_if_idle()
# ---------------------------------------------------------------------------


class TestExpireIfIdle:
    def test_expires_session_after_30_min_idle(self, bridge, clock):
        session = bridge.start()
        tmp_dir = session.tmp_dir
        clock.advance(30 * 60 + 1)
        bridge.expire_if_idle()
        assert bridge._session is None
        assert not tmp_dir.exists()

    def test_does_not_expire_before_30_min(self, bridge, clock):
        bridge.start()
        clock.advance(30 * 60 - 1)
        bridge.expire_if_idle()
        assert bridge._session is not None

    def test_activity_resets_idle_timer(self, bridge, clock, paired):
        clock.advance(20 * 60)
        bridge.add_photo(paired.token, make_jpeg_bytes())
        clock.advance(20 * 60)
        bridge.expire_if_idle()
        # last activity was 20 min ago (photo add), not 40 min ago
        assert bridge._session is not None

    def test_calls_on_stop_exactly_once(self, clock):
        called = []
        b = MobileBridge(clock=clock, on_stop=lambda: called.append(True))
        b.start()
        clock.advance(30 * 60 + 1)
        b.expire_if_idle()
        b.expire_if_idle()  # no active session -> no extra callback
        assert called == [True]

    def test_noop_when_no_session(self, bridge):
        bridge.expire_if_idle()  # must not raise


# ---------------------------------------------------------------------------
# snapshot()
# ---------------------------------------------------------------------------


class TestConcurrency:
    """Drives add_photo/ack/read_photo from real OS threads.

    The module's own docstring says it will be called concurrently from two
    different uvicorn server threads, so its lock discipline needs to be
    exercised with real threads, not just sequential calls.
    """

    def test_concurrent_ack_and_read_photo_never_leaks_os_error(self):
        # Real clock (not the fake one): these threads race in wall-clock
        # time, so filenames/timestamps need to actually advance.
        b = MobileBridge(clock=real_time.time)
        session = b.start()
        device = b.pair(session.pairing_token, "iPhone UA")

        errors = []
        outcomes = []
        results_lock = threading.Lock()

        def do_ack(photo_id):
            try:
                b.ack(photo_id)
            except Exception as exc:  # pragma: no cover - failure path
                with results_lock:
                    errors.append(exc)

        def do_read(photo_id):
            try:
                data = b.read_photo(photo_id)
                with results_lock:
                    outcomes.append(("bytes", len(data)))
            except KeyError:
                with results_lock:
                    outcomes.append(("keyerror", None))
            except Exception as exc:  # pragma: no cover - failure path
                with results_lock:
                    errors.append(exc)

        ROUNDS = 40
        for _ in range(ROUNDS):
            photo = b.add_photo(device.token, make_jpeg_bytes())
            t_ack = threading.Thread(target=do_ack, args=(photo.id,))
            t_read = threading.Thread(target=do_read, args=(photo.id,))
            # Start read first so it's more likely to be mid-check when ack
            # runs; with the fix, the whole check+read happens under one
            # lock acquisition so the interleaving can't matter.
            t_read.start()
            t_ack.start()
            t_ack.join()
            t_read.join()

        assert errors == [], f"unhandled exceptions leaked: {errors!r}"
        assert len(outcomes) == ROUNDS
        for kind, _value in outcomes:
            assert kind in ("bytes", "keyerror")
        try:
            b.stop()
        except Exception:
            pass

    def test_concurrent_add_photo_from_multiple_devices_no_corruption(self):
        b = MobileBridge(clock=real_time.time)
        session = b.start()
        device_a = b.pair(session.pairing_token, "iPhone UA")
        session = b._session
        device_b = b.pair(session.pairing_token, "Android UA")

        errors = []
        photo_ids = []
        results_lock = threading.Lock()

        def upload(token, payload):
            try:
                photo = b.add_photo(token, payload)
                data = b.read_photo(photo.id)
                assert data  # non-empty, readable immediately after return
                with results_lock:
                    photo_ids.append(photo.id)
            except Exception as exc:  # pragma: no cover - failure path
                with results_lock:
                    errors.append(exc)

        threads = []
        for i in range(10):
            payload = make_jpeg_bytes() if i % 2 == 0 else make_png_bytes()
            token = device_a.token if i % 2 == 0 else device_b.token
            threads.append(threading.Thread(target=upload, args=(token, payload)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"unhandled exceptions leaked: {errors!r}"
        assert len(photo_ids) == 10
        assert len(set(photo_ids)) == 10  # every photo got a unique id/slot
        try:
            b.stop()
        except Exception:
            pass

    def test_add_photo_does_not_hold_lock_during_image_normalization(
        self, bridge, paired, monkeypatch
    ):
        """Regression test for lock-scope: pairing/status must not block on
        another add_photo's Pillow decode/encode + disk write."""

        def slow_normalize(data):
            real_time.sleep(0.3)
            return data

        monkeypatch.setattr(
            MobileBridge, "_normalize_exif", staticmethod(slow_normalize)
        )

        add_done = threading.Event()

        def add():
            bridge.add_photo(paired.token, make_jpeg_bytes())
            add_done.set()

        t = threading.Thread(target=add)
        start = real_time.time()
        t.start()
        real_time.sleep(0.05)  # let add_photo get past the lock, into the sleep

        # This must return promptly even though add_photo's normalization is
        # still sleeping for another ~0.25s under the (fixed) lock discipline.
        snap = bridge.snapshot()
        snapshot_elapsed = real_time.time() - start

        assert not add_done.is_set(), (
            "add_photo finished before snapshot() returned; the test's "
            "0.3s sleep didn't overlap snapshot() as intended"
        )
        assert snap["active"] is True
        assert snapshot_elapsed < 0.2, (
            "snapshot() blocked on add_photo's image normalization; "
            "the lock is held across Pillow/disk I/O"
        )

        t.join()


class TestSnapshot:
    def test_snapshot_contains_no_device_token(self, bridge, paired):
        snap = bridge.snapshot()

        def walk(obj):
            if isinstance(obj, dict):
                for v in obj.values():
                    yield from walk(v)
            elif isinstance(obj, (list, tuple)):
                for v in obj:
                    yield from walk(v)
            else:
                yield obj

        values = list(walk(snap))
        assert paired.token not in values
        assert paired.token not in repr(snap)

    def test_snapshot_includes_pairing_token_for_qr(self, bridge):
        session = bridge.start()
        snap = bridge.snapshot()
        assert snap["pairing_token"] == session.pairing_token

    def test_snapshot_no_session(self, bridge):
        snap = bridge.snapshot()
        assert snap.get("active") is False

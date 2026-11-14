import re
import time
import base64
import uuid
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, List, Dict, Any
import requests
import urllib3
from backend.app.services.image_extractor import run_local_ocr
from backend.app.services.eport_client import (
    clean_vessel_name_for_eport,
    is_vessel_name_match,
    is_voyage_match,
)

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger("backend.sp_itc_client")
VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

SP_ITC_BASE_URL = "https://eport.sp-itc.com.vn"
SP_ITC_VESSEL_URL = f"{SP_ITC_BASE_URL}/7e47d3928bbec8c5cb9d65a600139a33/c4f822fec11066d1ed15469717e6d9e1.xc"
SP_ITC_SEARCH_URL = f"{SP_ITC_BASE_URL}/ee11cbb19052e40b07aac0ca060c23ee/d56b699830e77ba53855679cb1d252da.xc"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": f"{SP_ITC_BASE_URL}/",
}


def _create_session() -> requests.Session:
    """Create a new requests Session initialized with SP-ITC cookies."""
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        session.get(f"{SP_ITC_BASE_URL}/", verify=False, timeout=10)
    except Exception as e:
        logger.warning(f"[SP-ITC] Could not initialize homepage session: {e}")
    return session


def fetch_sp_itc_vessel_schedules(from_days_ago: int = 15, to_days_ahead: int = 30) -> List[Dict[str, Any]]:
    """
    Fetch raw vessel schedules from SP-ITC within a date range and map to ePort schema.
    """
    session = _create_session()
    now = datetime.now(VN_TZ)
    from_date = (now - timedelta(days=from_days_ago)).strftime("%Y-%m-%d 00:00:00")
    to_date = (now + timedelta(days=to_days_ahead)).strftime("%Y-%m-%d 23:59:59")
    payload = {
        "from_date": from_date,
        "to_date": to_date
    }
    start_time = time.time()
    try:
        res = session.post(SP_ITC_VESSEL_URL, data=payload, verify=False, timeout=15)
        elapsed_ms = int((time.time() - start_time) * 1000)
        res.raise_for_status()
        data = res.json()
        if not isinstance(data, list):
            logger.warning(f"[SP-ITC VESSEL] Unexpected response format: {data}")
            return []
        logger.info(f"[SP-ITC VESSEL] Retrieved {len(data)} schedules ({elapsed_ms}ms)")
        from backend.app.services.port_gate_rules import gate_open_times, get_gate_open_hours
        itc_hours = get_gate_open_hours().get("ITC", {})
        mapped_results = []
        for it in data:
            if not isinstance(it, dict):
                continue
            vessel_name = (it.get("ShipName") or "").strip()
            im_voy = (it.get("ImVoy") or "").strip()
            ex_voy = (it.get("ExVoy") or "").strip()
            if im_voy and ex_voy and im_voy != ex_voy:
                voyage = f"{im_voy}-{ex_voy}"
            else:
                voyage = ex_voy or im_voy

            closing_raw = (it.get("YARD_CLOSE") or "").strip()
            closing = closing_raw.split(".")[0].strip() if closing_raw else ""
            # SP-ITC gives no opening time: the gate opens a fixed number of hours before the cut-off
            opens = gate_open_times(closing, itc_hours)
            open_dry = opens.get("OPEN_TS", "")
            open_reefer = opens.get("REEFER_OPEN_TS", "")
            open_haz = opens.get("HAZ_OPEN_TS", "")

            eta_raw = (it.get("ETA") or "").strip()
            etd_raw = (it.get("ETD") or "").strip()
            berth_raw = (it.get("BerthDate") or "").strip()
            atd_raw = (it.get("ATD") or "").strip()

            actual_berth = (berth_raw or eta_raw).split(".")[0].strip()
            actual_dept = (atd_raw or etd_raw).split(".")[0].strip()

            remarks_parts = []
            if it.get("BERTH_NO"):
                remarks_parts.append(f"Cầu bến: {it.get('BERTH_NO')}")
            if it.get("ShipArrStatus"):
                remarks_parts.append(f"Trạng thái: {it.get('ShipArrStatus')}")

            mapped_results.append({
                "SITE_ID": "ITC",
                "site_id": "ITC",
                "AGENT": (it.get("OprID") or "").strip(),
                "agent": (it.get("OprID") or "").strip(),
                "VESSELNAME": vessel_name,
                "vessel_name": vessel_name,
                "IN_OUT_VOYAGE": voyage,
                "in_out_voyage": voyage,
                "ACTUAL_BERTH_TIME": actual_berth,
                "actual_berth_time": actual_berth,
                "ACTUAL_DEPATURE_TIME": actual_dept,
                "actual_departure_time": actual_dept,
                "CLOSING_TIME": closing,
                "closing_time": closing,
                "CLOSING_TIME_ICD": "",
                "closing_time_icd": "",
                "IN_GATE": "",
                "in_gate": "",
                "OPEN_TS": open_dry,
                "open_ts": open_dry,
                "REEFER_OPEN_TS": open_reefer,
                "reefer_open_ts": open_reefer,
                "OOG_OPEN_TS": "",
                "oog_open_ts": "",
                "HAZ_OPEN_TS": open_haz,
                "haz_open_ts": open_haz,
                "REMARKS": " | ".join(remarks_parts),
                "remarks": " | ".join(remarks_parts),
            })
        return mapped_results
    except Exception as e:
        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.error(f"[SP-ITC VESSEL ERROR] Failed to fetch vessel schedules ({elapsed_ms}ms): {e}")
        raise ConnectionError(f"Không thể kết nối tới ePort SP-ITC: {e}")


def search_sp_itc_vessels_detailed(vessel_name: str = "", voyage: str = None) -> Dict[str, Any]:
    """
    Search SP-ITC vessel schedules matching vessel name and voyage.
    If vessel_name is empty, returns all active schedules from SP-ITC.
    """
    def _result(items, reason="ok", message="", available=None):
        return {
            "items": items,
            "available_voyages": available or [],
            "reason": reason,
            "message": message,
        }

    all_schedules = fetch_sp_itc_vessel_schedules()
    if not all_schedules:
        return _result([], "vessel_not_found", "Không tìm thấy lịch tàu nào trên ePort SP-ITC")

    raw_vessel = (vessel_name or "").strip()
    voyage_query = (voyage or "").strip()

    if not raw_vessel or raw_vessel == "*":
        return _result(all_schedules, "ok")

    clean_vessel = clean_vessel_name_for_eport(raw_vessel, voyage_query) or raw_vessel
    matched_vessels = [m for m in all_schedules if is_vessel_name_match(clean_vessel, m.get("VESSELNAME", ""))]

    if not matched_vessels:
        logger.warning(f"[SP-ITC VESSEL SEARCH] Không tìm thấy lịch tàu nào khớp với tên tàu '{clean_vessel}'")
        return _result([], "vessel_not_found", f"Không tìm thấy tàu '{clean_vessel}' tại cảng SP-ITC")

    if voyage_query:
        matched = [m for m in matched_vessels if is_voyage_match(voyage_query, m.get("IN_OUT_VOYAGE", ""))]
        if matched:
            return _result(matched, "ok")
        available = []
        for m in matched_vessels:
            v = m.get("IN_OUT_VOYAGE")
            if v and v not in available:
                available.append(v)
        return _result(
            [],
            "voyage_mismatch",
            f"Không có chuyến '{voyage_query}' trên ePort SP-ITC. Các chuyến hiện có: {', '.join(available)}",
            available
        )

    return _result(matched_vessels, "ok")




class SpItcUnavailable(ConnectionError):
    """SP-ITC could not be queried (network, captcha, no OCR engine). Distinct from "container not found"."""


# Tesseract reads the captcha as one line of letters/digits instead of a document page.
CAPTCHA_TESSERACT_CONFIG = "--psm 7 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _fetch_captcha_image(session: requests.Session, captcha_html: str = "") -> requests.Response:
    """Downloads the captcha image of this session: the one in `captcha_html` (SP-ITC sends a new one with
    each answer), else a fresh one asked for."""
    img_url = ""
    if captcha_html:
        src_match = re.search(r'src=["\']([^"\']+)["\']', captcha_html)
        if src_match:
            img_url = src_match.group(1)

    if not img_url:
        resp = session.post(SP_ITC_SEARCH_URL, data={"recaptcha_tracking": 1}, verify=False, timeout=10)
        data = resp.json()
        src_match = re.search(r'src=["\']([^"\']+)["\']', data.get("captchaTracking", ""))
        if src_match:
            img_url = src_match.group(1)

    if not img_url:
        raise ValueError("Không lấy được đường dẫn ảnh captcha từ SP-ITC")

    if not img_url.startswith("http"):
        img_url = f"{SP_ITC_BASE_URL}/{img_url.lstrip('/')}"

    img_resp = session.get(img_url, verify=False, timeout=10)
    img_resp.raise_for_status()
    return img_resp


def solve_sp_itc_captcha(session: requests.Session, captcha_html: str = "") -> str:
    """
    Solves the SP-ITC captcha automatically using local OCR (Apple Vision / Windows OCR / Tesseract).
    Raises SpItcUnavailable when this machine has no OCR engine, so callers fail fast instead of retrying.
    """
    img_resp = _fetch_captcha_image(session, captcha_html)
    captcha_text, engines = run_local_ocr(img_resp.content, tesseract_config=CAPTCHA_TESSERACT_CONFIG)
    if not engines:
        raise SpItcUnavailable("Máy này không có công cụ OCR để đọc captcha SP-ITC (Apple Vision / Windows OCR / Tesseract)")
    cleaned = re.sub(r'[^0-9a-zA-Z]', '', captcha_text).strip()
    logger.debug(f"[SP-ITC CAPTCHA] Solved captcha: '{cleaned}'")
    return cleaned


# CntrClass -> IM_EXP, using the same words ePort stores ("Export", "Import")
_IM_EXP = {"1": "Import", "2": "Storage", "3": "Export"}
_BOOKING_NO = re.compile(r"[A-Za-z0-9/_.-]{3,30}")


def _sp_itc_im_exp(raw: dict) -> str:
    """CntrClass 1/2/3 as the site labels them, else from the customs declaration the record carries
    (a real class-4 record had an import declaration TKHNNo and was delivered full: an import)."""
    by_class = _IM_EXP.get(str(raw.get("CntrClass") or "").strip(), "")
    if by_class:
        return by_class
    if str(raw.get("TKHNNo") or "").strip():
        return "Import"
    if str(raw.get("TKHXNo") or "").strip():
        return "Export"
    return ""


_DG_CARGO_TYPES = {"DG", "DGR", "HZ", "HAZ", "IMO", "IMDG"}
_EMPTY_FLAG = {"", "0", "-", "N", "NO", "FALSE", "NONE", "NULL"}


def _sp_itc_haz(raw: dict) -> str:
    """Dangerous-goods text of an SP-ITC record ('' for ordinary cargo).

    A real record carries DG_CHK / DG_CD / UNNO / ClassUno ('-' when none) and CARGO_TYPE ('GP' for ordinary
    cargo). Any of them set marks the box as DG, which opens the gate later than dry or reefer cargo.
    """
    def val(key):
        v = str(raw.get(key) or "").strip()
        return "" if v.upper() in _EMPTY_FLAG else v

    cargo_type = val("CARGO_TYPE").upper()
    parts = [p for p in (val("DG_CD"), val("ClassUno"), f"UN {val('UNNO')}" if val("UNNO") else "") if p]
    if not (parts or val("DG_CHK") or cargo_type in _DG_CARGO_TYPES):
        return ""
    return " - ".join(["Hàng nguy hiểm (DG)", *parts])


def _arrived_by_barge(raw: dict) -> bool:
    return (str(raw.get("IsTruckBarge") or "").strip().upper() == "B"
            or "SALAN" in str(raw.get("DMethod_CD") or "").upper())


def _sp_itc_cust(raw: dict) -> str:
    """The Y/N customs flag the app reads (CUST, like ePort's). SP-ITC spells it out in cTLHQ
    ("Đã thanh lý hải quan"); the bTLHQHN / bTLHQHX (import / export) and IsTLHQ flags are the fallback."""
    text = str(raw.get("cTLHQ") or "").strip().lower()
    if text.startswith("đã") or text.startswith("da "):
        return "Y"
    if text.startswith("chưa") or text.startswith("chua"):
        return "N"
    flags = [str(raw.get(k)).strip() for k in ("bTLHQHN", "bTLHQHX", "IsTLHQ") if raw.get(k) is not None]
    if "1" in flags:
        return "Y"
    if "0" in flags:
        return "N"
    return ""


def _sp_itc_bill_book(raw: dict, booking_no: str = "") -> str:
    """Booking searched for, else the record's BookingNo, BLNo or rcBook (first that looks like a number)."""
    for value in (booking_no, raw.get("BookingNo"), raw.get("BLNo"), raw.get("rcBook")):
        v = str(value or "").strip()
        if _BOOKING_NO.fullmatch(v):
            return v.upper()
    return ""
_CM_STATUS = {
    "S": "Stacking", "D": "Delivery", "O": "Outgoing", "I": "Incoming", "R": "Reserved", "B": "Baplie Reserved",
}


def _clean_time(value) -> str:
    """'2026-10-13 19:00:00.000' -> '2026-10-13 19:00:00'."""
    return str(value or "").split(".")[0].strip()


def _sp_itc_events(raw: dict) -> List[tuple]:
    """(event_type, event_time) pairs for one SP-ITC record, named like ePort events.

    SP-ITC returns the container's current state, not an event log, so the events come from its dates:
    - an import discharged from the vessel (CntrClass 1, CJMode_CD "NTAU") arrives at Fdate -> UNLOAD;
    - an import brought in by barge (IsTruckBarge "B" / DMethod_CD "...SALAN") arrives at DateIn -> UNLOAD;
    - anything else with DateIn came through the gate -> INGATE;
    - a delivered container (CMStatus D) left at DateOut -> OUTGATE.
    The dates do not change between syncs, so the same rows come back each time (no duplicates).
    """
    cm_status = str(raw.get("CMStatus") or "").strip().upper()
    cntr_class = str(raw.get("CntrClass") or "").strip()
    cj_mode = str(raw.get("CJMode_CD") or "").strip().upper()
    date_in = _clean_time(raw.get("DateIn"))
    fdate = _clean_time(raw.get("Fdate"))
    date_out = _clean_time(raw.get("DateOut"))

    events = []
    if cntr_class == "1" and cj_mode == "NTAU":
        if fdate or date_in:
            events.append(("UNLOAD", fdate or date_in))
    elif date_in and _sp_itc_im_exp(raw) == "Import" and _arrived_by_barge(raw):
        # an import brought in by barge was discharged, it did not come through the gate (no "vào cổng" alert)
        events.append(("UNLOAD", date_in))
    elif date_in:
        events.append(("INGATE", date_in))
    if cm_status == "D" and date_out:
        events.append(("OUTGATE", date_out))
    if not events:
        # No dated movement yet (e.g. Reserved / Baplie Reserved): still show the container once
        events.append((_CM_STATUS.get(cm_status, cm_status or "UNKNOWN").upper(), date_in or fdate))
    return events


def _map_sp_itc_container(raw: dict, booking_no: str = "") -> List[dict]:
    """Maps one SP-ITC record to ePort-shaped container rows (one per event, see _sp_itc_events).

    BILL_BOOK links the container to a booking: see _sp_itc_bill_book (a real record carries BookingNo / BLNo).
    """
    cntr_no = (raw.get("CntrNo") or "").strip().upper()
    cm_status = (raw.get("CMStatus") or "").strip().upper()
    im_exp = _sp_itc_im_exp(raw)

    status = (raw.get("Status") or "").strip().upper()
    fel = "F" if status == "F" else ("E" if status in ("E", "R") else status)

    cust = _sp_itc_cust(raw)

    try:
        gross = float(raw.get("CMDWeight") or 0.0)
    except (ValueError, TypeError):
        gross = 0.0

    date_in = _clean_time(raw.get("DateIn") or raw.get("Fdate"))
    date_out = _clean_time(raw.get("DateOut"))
    iso = (raw.get("ISO_SZTP") or raw.get("LocalSZPT") or "").strip()
    pod = (raw.get("POD") or raw.get("FPOD") or "").strip()
    bill_book = _sp_itc_bill_book(raw, booking_no)
    in_yard = "Y" if cm_status == "S" else "N"  # where the container is now, on every row (like ePort)
    line_oper = (raw.get("OprID") or "").strip()
    seal = (raw.get("SealNo") or "").strip()
    temp = str(raw.get("Temperature") or "").strip()

    # Export: ShipInfo ("NAME/INVOY/OUTVOY") is the vessel it is loaded on, whose cut-off gives the gate-open time.
    # Import: it is the vessel it came off, so it is not a loading vessel and stays out of LOAD_TO_VESSEL.
    load_to_vessel = str(raw.get("ShipInfo") or "").strip() if im_exp == "Export" else ""

    common = {
        "SITE_ID": "ITC", "CONTAINERNO": cntr_no, "LOAD_TO_VESSEL": load_to_vessel, "VESSEL_CUTOFF": "", "IN_YARD": in_yard, "FEL": fel, "ISO": iso, "GROSS": gross,
        "CONT_IN_TS": date_in, "CONT_OUT_TS": date_out, "LINE_OPER": line_oper, "IM_EXP": im_exp,
        "POD_DESTINATION": pod, "BILL_BOOK": bill_book, "ITEM_SEAL_NO": seal, "TEMP": temp,
        "CUST": cust, "CUSTOM_CLEARANCE_STATUS": cust, "HAZ": _sp_itc_haz(raw),
    }
    events = _sp_itc_events(raw)
    rows = []
    for idx, (event_type, event_time) in enumerate(events):
        per_event = _sp_itc_event_details(raw, event_type, latest=idx == len(events) - 1)
        row = {"SITE": "ITC"}
        for k, v in {**common, "EVENT_TIME": event_time, "EVENT_TYPE": event_type, **per_event}.items():
            row[k] = v
            row[k.lower()] = v
        rows.append(row)
    return rows


# SP-ITC's codes for how a container leaves (CJMode_OUT_CD). The arrival has its name in the record (CJModeName).
_OUT_MODES = {"LAYN": "Lấy nguyên", "LAYR": "Lấy rỗng", "XTAU": "Xuất tàu", "XSALAN": "Xuất sà lan"}


def _sp_itc_event_details(raw: dict, event_type: str, latest: bool) -> dict:
    """LOCATION / TRUCK_VESSEL / NOTE of one event row. SP-ITC gives one record for the container, so these say
    what belongs to that event: how it arrived and where it was stacked (arrival row), how it left and the
    delivery papers (OUTGATE row). The container's current SP-ITC status goes on the latest row only."""
    def text(key):
        return str(raw.get(key) or "").strip()

    ship = text("ShipInfo")
    truck = text("TruckNo")
    barge = text("BARGE_CODE")
    notes = []
    if event_type == "OUTGATE":
        location = ""  # it has left the yard
        vehicle = truck
        out_code = text("CJMode_OUT_CD").upper()
        if out_code:
            notes.append(f"Phương án ra: {_OUT_MODES.get(out_code, out_code)}")
        if text("EIRNo"):
            notes.append(f"EIR: {text('EIRNo')}")
    else:
        location = text("cLocation")
        if event_type == "UNLOAD" and _arrived_by_barge(raw):
            vehicle = f"Sà lan {barge}" if barge else "Sà lan"
            if ship:
                vehicle += f" ({ship})"
        elif event_type == "UNLOAD":
            vehicle = ship
        else:
            vehicle = truck or ship  # through the gate: the truck when SP-ITC names it, else the export vessel
        if text("CJModeName"):
            notes.append(f"Phương án vào: {text('CJModeName')}")
        if event_type == "INGATE" and text("EIRNo") and not text("DateOut"):
            notes.append(f"EIR: {text('EIRNo')}")
    if latest:
        status = text("CMStatus").upper()
        if status:
            notes.insert(0, f"Trạng thái SP-ITC: {_CM_STATUS.get(status, status)}")
        site_note = re.sub(r"^[\s;/]+|[\s;/]+$", "", str(raw.get("Note") or ""))
        if site_note:
            notes.append(f"Ghi chú: {site_note}")
    return {"LOCATION": location, "TRUCK_VESSEL": vehicle, "NOTE": " | ".join(notes)}


class SpItcCaptchaExpired(ValueError):
    """The captcha session the user typed a code for is gone (older than 10 minutes, or the app restarted)."""


CAPTCHA_EXPIRED_MESSAGE = "Mã xác nhận đã hết hạn (quá 10 phút hoặc ứng dụng vừa khởi động lại). Đã lấy mã mới, vui lòng nhập lại."
CAPTCHA_WRONG_MESSAGE = "Mã xác nhận không chính xác!"

# Manual mode: session_id -> (SP-ITC session the shown captcha belongs to, time it was shown)
_CAPTCHA_SESSIONS: Dict[str, tuple[requests.Session, float]] = {}
_SESSION_TTL = 600.0  # 10 minutes


def _cleanup_expired_sessions() -> None:
    now = time.time()
    expired = [sid for sid, (_, ts) in list(_CAPTCHA_SESSIONS.items()) if now - ts > _SESSION_TTL]
    for sid in expired:
        _CAPTCHA_SESSIONS.pop(sid, None)


def _manual_captcha_for(session: requests.Session, captcha_html: str = "") -> Dict[str, Any]:
    """Registers `session` under a new id and returns its captcha image for the user to read.
    "expires_in": seconds until this app forgets the session (the code typed after that is refused)."""
    img_resp = _fetch_captcha_image(session, captcha_html)
    content_type = img_resp.headers.get("Content-Type") if img_resp.headers else ""
    content_type = content_type.split(";")[0].strip() if isinstance(content_type, str) else ""
    if not content_type.startswith("image/"):
        content_type = "image/jpeg"
    session_id = str(uuid.uuid4())
    _CAPTCHA_SESSIONS[session_id] = (session, time.time())
    img_b64 = base64.b64encode(img_resp.content).decode("ascii")
    return {"session_id": session_id, "image_data": f"data:{content_type};base64,{img_b64}",
            "expires_in": int(_SESSION_TTL)}


def get_manual_captcha() -> Dict[str, Any]:
    """
    Creates a new session with SP-ITC, retrieves a fresh captcha image as base64,
    and returns session_id and image_data url for manual solving.
    """
    _cleanup_expired_sessions()
    return _manual_captcha_for(_create_session())


def search_sp_itc_manual(container_nos: str, captcha_code: str, session_id: Optional[str]) -> Dict[str, Any]:
    """Manual mode: the code the user typed answers ONE search, because SP-ITC changes the captcha after
    every answer. So this searches only the first container and returns the rest, with the next captcha
    of the same session for the user to type:
        {"rows": [...], "searched": "TEMU1234567", "remaining": ["OOLU..."], "captcha": {...} | None}
    "captcha" is None when nothing is left, or when the next image could not be fetched (ask a new one).
    Raises SpItcCaptchaExpired (session gone) or ValueError (code rejected); the session is used up either way.
    """
    conts = [c.strip().upper() for c in re.split(r'[,;\s]+', container_nos or "") if c.strip()]
    if not conts:
        return {"rows": [], "searched": "", "remaining": [], "captcha": None}

    _cleanup_expired_sessions()
    entry = _CAPTCHA_SESSIONS.pop(session_id, None) if session_id else None
    if entry is None:
        raise SpItcCaptchaExpired(CAPTCHA_EXPIRED_MESSAGE)
    session = entry[0]

    first, rest = conts[0], conts[1:]
    payload = {"opt": "cont", "capt": (captcha_code or "").strip(), "checkval": first, "act": "search_data"}
    try:
        data = session.post(SP_ITC_SEARCH_URL, data=payload, verify=False, timeout=15).json()
    except Exception as e:
        raise SpItcUnavailable(f"Không tra được '{first}' trên ePort SP-ITC: {e}")
    if data.get("ccWrong"):
        wrong = data.get("ccWrong")
        raise ValueError(wrong if isinstance(wrong, str) and wrong.strip() else CAPTCHA_WRONG_MESSAGE)

    rows = []
    for raw in (r for r in (data.get("results") or []) if isinstance(r, dict)):
        rows.extend(_map_sp_itc_container(raw))
    attach_vessel_cutoffs(rows)
    logger.info(f"[SP-ITC cont] (manual) '{first}' -> {len(rows)} row(s), {len(rest)} container(s) left")

    next_captcha = None
    if rest:
        try:
            next_captcha = _manual_captcha_for(session, data.get("captchaTracking", ""))
        except Exception as e:
            logger.warning(f"[SP-ITC CAPTCHA] Could not fetch the next captcha: {e}")
    return {"rows": rows, "searched": first, "remaining": rest, "captcha": next_captcha}


def _query_sp_itc(session: requests.Session, opt: str, value: str, max_retries: int = 3) -> List[dict]:
    """One SP-ITC search (opt 'cont' or 'booking') with captcha solving and retries.

    Returns the raw records ([] = SP-ITC answered and has nothing). Raises SpItcUnavailable when it could not
    get an answer: no OCR engine, network errors, or every captcha rejected.
    """
    captcha = ""
    last_error = ""
    for attempt in range(max_retries):
        try:
            if not captcha:
                captcha = solve_sp_itc_captcha(session)

            payload = {"opt": opt, "capt": captcha, "checkval": value, "act": "search_data"}
            resp = session.post(SP_ITC_SEARCH_URL, data=payload, verify=False, timeout=15)
            data = resp.json()

            if data.get("ccWrong"):
                last_error = "captcha bị từ chối"
                logger.warning(
                    f"[SP-ITC {opt}] Captcha '{captcha}' was rejected, retrying ({attempt + 1}/{max_retries})..."
                )
                captcha = solve_sp_itc_captcha(session, data.get("captchaTracking", ""))
                continue

            results = [r for r in (data.get("results") or []) if isinstance(r, dict)]
            logger.info(f"[SP-ITC {opt}] '{value}' -> {len(results)} record(s)")
            return results
        except SpItcUnavailable:
            raise
        except Exception as e:
            last_error = str(e)
            logger.warning(f"[SP-ITC {opt} ERROR] Attempt {attempt + 1} failed for '{value}': {e}")
            captcha = ""
            time.sleep(1)

    raise SpItcUnavailable(f"Không tra được '{value}' trên ePort SP-ITC sau {max_retries} lần thử ({last_error})")


def _ship_info(text: str) -> tuple[str, List[str]]:
    """'MSC JORDAN III/XO639A/XO639A' -> ('MSC JORDAN III', ['XO639A'])."""
    parts = [p.strip() for p in str(text or "").split("/")]
    voyages = []
    for v in parts[1:]:
        if v and v not in voyages:
            voyages.append(v)
    return (parts[0] if parts else ""), voyages


def attach_vessel_cutoffs(rows: List[dict], schedules: Optional[List[dict]] = None) -> List[dict]:
    """Sets VESSEL_CUTOFF on the export rows from the SP-ITC schedule of their loading vessel (LOAD_TO_VESSEL).

    One schedule request per batch (no captcha). A vessel or voyage that does not match exactly gets no cut-off:
    a wrong one would show a wrong gate-open time. If SP-ITC cannot be reached the rows keep none.
    """
    wanted = [r for r in rows if r.get("LOAD_TO_VESSEL")]
    if not wanted:
        return rows
    from backend.app.services.vessel_match import same_vessel_name
    if schedules is None:
        try:
            schedules = fetch_sp_itc_vessel_schedules()
        except Exception as e:
            logger.warning(f"[SP-ITC CONTAINER] No vessel schedule for the cut-off: {e}")
            return rows
    for r in wanted:
        name, voyages = _ship_info(r["LOAD_TO_VESSEL"])
        matches = {
            s.get("CLOSING_TIME") for s in schedules
            if s.get("CLOSING_TIME") and same_vessel_name(name, s.get("VESSELNAME"))
            and any(is_voyage_match(v, s.get("IN_OUT_VOYAGE", "")) for v in voyages)
        }
        if len(matches) == 1:
            r["VESSEL_CUTOFF"] = r["vessel_cutoff"] = matches.pop()
    return rows


def search_sp_itc_single_container(session: requests.Session, container_no: str, max_retries: int = 3) -> List[dict]:
    """Search one container on SP-ITC. Raises SpItcUnavailable when SP-ITC could not be queried."""
    cntr_clean = container_no.strip().upper()
    if not cntr_clean:
        return []
    rows = []
    for raw in _query_sp_itc(session, "cont", cntr_clean, max_retries):
        rows.extend(_map_sp_itc_container(raw))
    return rows


class SpItcResults(list):
    """Container rows, plus `failed`: {container_no: error} for the containers SP-ITC could not be asked about.
    Callers report those as errors, not as "not found" (see failed_containers in eport_client)."""

    def __init__(self, rows=(), failed: Optional[Dict[str, str]] = None):
        super().__init__(rows)
        self.failed: Dict[str, str] = dict(failed or {})


def search_sp_itc_containers(container_nos: str) -> List[Dict[str, Any]]:
    """
    Search multiple containers on SP-ITC.

    One container failing does not throw away the others: its error is logged and the rest are returned.
    When nothing was found and at least one container could not be queried, this raises SpItcUnavailable,
    so the caller shows an error instead of "not found".
    """
    conts = [c.strip().upper() for c in re.split(r'[,;\s]+', container_nos or "") if c.strip()]
    if not conts:
        return []

    session = _create_session()

    all_results = []
    failed: Dict[str, str] = {}
    for idx, c in enumerate(conts):
        if idx > 0:
            time.sleep(0.5)
        try:
            all_results.extend(search_sp_itc_single_container(session, c))
        except SpItcUnavailable as e:
            failed[c] = str(e)
            if "OCR" in str(e):
                break  # no OCR engine: every other container would fail the same way
    if failed and not all_results:
        raise SpItcUnavailable(next(iter(failed.values())))
    for c, e in failed.items():
        logger.warning(f"[SP-ITC CONTAINER] {c}: {e}")
    return SpItcResults(attach_vessel_cutoffs(all_results), failed)


def search_sp_itc_booking(booking_no: str, max_retries: int = 3) -> List[Dict[str, Any]]:
    """
    Search booking information on SP-ITC to retrieve associated containers (BILL_BOOK = booking_no).
    Raises SpItcUnavailable when SP-ITC could not be queried.
    """
    bk_clean = booking_no.strip().upper()
    if not bk_clean:
        return []
    rows = []
    for raw in _query_sp_itc(_create_session(), "booking", bk_clean, max_retries):
        rows.extend(_map_sp_itc_container(raw, booking_no=bk_clean))
    return attach_vessel_cutoffs(rows)

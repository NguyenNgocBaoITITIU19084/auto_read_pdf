import os
import re
from datetime import datetime
from typing import List, Optional, Pattern, Tuple

MONTH_MAP = {
    "jan": "01", "feb": "02", "mar": "03", "apr": "04", "may": "05", "jun": "06",
    "jul": "07", "aug": "08", "sep": "09", "oct": "10", "nov": "11", "dec": "12"
}

# Canonical booking date output format used across the app: DD/MM/YYYY[ HH:MM]
_RE_DMONY = re.compile(r"^(\d{1,2})\s*([A-Za-z]{3})\s*(\d{4}|\d{2})(?:\s*(\d{1,2}:\d{2}))?$")
_RE_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}:\d{2})(?::\d{2})?)?$")
_RE_DMY = re.compile(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2}:\d{2})(?::\d{2})?)?$")

# Finds a date-shaped token anywhere in a string (not anchored like the formats above), used to
# reject non-date text (e.g. an address) that a loose label regex swept up on scrambled OCR text.
_DATE_TOKEN_RE = re.compile(
    r"\d{1,2}\s*[A-Za-z]{3}\s*\d{2,4}(?:\s*\d{1,2}:\d{2})?"
    r"|\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2})?"
    r"|\d{1,2}[/.]\d{1,2}[/.]\d{4}(?:\s+\d{1,2}:\d{2})?"
)


def _fmt_date(day: str, month: str, year: str, time_part: Optional[str]) -> Optional[str]:
    """DD/MM/YYYY[ HH:MM], or None when the date/time does not exist (e.g. 30/02, 25:00)."""
    try:
        d = int(day)
        m = int(month)
        y = int(year)
        if time_part:
            hh_s, mm_s = time_part.split(":")
            hh = int(hh_s)
            mm = int(mm_s)
            datetime(y, m, d, hh, mm)
            return f"{d:02d}/{m:02d}/{y:04d} {hh:02d}:{mm:02d}"
        datetime(y, m, d)
        return f"{d:02d}/{m:02d}/{y:04d}"
    except (ValueError, TypeError, OverflowError):
        return None


def parse_date_str(date_str: str) -> str:
    """
    Normalizes dates to the app-wide format DD/MM/YYYY (optionally ' HH:MM'):
    - '14Jul26'          -> '14/07/2026'
    - '13Jul26 02:00'    -> '13/07/2026 02:00'
    - '18Jul2617:00'     -> '18/07/2026 17:00'
    - '2026-05-04'       -> '04/05/2026'
    - '2026-05-03 13:00' -> '03/05/2026 13:00'
    Unrecognized strings (including 'null') are returned unchanged (stripped).
    """
    if not date_str:
        return ""

    date_str = date_str.strip()

    m = _RE_DMONY.match(date_str)
    if m:
        day, mon, yr, time_part = m.groups()
        mon_num = MONTH_MAP.get(mon.lower(), "")
        if mon_num:
            year_full = f"20{yr}" if len(yr) == 2 else yr
            formatted = _fmt_date(day, mon_num, year_full, time_part)
            if formatted is not None:
                return formatted

    m = _RE_ISO.match(date_str)
    if m:
        yr, mon, day, time_part = m.groups()
        formatted = _fmt_date(day, mon, yr, time_part)
        if formatted is not None:
            return formatted

    m = _RE_DMY.match(date_str)
    if m:
        day, mon, yr, time_part = m.groups()
        formatted = _fmt_date(day, mon, yr, time_part)
        if formatted is not None:
            return formatted

    return date_str


def parse_etd(eta_etd_str: str) -> str:
    """
    Extracts and normalizes the ETD portion (after '/') of an ETA/ETD string.
    e.g. '13Jul26/14Jul26' -> '14/07/2026', '2026-05-03/2026-05-04' -> '04/05/2026'
    """
    if not eta_etd_str:
        return ""
    eta_etd_str = eta_etd_str.strip()
    # Already slash-formatted dates, e.g. '13/07/2026/14/07/2026' or '14/07/2026'
    dmy = re.findall(r"\d{1,2}/\d{1,2}/\d{4}", eta_etd_str)
    if dmy:
        return parse_date_str(dmy[-1])
    parts = eta_etd_str.split("/")
    raw_etd = parts[-1].strip() if parts else ""
    return parse_date_str(raw_etd)


# ---------------------------------------------------------------------------
# Carrier detection
# ---------------------------------------------------------------------------
# Ordered most specific first. Each entry:
#   (canonical name, text regexes (matched on UPPER-cased text, word-boundary),
#    booking-number prefixes, vessel-name regexes)
# Canonical names are used by the frontend badges — do not rename.
CarrierEntry = Tuple[str, List[Pattern], Tuple[str, ...], List[Pattern]]


def _rx(*patterns: str) -> List[Pattern]:
    return [re.compile(p) for p in patterns]


CARRIERS: List[CarrierEntry] = [
    ("DONGJIN", _rx(r"\bDONG\s?JIN\b", r"\bDJSC\b"), ("DJSC", "DJ"), []),
    ("PIL", _rx(r"\bPACIFIC\s+INTERNATIONAL\s+LINES?\b", r"\bPIL\b", r"\bPILSHIP\b"), ("SGN6",), _rx(r"^KOTA\b")),
    ("CULINES", _rx(r"\bCU\s?LINES\b", r"\bCHINA\s+UNITED\s+LINES?\b", r"\bCUL\b"), ("CUL",), []),
    ("ONE", _rx(r"\bOCEAN\s+NETWORK\s+EXPRESS\b", r"\bONEY\b"), ("ONEY",), []),
    ("SITC", _rx(r"\bSITC\b"), ("SITC",), []),
    ("COSCO", _rx(r"\bCOSCO\b", r"\bCOSU\b"), ("COSU",), []),
    ("MAERSK", _rx(r"\bMAERSK\b", r"\bSEA\s?LAND\b"), ("MAEU",), []),
    ("CMA CGM", _rx(r"\bCMA\s?CGM\b", r"\bCNC\s+LINE\b", r"\bANL\b"), ("CMAU",), []),
    ("EVERGREEN", _rx(r"\bEVERGREEN\b", r"\bEMC\b"), ("EGLV",), _rx(r"^EVER\s")),
    ("WAN HAI", _rx(r"\bWAN\s?HAI\b", r"\bWHL\b"), ("WHLC",), []),
    ("HAPAG-LLOYD", _rx(r"\bHAPAG[-\s]?LLOYD\b"), ("HLCU",), []),
    ("YANG MING", _rx(r"\bYANG\s?MING\b", r"\bYML\b"), ("YMLU",), []),
    ("HMM", _rx(r"\bHYUNDAI\s+MERCHANT\b", r"\bHMM\b"), ("HDMU",), []),
    ("SINOKOR", _rx(r"\bSINOKOR\b"), ("SKLU",), []),
    ("HEUNG-A", _rx(r"\bHEUNG[-\s]?A\b"), (), []),
    ("SAMUDERA", _rx(r"\bSAMUDERA\b"), (), []),
    ("TS LINES", _rx(r"\bTS\s?LINES\b", r"\bTSL\b"), (), []),
    ("RCL", _rx(r"\bREGIONAL\s+CONTAINER\s+LINES?\b", r"\bRCL\b"), (), []),
    ("OOCL", _rx(r"\bOOCL\b"), ("OOLU",), []),
]

UNKNOWN_CARRIER = "Khác"

# Token-start booking codes: known prefix (>= 3 chars) followed by >= 6 alphanumerics containing a digit
_BOOKING_CODE_PATTERNS: List[Tuple[str, Pattern]] = [
    (name, re.compile(rf"\b{re.escape(p)}(?=[A-Z0-9]*\d)[A-Z0-9]{{6,}}\b"))
    for name, _patterns, prefixes, _vessels in CARRIERS
    for p in prefixes if len(p) >= 3
]


def detect_carrier(text: str = "", booking_no: str = "", vessel: str = "", pdf_name: str = "") -> str:
    """
    Identifies the carrier / shipping line from booking number, text, vessel and file name.
    Order of evidence: booking-number prefix > document text / file name > vessel name.
    Uses word boundaries so words like 'PILOT', 'COMPILED', 'PARTICULARS' do not misfire.
    """
    bk = (booking_no or "").strip().upper()
    if bk and bk != "NULL":
        for name, _patterns, prefixes, _vessels in CARRIERS:
            if any(bk.startswith(p) for p in prefixes):
                return name

    # '_' is a word char for \b, so split file names like 'CUL_CULVSGN...pdf'
    haystack = f"{text or ''}\n{pdf_name or ''}".replace("_", " ").upper()
    for name, patterns, _prefixes, _vessels in CARRIERS:
        if any(p.search(haystack) for p in patterns):
            return name

    # Booking codes glued into text / file names (e.g. 'ONEYSGNF12345600.pdf', 'BKG COSU6412345678')
    # when Booking No itself wasn't extracted
    for name, rx in _BOOKING_CODE_PATTERNS:
        if rx.search(haystack):
            return name

    vsl = (vessel or "").strip().upper()
    if vsl and vsl != "NULL":
        for name, _patterns, _prefixes, vessels in CARRIERS:
            if any(v.search(vsl) for v in vessels):
                return name

    return UNKNOWN_CARRIER


# ---------------------------------------------------------------------------
# Field helpers
# ---------------------------------------------------------------------------
_EMPTY_CY_LABEL = re.compile(r"Empty\s*Pick\s*UP\s*CY\s*:", re.IGNORECASE)
_EMPTY_DATE_LABEL = re.compile(r"Empty\s*Pick\s*Up\s*Date\s*:?.*$", re.IGNORECASE)
# Lines that start a new field (stop collecting wrapped CY name lines)
_FIELD_LINE = re.compile(
    r"^(?:Address|TEL|Yard\s*PIC|Full\s*Return|Empty\s*Pick\s*Up\s*Date|Doc\s*Cut|Port\s*Cargo|"
    r"Customs\s*Cut|VGM|Commodity|Special\s*Cargo|Remarks)\b",
    re.IGNORECASE,
)


def _clean_cy(value: str) -> str:
    value = re.sub(r"\s+", " ", value).strip()
    return re.sub(r"[\s\.\,]+$", "", value).strip()


def _extract_empty_pickup_cy(text: str) -> str:
    """
    Extracts 'Empty Pick UP CY'. Handles pdfplumber layouts where a long depot name wraps
    around the label, e.g. (PIL):
        TAN CANG HIEP LUC JONT STOCK Empty Pick Up Date :
        Empty Pick UP CY :
        COMPANY
        Address : ...
    """
    lines = [ln.strip() for ln in text.splitlines()]
    for idx, line in enumerate(lines):
        m = _EMPTY_CY_LABEL.search(line)
        if not m:
            continue
        same_line = line[m.end():]
        label_has_date = bool(_EMPTY_DATE_LABEL.search(same_line))
        same_line = _EMPTY_DATE_LABEL.sub("", same_line).strip()

        parts: List[str] = []
        # Wrapped prefix on the previous line (only when the date label was pushed up there)
        if not same_line and not label_has_date and idx > 0:
            prev = lines[idx - 1]
            if _EMPTY_DATE_LABEL.search(prev) and not _FIELD_LINE.match(prev):
                prefix = _EMPTY_DATE_LABEL.sub("", prev).strip()
                if prefix and ":" not in prefix:
                    parts.append(prefix)
        if same_line:
            parts.append(same_line)

        # Continuation lines until next field label
        for nxt in lines[idx + 1:]:
            if not nxt:
                continue
            if _FIELD_LINE.match(nxt) or re.match(r"^[A-Za-z][A-Za-z /.'’()-]{1,40}:", nxt):
                break
            parts.append(_EMPTY_DATE_LABEL.sub("", nxt).strip())
            if _EMPTY_DATE_LABEL.search(nxt):
                break
        return _clean_cy(" ".join(p for p in parts if p))
    return ""


BOOKING_KEYS = [
    "Booking No", "Carrier", "Port of Discharging", "Place of Delivery", "Block", "T/S Port",
    "Equipment Type", "Q'ty", "Empty Pick Up CY", "Full return CY", "Port Cargo Cut-off",
    "Pre Carrier", "ETD_Pre", "Trunk Vessel", "ETD_Trunk", "Vessel", "ETD",
]


def has_booking_fields(data: dict) -> bool:
    """True if at least one meaningful booking field (other than Carrier) was extracted."""
    for k in BOOKING_KEYS:
        if k == "Carrier":
            continue
        v = data.get(k)
        if v and str(v).strip() and str(v).strip().lower() != "null":
            return True
    return False


def extract_booking_from_text(text: str, filename: str = "") -> dict:
    """
    Parses booking information from raw text extracted from PDF or OCR.
    """
    result = {"STT": "", "Tên file PDF": filename}
    result.update({k: "" for k in BOOKING_KEYS})

    if not text:
        for k in result:
            if k != "Tên file PDF" and k != "STT":
                result[k] = "null"
        return result

    try:
        # Extract Booking No
        booking_match = re.search(r"Booking\s*No\s*:\s*([A-Z0-9]+)", text, re.IGNORECASE)
        if not booking_match:
            booking_match = re.search(r"(?:Booking|BKG)\s*(?:No|Number|#)?\s*[:\.]?\s*([A-Z0-9]{6,25})", text, re.IGNORECASE)
        if booking_match:
            result["Booking No"] = booking_match.group(1).strip()

        # Extract Ocean Route Type & T/S Port
        ocean_route_match = re.search(r"Ocean\s*Route\s*Type\s*:\s*(.*?)(?=\n|Receiving\s*Term|Delivery\s*Term|$)", text, re.IGNORECASE)
        ocean_route_val = ocean_route_match.group(1).strip() if ocean_route_match else ""

        # Check T/S Port embedded in Ocean Route Type (e.g. Non-direct(T/S Port : SINGAPORE) or Non-direct(T/S Port : PORT KLANG))
        ts_in_route = re.search(r"T/S\s*Port\s*:\s*([^\)]+)", ocean_route_val, re.IGNORECASE)
        if ts_in_route:
            result["T/S Port"] = ts_in_route.group(1).strip()
        elif "direct" in ocean_route_val.lower() and "non-direct" not in ocean_route_val.lower():
            result["T/S Port"] = ""
        else:
            # Standalone T/S Port search
            ts_match = re.search(r"T/S\s*Port\s*:\s*(.*?)(?=\s*(?:POD\s*/|Terminal|\)|$))", text, re.IGNORECASE)
            if ts_match:
                ts_clean = ts_match.group(1).strip()
                if ts_clean and not ts_clean.startswith(":"):
                    result["T/S Port"] = ts_clean

        # Extract Port of Discharging
        pod_match = re.search(r"Port\s*of\s*Discharg(?:e|ing)?\s*:\s*(.*?)(?=\s*(?:Place\s*of\s*Delivery|Final\s*Destination|Terminal|ETA|\n|$))", text, re.IGNORECASE)
        if not pod_match:
            pod_match = re.search(r"POD\s*:\s*([^\n\r]+)", text, re.IGNORECASE)
        if pod_match:
            result["Port of Discharging"] = pod_match.group(1).strip()

        # Extract Place of Delivery / Final Destination
        deliv_match = re.search(r"(?:Place\s*of\s*Delivery|Final\s*Destination)\s*:\s*(.*?)(?=\s*(?:Terminal|Ocean\s*Route|ETA|\n|$))", text, re.IGNORECASE)
        if deliv_match:
            result["Place of Delivery"] = deliv_match.group(1).strip()

        # Extract Block
        block_match = re.search(r"(?:\(|^|\s)Block\s*:\s*([A-Za-z0-9]+)", text, re.IGNORECASE)
        if block_match:
            result["Block"] = block_match.group(1).strip()

        # Extract Equipment Type/Q'ty
        eq_match = re.search(r"Equipment\s*Type/Q['’]ty\s*:\s*(.*?)(?=\n|Commodity|Estimated|$)", text, re.IGNORECASE)
        if not eq_match:
            eq_match = re.search(r"(?:Container|Equip|Eq)\s*(?:Type|Size)?\s*[:\.]?\s*([0-9]{2}['A-Za-z0-9 \t\.\-]+)", text, re.IGNORECASE)
        if eq_match:
            eq_val = eq_match.group(1).strip()
            split_match = re.search(r'^(.*?)(?:\.-|-|\.)\s*(\d+)$', eq_val)
            if split_match:
                raw_eq = split_match.group(1).strip()
                result["Q'ty"] = split_match.group(2).strip()
            else:
                raw_eq = eq_val
                result["Q'ty"] = ""

            # Normalize container type representation if needed (e.g. 40'DRY HQ -> 40'HC)
            if re.match(r"^40['’]?\s*DRY\s*HQ$", raw_eq, re.IGNORECASE):
                result["Equipment Type"] = "40'HC"
            else:
                result["Equipment Type"] = raw_eq

        # Extract Empty Pick Up CY (handles names wrapped around the label)
        result["Empty Pick Up CY"] = _extract_empty_pickup_cy(text)

        # Extract Full Return CY
        full_cy_match = re.search(r"Full\s*Return\s*CY\s*:\s*(.*?)(?=\s*(?:Full\s*Return\s*Date|Address|TEL|Yard\s*PIC|Doc\s*Cut-off|Port\s*Cargo|$))", text, re.IGNORECASE)
        if full_cy_match:
            result["Full return CY"] = _clean_cy(full_cy_match.group(1))

        # Extract Port Cargo Cut-off
        cutoff_match = re.search(r"Port\s*Cargo\s*Cut[- ]*off\s*:\s*(.*?)(?=\n|VGM\s*Cut-off|Customs\s*Cut-off|Rail\s*Receiving\s*Date|$)", text, re.IGNORECASE)
        if not cutoff_match:
            cutoff_match = re.search(r"(?:Cargo|CY)\s*Cut[- ]*off\s*:\s*(.*?)(?=\n|$)", text, re.IGNORECASE)
        if cutoff_match:
            cutoff_raw = cutoff_match.group(1).strip()
            date_token = _DATE_TOKEN_RE.search(cutoff_raw)
            # Scrambled OCR text (columns reordered) can make the label regex sweep up unrelated
            # text (e.g. a street address) instead of the real date, which is now on a disconnected
            # line. Only accept the match if it actually contains a date-shaped token; otherwise
            # leave the field unset rather than store clearly wrong data.
            if date_token:
                result["Port Cargo Cut-off"] = parse_date_str(date_token.group(0))

        # Pre Carrier & Trunk Vessel and their ETDs
        pre_carrier = ""
        etd_pre = ""
        trunk_vessel = ""
        etd_trunk = ""

        pre_carrier_match = re.search(r"Pre\s*Carrier\s*:\s*(.*?)\s*(?:Latest\s*)?ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
        if pre_carrier_match:
            pre_val = pre_carrier_match.group(1).strip()
            eta_etd_val = pre_carrier_match.group(2).strip()
            if pre_val and pre_val != ":":
                pre_carrier = pre_val
                etd_pre = parse_etd(eta_etd_val)

        trunk_match = re.search(r"Trunk\s*Vessel\s*:\s*(.*?)\s*(?:Latest\s*)?ETA/ETD\s*:\s*([^\s\n]*)", text, re.IGNORECASE)
        if trunk_match:
            trunk_val = trunk_match.group(1).strip()
            eta_etd_val = trunk_match.group(2).strip()
            if trunk_val and trunk_val != ":":
                trunk_vessel = trunk_val
                etd_trunk = parse_etd(eta_etd_val)

        if pre_carrier:
            result["Pre Carrier"] = pre_carrier
            result["ETD_Pre"] = etd_pre
            result["Trunk Vessel"] = ""
            result["ETD_Trunk"] = ""
            result["Vessel"] = pre_carrier
            result["ETD"] = etd_pre
        else:
            result["Pre Carrier"] = ""
            result["ETD_Pre"] = ""
            result["Trunk Vessel"] = trunk_vessel
            result["ETD_Trunk"] = etd_trunk
            result["Vessel"] = trunk_vessel
            result["ETD"] = etd_trunk

        # Detect Carrier
        result["Carrier"] = detect_carrier(text, result["Booking No"], result["Vessel"], filename)

    except Exception as e:
        print(f"Error parsing booking text ({filename}): {e}")

    for k in result:
        if k != "Tên file PDF" and k != "STT":
            if result[k] is None or result[k] == "":
                result[k] = "null"

    return result


def read_pdf_text(pdf_path: str) -> str:
    """Returns the concatenated text layer of all PDF pages ('' if none)."""
    import pdfplumber  # lazy import: keeps backend startup fast

    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            extracted_text = page.extract_text()
            if extracted_text:
                text += extracted_text + "\n"
    return text


def extract_booking_data(pdf_path: str) -> dict:
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"File not found: {pdf_path}")

    filename = os.path.basename(pdf_path)
    try:
        text = read_pdf_text(pdf_path)
    except Exception as e:
        print(f"Error parsing PDF {pdf_path}: {e}")
        text = ""
    return extract_booking_from_text(text, filename)

import re
from datetime import datetime

from backend.app.services.extractor import parse_date_str, normalize_field_case

DATE_FIELDS = ("ETD", "Port Cargo Cut-off")
_DMY_RE = re.compile(r"^\d{2}/\d{2}/\d{4}( \d{2}:\d{2})?$")


def _is_valid_dmy(value: str) -> bool:
    """Format AND calendar validity (parse_date_str keeps invalid dates like '30/02/2026'
    unchanged, so they can still match the format regex)."""
    m = _DMY_RE.match(value)
    if not m:
        return False
    fmt = "%d/%m/%Y %H:%M" if m.group(1) else "%d/%m/%Y"
    try:
        datetime.strptime(value, fmt)
        return True
    except ValueError:
        return False


def normalize_manual_booking(data: dict, require_identity: bool = True) -> tuple[dict, list[str]]:
    """Clean a user-entered booking. Returns (normalized, errors). Unknown keys are kept as-is."""
    out: dict = {}
    for key, value in (data or {}).items():
        if isinstance(value, str):
            value = value.strip()
            if value.lower() == "null":
                value = ""
        out[key] = "" if value is None else value

    normalize_field_case(out)

    errors: list[str] = []
    for field in DATE_FIELDS:
        raw = out.get(field)
        if raw:
            parsed = parse_date_str(str(raw))
            if _is_valid_dmy(parsed):
                out[field] = parsed
            else:
                errors.append(f"{field}: ngày không hợp lệ (DD/MM/YYYY hoặc DD/MM/YYYY HH:mm)")
    qty = str(out.get("Q'ty", "") or "")
    if qty and not (qty.isdigit() and 1 <= int(qty) <= 999):
        errors.append("Q'ty: phải là số nguyên từ 1 đến 999")
    if require_identity and not (out.get("Booking No") or out.get("Vessel")):
        errors.append("Cần nhập ít nhất Booking No hoặc Tàu (Vessel)")
    return out, errors

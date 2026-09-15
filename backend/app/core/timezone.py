from datetime import datetime
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"


def now_vn_str() -> str:
    """Current wall-clock time in Vietnam, independent of the machine's timezone setting."""
    return datetime.now(VN_TZ).strftime(DATETIME_FMT)

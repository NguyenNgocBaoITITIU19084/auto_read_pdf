### Task 1: Giờ `queried_at` theo múi giờ Việt Nam (C4) + hạ tầng Vitest

**Files:**
- Create: `backend/app/core/timezone.py`
- Modify: `backend/app/core/database.py:7,17-18,705`
- Modify: `backend/app/services/background_tasks.py:6,24,58-59`
- Create: `backend/tests/test_timezone.py`
- Create: `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`
- Modify: `frontend/package.json` (scripts + devDependencies)
- Create: `frontend/src/utils/vnTime.ts`, `frontend/src/utils/vnTime.test.ts`
- Modify: `frontend/src/utils/formatters.ts:5-54`, `frontend/src/services/i18nFormat.ts:10-18`

**Interfaces:**
- Produces (Python): `backend.app.core.timezone.VN_TZ: ZoneInfo`, `now_vn_str() -> str`
- Produces (TS): `parseVnDateTime(s?: string | null): Date | null`, `vnParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number }`
- Produces: `npm test` chạy Vitest (jsdom) trong `frontend/`

- [ ] **Step 1: Viết test backend thất bại**

`backend/tests/test_timezone.py`:
```python
import time
from datetime import datetime, timedelta

import pytest

from backend.app.core import database as db
from backend.app.core.timezone import VN_TZ, now_vn_str


def _as_vn(s: str) -> datetime:
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S").replace(tzinfo=VN_TZ)


@pytest.mark.skipif(not hasattr(time, "tzset"), reason="time.tzset is POSIX-only")
def test_now_vn_str_ignores_machine_timezone(monkeypatch):
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    try:
        expected = datetime.now(VN_TZ)
        assert abs(_as_vn(now_vn_str()) - expected) < timedelta(seconds=5)
        assert abs(_as_vn(db._now_str()) - expected) < timedelta(seconds=5)
    finally:
        monkeypatch.delenv("TZ", raising=False)
        time.tzset()
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `pytest backend/tests/test_timezone.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.app.core.timezone'`

- [ ] **Step 3: Cài đặt backend**

`backend/app/core/timezone.py`:
```python
from datetime import datetime
from zoneinfo import ZoneInfo

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"


def now_vn_str() -> str:
    """Current wall-clock time in Vietnam, independent of the machine's timezone setting."""
    return datetime.now(VN_TZ).strftime(DATETIME_FMT)
```

`backend/app/core/database.py` — thay dòng 17-18:
```python
def _now_str() -> str:
    return now_vn_str()
```
thêm import sau `from backend.app.core import config`:
```python
from backend.app.core.timezone import VN_TZ, now_vn_str
```
và dòng 705:
```python
        suffix = datetime.now(VN_TZ).strftime("%Y%m%d%H%M%S")
```

`backend/app/services/background_tasks.py` — xoá `from zoneinfo import ZoneInfo`, thay dòng 24-25 và 58-59:
```python
from backend.app.core.timezone import VN_TZ, DATETIME_FMT, now_vn_str
```
```python
def _now_str() -> str:
    return now_vn_str()
```
(giữ tên `bt.VN_TZ` vì `tests/test_scheduler.py` dùng.)

- [ ] **Step 4: Chạy test backend**

Run: `pytest backend/tests/test_timezone.py tests/test_scheduler.py -v`
Expected: PASS toàn bộ

- [ ] **Step 5: Cài Vitest**

Run: `cd frontend && npm install -D vitest@^3 jsdom@^25 @testing-library/react@^16`

`frontend/package.json` — thêm vào `"scripts"`: `"test": "vitest run"`.

`frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`frontend/src/test/setup.ts`:
```ts
// Run every frontend test in a non-Vietnam timezone so VN-time bugs surface.
process.env.TZ = 'America/New_York';
```

Kiểm tra `frontend/tsconfig.json` có `"include": ["src"]` — nếu `tsc` báo lỗi kiểu `vitest` trong file test, thêm `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test"]` vào `tsconfig.json`.

- [ ] **Step 6: Viết test frontend thất bại**

`frontend/src/utils/vnTime.test.ts`:
```ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseVnDateTime, vnParts } from './vnTime';
import { formatTimeAgo, isRecentUpdate } from './formatters';
import { formatDateTimeShort } from '../services/i18nFormat';

afterEach(() => vi.useRealTimers());

describe('vnTime', () => {
  it('treats naive backend strings as Asia/Ho_Chi_Minh', () => {
    const d = parseVnDateTime('2026-09-15 10:30:00')!;
    expect(d.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('parses DD/MM/YYYY HH:mm as VN time', () => {
    expect(parseVnDateTime('15/09/2026 10:30')!.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('keeps explicit offsets', () => {
    expect(parseVnDateTime('2026-09-15T03:30:00Z')!.toISOString()).toBe('2026-09-15T03:30:00.000Z');
  });

  it('returns null for garbage', () => {
    expect(parseVnDateTime('null')).toBeNull();
    expect(parseVnDateTime('abc')).toBeNull();
  });

  it('vnParts reports VN wall clock', () => {
    expect(vnParts(new Date('2026-09-15T20:05:00Z'))).toEqual({ year: 2026, month: 9, day: 16, hour: 3, minute: 5 });
  });

  it('formatTimeAgo is correct when the machine is not in VN', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T03:35:00Z')); // 10:35 VN
    expect(formatTimeAgo('2026-09-15 10:30:00')).toBe('5 phút trước');
    expect(isRecentUpdate('2026-09-15 10:30:00', 30)).toBe(true);
    vi.setSystemTime(new Date('2026-09-15T08:00:00Z')); // 15:00 VN
    expect(formatTimeAgo('2026-09-15 10:30:00')).toBe('Hôm nay 10:30');
    expect(formatDateTimeShort('2026-09-15 10:30:00')).toBe('10:30 15/09/2026');
  });
});
```

- [ ] **Step 7: Chạy, xác nhận thất bại**

Run: `cd frontend && npm test`
Expected: FAIL — `Failed to resolve import "./vnTime"`

- [ ] **Step 8: Cài đặt frontend**

`frontend/src/utils/vnTime.ts`:
```ts
/** Backend timestamps are Vietnam wall-clock strings without an offset. Never parse them with the machine timezone. */
export const VN_OFFSET = '+07:00';
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const pad = (n: number | string) => String(n).padStart(2, '0');

const fromParts = (y: string, mo: string, d: string, h = '0', mi = '0', s = '0'): Date | null => {
  const date = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${VN_OFFSET}`);
  return isNaN(date.getTime()) ? null : date;
};

export function parseVnDateTime(value?: string | null): Date | null {
  if (!value || value === 'null') return null;
  const s = value.trim();
  let m = s.match(NAIVE_ISO);
  if (m) return fromParts(m[1], m[2], m[3], m[4], m[5], m[6] || '0');
  m = s.match(DATE_ONLY_ISO);
  if (m) return fromParts(m[1], m[2], m[3]);
  m = s.match(DMY);
  if (m) return fromParts(m[3], m[2], m[1], m[4] || '0', m[5] || '0', m[6] || '0');
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function vnParts(d: Date) {
  const get = (type: string) => Number(partsFormatter.formatToParts(d).find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}
```

`frontend/src/utils/formatters.ts` — thay `parseCustomDate`, `formatTimeAgo` (dòng 5-45) và giữ `isRecentUpdate` dùng `parseCustomDate`:
```ts
import { parseVnDateTime, vnParts } from './vnTime';

export function parseCustomDate(dateStr?: string | null): Date | null {
  return parseVnDateTime(dateStr);
}

export function formatTimeAgo(dateStr?: string | null): string {
  const d = parseCustomDate(dateStr);
  if (!d) return dateStr || 'Chưa cập nhật';

  const now = new Date();
  const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  const p = vnParts(d);

  if (diffSec < 60) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const n = vnParts(now);
  if (diffHour < 24 && n.day === p.day && n.month === p.month && n.year === p.year) {
    return `Hôm nay ${pad(p.hour)}:${pad(p.minute)}`;
  }
  return `${pad(p.day)}/${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}
```
(đặt `import` lên đầu file cùng các import sẵn có.)

`frontend/src/services/i18nFormat.ts` — thay `formatDateTimeShort`:
```ts
import { parseVnDateTime, vnParts } from '../utils/vnTime';

/** Formats backend VN-time strings ("YYYY-MM-DD HH:MM:SS" or ISO) as "HH:MM dd/MM/yyyy" in Vietnam time. */
export const formatDateTimeShort = (value?: string | null): string => {
  if (!value) return '';
  const d = parseVnDateTime(value);
  if (!d) return value;
  const p = vnParts(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(p.hour)}:${pad(p.minute)} ${pad(p.day)}/${pad(p.month)}/${p.year}`;
};
```

Rà soát: `grep -rn "parseCustomDate\|getHours()\|getDate()" frontend/src --include=*.ts --include=*.tsx` — mọi chỗ hiển thị giờ của chuỗi backend phải dùng `vnParts`. `utils/vessel.ts:151` (`/Date(ms)/`) đổi `d.getHours()`… sang `vnParts(d)` tương tự.

- [ ] **Step 9: Chạy test + build**

Run: `cd frontend && npm test && npm run build`
Expected: 6 test PASS; build thành công.

- [ ] **Step 10: Commit**

```bash
git add backend/app/core/timezone.py backend/app/core/database.py backend/app/services/background_tasks.py backend/tests/test_timezone.py frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/test frontend/src/utils frontend/src/services/i18nFormat.ts frontend/tsconfig.json
git commit -m "fix(time): store and display timestamps in Asia/Ho_Chi_Minh regardless of OS timezone

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---


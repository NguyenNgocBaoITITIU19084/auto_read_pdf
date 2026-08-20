# Quick Copy Row Feature Specification

## Overview
Adds a quick copy feature for each row across all data tables (Booking, Vessel Schedules, Container Statuses). When copying a row, the application extracts only the currently visible columns in their active order and formats them as `Column Label: Value | Column Label: Value` for rapid sharing in chats, emails, or notes.

## Requirements & Scope
1. **Target Tables**:
   - Booking table (`BookingTab.tsx`)
   - SNP Vessel Schedules table (`VesselTab.tsx`)
   - SNP Container Lookup table (`ContainerTab.tsx`)

2. **Copy Format**:
   - Format: `Column_1_Label: Value_1 | Column_2_Label: Value_2 | Column_3_Label: Value_3`
   - Only include columns where `visible === true`.
   - Preserve column ordering as defined by the user in `useColumnSettings` (custom column configs).
   - Use current display label for each column (respects i18n and custom renamed labels).
   - If a cell value is null, undefined, or empty string, format as empty cleanly without crashing.

3. **User Interactions**:
   - A dedicated Copy icon button (`Copy` from `lucide-react`) in the Actions column (`Thao tác`) on each table row.
   - Hover tooltip: "Sao chép nhanh dòng này".
   - On click: Writes the formatted string to clipboard (`navigator.clipboard.writeText` with fallback).
   - Toast notification: Shows `Đã sao chép vào bộ nhớ tạm!` (`t.common.copySuccess`).
   - Stop event propagation so clicking copy does not trigger row click/detail modal.

## Architecture & Implementation Details

### 1. Formatter Utility (`frontend/src/utils/formatters.ts`)
Add a reusable function:
```typescript
import { ColumnDef } from '../components/common/ColumnConfigModal';

export function formatRowForCopy(
  item: Record<string, any>,
  columns: ColumnDef[]
): string {
  return columns
    .filter((col) => col.visible)
    .map((col) => {
      const rawVal = item[col.key];
      const val = rawVal !== undefined && rawVal !== null && rawVal !== 'null' ? String(rawVal).trim() : '';
      return `${col.label}: ${val}`;
    })
    .join(' | ');
}
```

### 2. Table Component Integration
- **`BookingTab.tsx`**:
  - Update existing `copyRow` handler to call `formatRowForCopy(booking, columns)` and copy to clipboard.
- **`ContainerTab.tsx`**:
  - Add `copyRow` handler using `formatRowForCopy(item, columns)`.
  - Add `Copy` button inside the actions column `<td>` between `Eye` and `BookmarkPlus/BookmarkCheck`.
- **`VesselTab.tsx`**:
  - Add `copyRow` handler using `formatRowForCopy(item, columns)`.
  - Add `Copy` button inside the actions column `<td>` between `Eye` and `BookmarkPlus/BookmarkCheck`.

## Error Handling & Edge Cases
- Clipboard API security/permission fallback (`document.execCommand('copy')` fallback if `navigator.clipboard` is restricted).
- Empty/Null/Undefined values are gracefully handled without outputting `undefined` or `null`.
- Hidden columns (`visible: false`) are filtered out completely.

## Verification
- Test copying a row in Booking Tab with default and customized columns.
- Test copying a row in Vessel Tab with default and customized columns.
- Test copying a row in Container Tab with default and customized columns.
- Verify clipboard content matches `Column Label: Value | ...` format.
- Verify toast notification appears upon copying.

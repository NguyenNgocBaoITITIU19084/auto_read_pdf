# Quick Copy Row Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a quick copy row action button for each row across all three data tables (Booking, Container, Vessel), extracting visible columns and formatting as `Column Label: Value | ...`.

**Architecture:** Create a reusable utility `formatRowForCopy` and clipboard copy helper with fallback in `frontend/src/utils/formatters.ts`. Integrate it into `BookingTab.tsx`, `ContainerTab.tsx`, and `VesselTab.tsx` with action buttons and visual feedback.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide React icons (`Copy`, `Check`).

## Global Constraints
- Only copy visible columns in current active order.
- Format: `Column_Label: Value | Column_Label: Value`.
- Handle null/undefined/empty gracefully.
- Stop click propagation when clicking the copy button so row selection/modal does not trigger.

---

### Task 1: Reusable Formatter & Clipboard Helper

**Files:**
- Modify: `frontend/src/utils/formatters.ts`

**Interfaces:**
- Produces: `formatRowForCopy(item: Record<string, any>, columns: ColumnDef[]): string`
- Produces: `copyTextToClipboard(text: string): Promise<boolean>`

- [ ] **Step 1: Implement `formatRowForCopy` and `copyTextToClipboard` in `formatters.ts`**

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

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Failed to copy to clipboard', err);
    return false;
  }
}
```

- [ ] **Step 2: Typecheck the utility changes**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no TS errors.

---

### Task 2: Integrate Quick Copy in BookingTab

**Files:**
- Modify: `frontend/src/components/booking/BookingTab.tsx`

**Interfaces:**
- Consumes: `formatRowForCopy`, `copyTextToClipboard` from `../../utils/formatters`

- [ ] **Step 1: Update `copyRow` in `BookingTab.tsx`**

```typescript
const copyRow = async (booking: Booking) => {
  const text = formatRowForCopy(booking, columns);
  const success = await copyTextToClipboard(text);
  if (success) {
    addToast(t.common.copySuccess, 'success');
  } else {
    addToast(t.common.error, 'error');
  }
};
```

- [ ] **Step 2: Update Tooltip and action button in `BookingTab.tsx` table row**

Ensure button tooltip is descriptive ("Sao chép thông tin dòng" or `t.common.copy`) and `onClick` prevents propagation.

- [ ] **Step 3: Verify BookingTab compilation**

Run: `cd frontend && npm run build`
Expected: PASS.

---

### Task 3: Integrate Quick Copy in ContainerTab

**Files:**
- Modify: `frontend/src/components/container/ContainerTab.tsx`

**Interfaces:**
- Consumes: `formatRowForCopy`, `copyTextToClipboard` from `../../utils/formatters`
- Consumes: `Copy` icon from `lucide-react`

- [ ] **Step 1: Import `Copy` from `lucide-react` and `formatRowForCopy`, `copyTextToClipboard` in `ContainerTab.tsx`**

- [ ] **Step 2: Add `handleCopyRow` function in `ContainerTab.tsx`**

```typescript
const handleCopyRow = async (item: ContainerInfo) => {
  const text = formatRowForCopy(item, columns);
  const success = await copyTextToClipboard(text);
  if (success) {
    addToast(t.common.copySuccess, 'success');
  } else {
    addToast(t.common.error, 'error');
  }
};
```

- [ ] **Step 3: Add Copy button in Actions column (`<td>`) for each row**

Add tooltip "Sao chép thông tin dòng" and button with `<Copy className="w-3.5 h-3.5" />`.

- [ ] **Step 4: Verify ContainerTab compilation**

Run: `cd frontend && npm run build`
Expected: PASS.

---

### Task 4: Integrate Quick Copy in VesselTab

**Files:**
- Modify: `frontend/src/components/vessel/VesselTab.tsx`

**Interfaces:**
- Consumes: `formatRowForCopy`, `copyTextToClipboard` from `../../utils/formatters`
- Consumes: `Copy` icon from `lucide-react`

- [ ] **Step 1: Import `Copy` from `lucide-react` and `formatRowForCopy`, `copyTextToClipboard` in `VesselTab.tsx`**

- [ ] **Step 2: Add `handleCopyRow` function in `VesselTab.tsx`**

```typescript
const handleCopyRow = async (item: VesselSchedule) => {
  const text = formatRowForCopy(item, columns);
  const success = await copyTextToClipboard(text);
  if (success) {
    addToast(t.common.copySuccess, 'success');
  } else {
    addToast(t.common.error, 'error');
  }
};
```

- [ ] **Step 3: Add Copy button in Actions column (`<td>`) for each row**

Add tooltip "Sao chép thông tin dòng" and button with `<Copy className="w-3.5 h-3.5" />`.

- [ ] **Step 4: Verify VesselTab compilation & full build**

Run: `cd frontend && npm run build`
Expected: PASS.

---

### Task 5: Verification & End-to-End Testing

- [ ] **Step 1: Run frontend build to verify zero TS/bundling errors**
- [ ] **Step 2: Verify all 3 tabs have copy button aligned with consistent UX**
- [ ] **Step 3: Document walkthrough & results**

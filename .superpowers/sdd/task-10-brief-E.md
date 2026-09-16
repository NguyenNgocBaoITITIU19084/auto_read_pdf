### Task 10: Giao diện chọn & quản lý bộ sưu tập gọn

Hiện tại header có: nhãn "Bộ sưu tập:" + `<select>` rộng 176px + nút tạo (mở modal riêng) + nút quản lý (mở modal thứ ba). Modal quản lý có dòng cao 56px, xác nhận xoá nằm ngay trong dòng, nhiều chuỗi tiếng Việt viết cứng, không đổi tên được và không biết mỗi bộ sưu tập chứa bao nhiêu dữ liệu.

Thiết kế mới:
- **Header:** một nút `[🗂 Kho HCM ▾]` (tối đa 220px, cắt chữ). Bấm vào mở popover rộng 320px:
  ```
  🔍 Tìm bộ sưu tập...
  ● Kho HCM            120 BK · 8 tàu · 3.2k cont
    Kho Hải Phòng       40 BK · 2 tàu · 900 cont
  ─────────────────────────────────────────
  ＋ [Tên bộ sưu tập mới      ] [Tạo]
  ⚙ Quản lý bộ sưu tập…
  ```
  Phím ↑/↓ chọn, Enter chuyển, Esc đóng. Tạo xong tự chuyển sang bộ sưu tập mới.
- **Modal quản lý** (`max-w-xl`): mỗi dòng cao 44px gồm tên, số lượng, ngày tạo `dd/MM/yyyy` và nút (bút chì = đổi tên tại chỗ, thùng rác = xoá qua `useConfirm` nguy hiểm, nêu rõ số booking/tàu/cont/theo dõi sẽ mất). Không còn nút "Đóng" ở cuối (Modal đã có ✕).

**Files:**
- Modify: `frontend/src/services/api.ts:21-38`, `frontend/src/types/index.ts:1-6`
- Modify: `frontend/src/context/AppContext.tsx:121-152`
- Create: `frontend/src/components/common/CollectionSwitcher.tsx`, `frontend/src/components/common/CollectionSwitcher.test.tsx`
- Modify: `frontend/src/components/common/CollectionManagerModal.tsx` (viết lại)
- Modify: `frontend/src/components/common/Header.tsx:28-37,65-71,134-172,369-372` (bỏ select, nút tạo, modal "Tạo BST mới")
- Modify: `frontend/src/i18n/translations.ts` (section mới `collections`)

**Interfaces:**
- Consumes: `GET /collections?with_counts=true`, `PUT /collections/{id}`, `POST /collections` 409 (Task 9); `useConfirm`
- Produces (TS):
  ```ts
  // types
  export interface Collection { id: number; name: string; created_at: string; settings?: string | null;
    booking_count?: number; vessel_count?: number; container_count?: number; watchlist_count?: number }
  // api
  export const getCollections: (withCounts?: boolean) => Promise<Collection[]>
  export const createCollection: (name: string) => Promise<{ id: number; name: string }>  // unchanged
  export const renameCollectionApi: (id: number, name: string) => Promise<{ id: number; name: string }>
  // AppContext (useApp)
  refreshCollections: () => Promise<void>                            // now loads with counts
  handleCreateCollection: (name: string) => Promise<Collection | null> // returns the created collection, null on error
  handleRenameCollection: (id: number, name: string) => Promise<boolean>
  // components
  export const CollectionSwitcher: React.FC<{ onManage: () => void }>
  export function formatCount(n?: number): string   // 950 -> "950", 3200 -> "3,2k", 12500 -> "12,5k", 1200000 -> "1,2M"
  ```
- `refreshCollections` giữ nguyên tham chiếu `activeCollection` nếu `id`, `name`, `settings` không đổi (tránh các tab tải lại chỉ vì số đếm thay đổi); nếu tên đổi thì thay bằng object mới.

- [ ] **Step 1: Chuỗi dịch** — thêm section `collections` vào `vi`:
```ts
    collections: {
      switcherTooltip: "Chọn bộ sưu tập để làm việc",
      searchPlaceholder: "Tìm bộ sưu tập...",
      noMatch: "Không có bộ sưu tập phù hợp",
      newPlaceholder: "Tên bộ sưu tập mới",
      create: "Tạo",
      manage: "Quản lý bộ sưu tập…",
      managerTitle: "Quản lý bộ sưu tập",
      active: "Đang dùng",
      use: "Dùng",
      counts: "{bookings} booking · {vessels} tàu · {containers} cont",
      createdAt: "Tạo {date}",
      rename: "Đổi tên",
      renameSave: "Lưu tên",
      renameSuccess: "Đã đổi tên bộ sưu tập",
      delete: "Xoá bộ sưu tập",
      deleteTitle: "Xoá bộ sưu tập \"{name}\"?",
      deleteMessage: "Sẽ xoá vĩnh viễn {bookings} booking, {vessels} lịch tàu, {containers} container và {watchlists} mục theo dõi trong bộ sưu tập này. Không thể hoàn tác.",
      deleteConfirm: "Xoá vĩnh viễn",
      lastOneHint: "Cần giữ lại ít nhất một bộ sưu tập",
      empty: "Chưa có bộ sưu tập nào"
    },
```
`en`:
```ts
    collections: {
      switcherTooltip: "Choose the collection to work in",
      searchPlaceholder: "Search collections...",
      noMatch: "No matching collection",
      newPlaceholder: "New collection name",
      create: "Create",
      manage: "Manage collections…",
      managerTitle: "Manage collections",
      active: "Active",
      use: "Use",
      counts: "{bookings} bookings · {vessels} vessels · {containers} conts",
      createdAt: "Created {date}",
      rename: "Rename",
      renameSave: "Save name",
      renameSuccess: "Collection renamed",
      delete: "Delete collection",
      deleteTitle: "Delete collection \"{name}\"?",
      deleteMessage: "This permanently deletes {bookings} bookings, {vessels} vessel schedules, {containers} containers and {watchlists} watch items in this collection. This cannot be undone.",
      deleteConfirm: "Delete permanently",
      lastOneHint: "Keep at least one collection",
      empty: "No collections yet"
    },
```

- [ ] **Step 2: API, kiểu, context**

`types/index.ts` — thay `interface Collection` như phần Interfaces.

`api.ts`:
```ts
export const getCollections = async (withCounts = false): Promise<Collection[]> => {
  const res = await apiClient.get<Collection[]>('/collections', { params: withCounts ? { with_counts: true } : undefined });
  return res.data;
};

export const renameCollectionApi = async (id: number, name: string): Promise<{ id: number; name: string }> =>
  (await apiClient.put<{ status: string; id: number; name: string }>(`/collections/${id}`, { name })).data;
```

`AppContext.tsx`:
```tsx
  const refreshCollections = useCallback(async () => {
    try {
      const cols = await getCollections(true);
      setCollections(cols);
      setActiveCollection((prev) => {
        if (cols.length === 0) return null;
        const next = prev ? cols.find((c) => c.id === prev.id) : undefined;
        if (!next) return cols[0];
        return next.name === prev!.name && next.settings === prev!.settings ? prev : next;
      });
    } catch (e: any) {
      console.error('Failed to load collections:', e);
    }
  }, []);

  const handleCreateCollection = useCallback(async (name: string): Promise<Collection | null> => {
    try {
      const created = await createCollection(name);
      addToast(tRef.current.common.success, 'success');
      await refreshCollections();
      return { id: created.id, name: created.name, created_at: '' };
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
      return null;
    }
  }, [addToast, refreshCollections]);

  const handleRenameCollection = useCallback(async (id: number, name: string): Promise<boolean> => {
    try {
      await renameCollectionApi(id, name);
      addToast(tRef.current.collections.renameSuccess, 'success');
      await refreshCollections();
      return true;
    } catch (e: any) {
      addToast(errorMessage(e, tRef.current.common.error), 'error');
      return false;
    }
  }, [addToast, refreshCollections]);
```
Thêm `handleRenameCollection` vào interface context (L33-35) và vào object `value` (cả danh sách deps của `useMemo` nếu có). Đổi kiểu `handleCreateCollection` trong interface thành `(name: string) => Promise<Collection | null>`.

Số đếm sẽ cũ sau khi thêm/xoá dữ liệu. `CollectionSwitcher` và `CollectionManagerModal` gọi `refreshCollections()` mỗi lần **mở** popover/modal — không cần polling.

- [ ] **Step 3: Viết test thất bại cho switcher**

`frontend/src/components/common/CollectionSwitcher.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const ctx = vi.hoisted(() => ({
  collections: [
    { id: 1, name: 'Kho HCM', created_at: '2026-01-01 00:00:00', booking_count: 120, vessel_count: 8, container_count: 3200 },
    { id: 2, name: 'Kho Hải Phòng', created_at: '2026-02-01 00:00:00', booking_count: 40, vessel_count: 2, container_count: 900 },
  ],
  activeCollection: null as any,
  setActiveCollection: vi.fn(),
  refreshCollections: vi.fn(async () => undefined),
  handleCreateCollection: vi.fn(),
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, ...ctx }) }));

import { CollectionSwitcher, formatCount } from './CollectionSwitcher';
const c = translations.vi.collections;

beforeEach(() => {
  ctx.activeCollection = ctx.collections[0];
  ctx.setActiveCollection.mockReset();
  ctx.handleCreateCollection.mockReset();
});

describe('CollectionSwitcher', () => {
  it('formats counts compactly', () => {
    expect([formatCount(950), formatCount(3200), formatCount(12500), formatCount(1_200_000), formatCount(undefined)])
      .toEqual(['950', '3,2k', '12,5k', '1,2M', '0']);
  });

  it('opens, filters, and switches with the keyboard', async () => {
    render(<CollectionSwitcher onManage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    expect(ctx.refreshCollections).toHaveBeenCalled();
    const search = screen.getByPlaceholderText(c.searchPlaceholder);
    fireEvent.change(search, { target: { value: 'hải' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(ctx.setActiveCollection).toHaveBeenCalledWith(ctx.collections[1]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('creates a collection and switches to it', async () => {
    ctx.handleCreateCollection.mockResolvedValue({ id: 3, name: 'Kho Mới', created_at: '' });
    render(<CollectionSwitcher onManage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    fireEvent.change(screen.getByPlaceholderText(c.newPlaceholder), { target: { value: ' Kho Mới ' } });
    fireEvent.click(screen.getByRole('button', { name: c.create }));
    await waitFor(() => expect(ctx.handleCreateCollection).toHaveBeenCalledWith('Kho Mới'));
    await waitFor(() => expect(ctx.setActiveCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 3 })));
  });

  it('opens the manager', () => {
    const onManage = vi.fn();
    render(<CollectionSwitcher onManage={onManage} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    fireEvent.click(screen.getByRole('button', { name: c.manage }));
    expect(onManage).toHaveBeenCalled();
  });
});
```

Run: `cd frontend && npm test -- CollectionSwitcher`
Expected: FAIL — không resolve `./CollectionSwitcher`

- [ ] **Step 4: Cài đặt `CollectionSwitcher.tsx`**

```tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FolderPlus, Layers, Search, Settings2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';
import type { Collection } from '../../types';

export function formatCount(n?: number): string {
  const v = n ?? 0;
  const fmt = (x: number, unit: string) => `${(Math.round(x * 10) / 10).toString().replace('.', ',')}${unit}`;
  if (v >= 1_000_000) return fmt(v / 1_000_000, 'M');
  if (v >= 1_000) return fmt(v / 1_000, 'k');
  return String(v);
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

export const CollectionSwitcher: React.FC<{ onManage: () => void }> = ({ onManage }) => {
  const { t, collections, activeCollection, setActiveCollection, refreshCollections, handleCreateCollection } = useApp();
  const c = t.collections;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () => collections.filter((col: Collection) => normalize(col.name).includes(normalize(query.trim()))),
    [collections, query]
  );

  useEffect(() => {
    if (!open) return;
    void refreshCollections();
    setQuery('');
    setNewName('');
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, refreshCollections]);

  useEffect(() => setHighlight(0), [query]);

  const choose = (col: Collection) => {
    setActiveCollection(col);
    setOpen(false);
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && filtered[highlight]) { e.preventDefault(); choose(filtered[highlight]); }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const created = await handleCreateCollection(name);
    setCreating(false);
    if (created) choose(created);
  };

  return (
    <div ref={rootRef} className="relative" data-tour="collection-selector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={c.switcherTooltip}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 max-w-[220px] px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
      >
        <Layers className="w-3.5 h-3.5 text-primary-600 dark:text-primary-400 shrink-0" />
        <span className="truncate">{activeCollection?.name || c.empty}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl z-50 overflow-hidden">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder={c.searchPlaceholder}
                className="w-full pl-8 pr-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-xs text-slate-400">{c.noMatch}</li>}
            {filtered.map((col, i) => {
              const active = col.id === activeCollection?.id;
              return (
                <li key={col.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => choose(col)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left ${i === highlight ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-primary-600' : 'invisible'}`} />
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate text-xs font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-100'}`}>{col.name}</span>
                      <span className="block text-[10px] text-slate-400">
                        {tf(c.counts, { bookings: formatCount(col.booking_count), vessels: formatCount(col.vessel_count), containers: formatCount(col.container_count) })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <form onSubmit={create} className="flex items-center gap-1.5 p-2 border-t border-slate-100 dark:border-slate-800">
            <FolderPlus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder={c.newPlaceholder}
              className="flex-1 min-w-0 px-2 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button type="submit" disabled={!newName.trim() || creating} className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-40">
              {c.create}
            </button>
          </form>
          <button
            type="button"
            onClick={() => { setOpen(false); onManage(); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {c.manage}
          </button>
        </div>
      )}
    </div>
  );
};
```
Test "opens, filters" gõ `hải` và khớp "Kho Hải Phòng" nhờ `normalize` bỏ dấu (gõ `hai` cũng khớp).

Run: `cd frontend && npm test -- CollectionSwitcher`
Expected: PASS

- [ ] **Step 5: Viết lại `CollectionManagerModal.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { Check, Layers, Pencil, Trash2, X } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { tf } from '../../services/i18nFormat';
import type { Collection } from '../../types';
import { formatCount } from './CollectionSwitcher';

interface CollectionManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const formatDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
};

export const CollectionManagerModal: React.FC<CollectionManagerModalProps> = ({ isOpen, onClose }) => {
  const { t, collections, activeCollection, setActiveCollection, refreshCollections, handleDeleteCollection, handleRenameCollection } = useApp();
  const c = t.collections;
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      void refreshCollections();
      setEditingId(null);
    }
  }, [isOpen, refreshCollections]);

  useEffect(() => {
    if (editingId !== null) inputRef.current?.select();
  }, [editingId]);

  const startRename = (col: Collection) => {
    setEditingId(col.id);
    setDraft(col.name);
  };

  const saveRename = async (col: Collection) => {
    const name = draft.trim();
    if (!name || name === col.name) {
      setEditingId(null);
      return;
    }
    setBusyId(col.id);
    const ok = await handleRenameCollection(col.id, name);
    setBusyId(null);
    if (ok) setEditingId(null);
  };

  const remove = async (col: Collection) => {
    const ok = await confirm({
      title: tf(c.deleteTitle, { name: col.name }),
      message: tf(c.deleteMessage, {
        bookings: col.booking_count ?? 0, vessels: col.vessel_count ?? 0,
        containers: col.container_count ?? 0, watchlists: col.watchlist_count ?? 0,
      }),
      confirmText: c.deleteConfirm,
      danger: true,
    });
    if (!ok) return;
    setBusyId(col.id);
    await handleDeleteCollection(col.id);
    setBusyId(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={c.managerTitle} maxWidth="max-w-xl">
      {collections.length === 0 ? (
        <div className="py-10 text-center text-xs text-slate-400">{c.empty}</div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100 dark:divide-slate-800">
          {collections.map((col) => {
            const active = col.id === activeCollection?.id;
            const editing = editingId === col.id;
            return (
              <li key={col.id} className="group h-11 flex items-center gap-2.5 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <Layers className={`w-4 h-4 shrink-0 ${active ? 'text-primary-600' : 'text-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  {editing ? (
                    <form onSubmit={(e) => { e.preventDefault(); void saveRename(col); }} className="flex items-center gap-1">
                      <input
                        ref={inputRef}
                        value={draft}
                        maxLength={100}
                        aria-label={c.rename}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditingId(null); } }}
                        className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold border border-primary-400 rounded-md bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                      <button type="submit" disabled={busyId === col.id} aria-label={c.renameSave} className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} aria-label={t.common.cancel} className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className={`truncate text-xs font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-slate-800 dark:text-slate-100'}`}>{col.name}</span>
                      {active && <span className="shrink-0 text-[10px] font-bold px-1.5 rounded bg-primary-100 dark:bg-primary-900/60 text-primary-700 dark:text-primary-300">{c.active}</span>}
                      <span className="truncate text-[10px] text-slate-400">
                        {tf(c.counts, { bookings: formatCount(col.booking_count), vessels: formatCount(col.vessel_count), containers: formatCount(col.container_count) })}
                        {' · '}{tf(c.createdAt, { date: formatDate(col.created_at) })}
                      </span>
                    </div>
                  )}
                </div>
                {!editing && (
                  <div className="flex items-center gap-0.5 shrink-0 opacity-70 group-hover:opacity-100">
                    {!active && (
                      <button type="button" onClick={() => { setActiveCollection(col); onClose(); }} className="px-2 py-1 text-[11px] font-semibold rounded-md text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40">
                        {c.use}
                      </button>
                    )}
                    <button type="button" onClick={() => startRename(col)} title={c.rename} aria-label={c.rename} className="p-1.5 rounded-md text-slate-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/40">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(col)}
                      disabled={busyId === col.id || collections.length <= 1}
                      title={collections.length <= 1 ? c.lastOneHint : c.delete}
                      aria-label={c.delete}
                      className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
};
```
Chặn xoá bộ sưu tập cuối cùng: backend `lifespan` chỉ tạo "Default Collection" khi khởi động, nên xoá hết lúc đang chạy sẽ để app không có bộ sưu tập nào.


- [ ] **Step 6: Header**

`Header.tsx`:
- Xoá khối `{/* Collection Dropdown */}` (L134-172) và thay bằng:
```tsx
        <div className="pl-4 border-l border-slate-200 dark:border-slate-800 shrink-0">
          <CollectionSwitcher onManage={() => setIsCollectionManagerOpen(true)} />
        </div>
```
- Xoá state `isNewColOpen`, `newColName`, hàm `submitCreateCollection` (L65-71) và khối `{/* New Collection Modal */}` (L143-…); bỏ khỏi destructure `useApp()` các biến không còn dùng (`collections`, `setActiveCollection`, `handleCreateCollection`, `handleDeleteCollection` nếu không dùng ở chỗ khác — `tsc` sẽ báo nếu `noUnusedLocals` bật).
- Import `CollectionSwitcher` từ `./CollectionSwitcher`; bỏ import icon không còn dùng (`FolderPlus`, `Settings2`, `Layers` nếu không dùng nơi khác).
- `data-tour="collection-selector"` đã chuyển vào `CollectionSwitcher`; bước tour tại `services/tourService.ts:62` dùng đúng selector này nên không cần sửa tour.
- Modal quản lý: nếu kế hoạch C Task 9 đã lazy-load modal ở Header thì áp cùng mẫu cho `CollectionManagerModal` (render khi `isCollectionManagerOpen`).

- [ ] **Step 7: Build + thủ công**

Run: `cd frontend && npm test && npm run build`
Thủ công (`npm run dev`, có ≥ 3 bộ sưu tập):
1. Header chỉ còn một nút tên bộ sưu tập; nút không đẩy các nút bên phải xuống dòng ở cửa sổ 1280px.
2. Mở popover: có số lượng; gõ `hai` tìm ra "Kho Hải Phòng"; ↓ Enter chuyển; tab đang mở tải dữ liệu bộ sưu tập mới.
3. Tạo "Kho Test" trong popover → tự chuyển sang; tạo lại "kho test" → toast "Đã có bộ sưu tập tên …".
4. "Quản lý bộ sưu tập…" → đổi tên bộ sưu tập đang dùng → nút header đổi tên ngay, bảng **không** tải lại.
5. Xoá "Kho Test" → hộp xác nhận đỏ nêu đúng số booking/tàu/cont/theo dõi → xoá → nếu đang dùng thì tự chuyển sang bộ sưu tập khác.
6. Còn 1 bộ sưu tập → nút xoá bị mờ, tooltip "Cần giữ lại ít nhất một bộ sưu tập".
7. Chạy "Hướng dẫn" → bước chọn bộ sưu tập vẫn trỏ đúng nút.
Expected: đạt cả 7.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/context/AppContext.tsx frontend/src/components/common/CollectionSwitcher.tsx frontend/src/components/common/CollectionSwitcher.test.tsx frontend/src/components/common/CollectionManagerModal.tsx frontend/src/components/common/Header.tsx frontend/src/i18n/translations.ts
git commit -m "feat(collections-ui): compact switcher popover and manager with rename and counts

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, FileSpreadsheet, GripVertical, Loader2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { FilenameField } from './FilenameField';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { exportTemplatesApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { ExportColor, ExportColumn, ExportFill, ExportTab, ExportTemplate } from '../../types';
import {
  DEFAULT_HEADER, Draft, DraftColumn, EXPORT_PALETTE, TabColumn, buildDraft, buildExportRows, colorStyle,
  draftSignature, draftToColumns, moveColumnTo, normalizeHex, toggleIncluded,
} from './exportTemplates';

/** A saved template's id, or 'new' for one not saved yet */
export type ManagerSelection = number | 'new';

interface ManagerProps {
  isOpen: boolean;
  onClose: () => void;
  tab: ExportTab;
  allColumns: TabColumn[];
  /** A few rows for the preview */
  data: any[];
  templates: ExportTemplate[];
  /** Which template to open on */
  initial: ManagerSelection;
  defaultFilename: string;
  /** Fills {collection} in the file name preview */
  collectionName?: string;
  /** The list after a save or delete, and the template to select in the export dialog */
  onChanged: (list: ExportTemplate[], selectId: number | null) => void;
}

const PREVIEW_ROWS = 3;

/** Did the server store exactly these columns? */
export const sameColumns = (sent: ExportColumn[], stored: ExportColumn[]) =>
  JSON.stringify(sent.map(({ key, header, color, fill }) => [key, header, color ? color.toUpperCase() : null, fill]))
  === JSON.stringify(stored.map(({ key, header, color, fill }) => [key, header, color ? color.toUpperCase() : null, fill]));

export const errorText = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  return (typeof detail === 'string' && detail) || err?.message || fallback;
};

/** Create, edit, duplicate and delete the export templates of a tab. */
export const ExportTemplateManager: React.FC<ManagerProps> = ({
  isOpen, onClose, tab, allColumns, data, templates, initial, defaultFilename, collectionName, onChanged,
}) => {
  const { t, addToast } = useApp();
  const e = t.exportManager;
  const confirm = useConfirm();
  const defaults = useMemo(() => ({ name: e.newName, filename: defaultFilename }), [e.newName, defaultFilename]);
  const [selection, setSelection] = useState<ManagerSelection>('new');
  const [draft, setDraft] = useState<Draft>(() => buildDraft(null, allColumns, defaults));
  const [baseline, setBaseline] = useState('');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const dirty = selection === 'new' || draftSignature(draft) !== baseline;

  const load = useCallback((sel: ManagerSelection, list: ExportTemplate[], copyOf?: Draft) => {
    const template = typeof sel === 'number' ? list.find((x) => x.id === sel) || null : null;
    const next = copyOf || buildDraft(template, allColumns, defaults);
    setSelection(template ? sel : 'new');
    setDraft(next);
    setBaseline(template ? draftSignature(next) : '');
  }, [allColumns, defaults]);

  useEffect(() => {
    if (!isOpen) return;
    load(initial, templates);
    if (initial === 'new') requestAnimationFrame(() => nameRef.current?.select());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const leaveDraft = async () => !dirty || confirm({ message: e.discardConfirm, confirmText: e.discard, danger: true });

  const pick = async (sel: ManagerSelection) => {
    if (sel === selection) return;
    if (await leaveDraft()) load(sel, templates);
  };

  const startNew = async () => {
    if (await leaveDraft()) {
      load('new', templates);
      requestAnimationFrame(() => nameRef.current?.select());
    }
  };

  const duplicate = (template?: ExportTemplate) => {
    const base = template ? buildDraft(template, allColumns, defaults) : draft;
    load('new', templates, { ...base, name: `${base.name} ${e.copySuffix}` });
    requestAnimationFrame(() => nameRef.current?.select());
  };

  const close = async () => {
    if (await leaveDraft()) onClose();
  };

  const save = async () => {
    const input = { name: draft.name.trim(), filename: draft.filename.trim(), columns: draftToColumns(draft) };
    const editing = draft;
    setBusy('save');
    try {
      const saved = typeof selection === 'number'
        ? await exportTemplatesApi.update(selection, input)
        : await exportTemplatesApi.create(tab, input);
      const list = [...templates.filter((x) => x.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onChanged(list, saved.id);
      load(saved.id, list);
      if (!sameColumns(input.columns, saved.columns)) {
        // the server kept something else (e.g. an older backend dropping a custom colour): keep the edits on screen
        setDraft(editing);
        addToast(e.savedPartially, 'error');
        return;
      }
      addToast(tf(e.saved, { name: saved.name }), 'success');
    } catch (err) {
      addToast(errorText(err, t.common.error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (template: ExportTemplate) => {
    if (!(await confirm({ message: tf(e.deleteConfirm, { name: template.name }), confirmText: e.delete, danger: true }))) return;
    setBusy('delete');
    try {
      await exportTemplatesApi.remove(template.id);
      const list = templates.filter((x) => x.id !== template.id);
      onChanged(list, null);
      if (selection === template.id) load(list[0]?.id ?? 'new', list);
      addToast(tf(e.deleted, { name: template.name }), 'success');
    } catch (err) {
      addToast(errorText(err, t.common.error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const updateColumn = (key: string, patch: Partial<DraftColumn>) =>
    setDraft((d) => ({ ...d, columns: d.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) }));
  const setAll = (included: boolean) => setDraft((d) => ({ ...d, columns: d.columns.map((c) => ({ ...c, included })) }));
  const included = draft.columns.filter((c) => c.included);

  // Drag (pointer: mouse, pen or touch) among the ticked columns; keyboard: ↑ / ↓ on the handle
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= included.length) return;
    setDraft((d) => ({ ...d, columns: moveColumnTo(d.columns, from, to) }));
  };
  /** The ticked row under the pointer, from its data-index */
  const rowAt = (x: number, y: number): number | null => {
    const li = document.elementFromPoint(x, y)?.closest('li[data-index]') as HTMLElement | null;
    const i = li ? Number(li.dataset.index) : NaN;
    return Number.isInteger(i) && i < included.length ? i : null;
  };
  const dragStart = (i: number, ev: React.PointerEvent) => {
    if (ev.button > 0) return;   // right / middle button: no drag
    ev.preventDefault();
    try {
      // keep receiving moves while the pointer leaves the handle
      (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    } catch {
      /* a pointer that is no longer active cannot be captured: the drag still works over the handle */
    }
    setDragFrom(i);
    setDragOver(i);
  };
  const dragMove = (ev: React.PointerEvent) => {
    if (dragFrom === null) return;
    const i = rowAt(ev.clientX, ev.clientY);
    if (i !== null) setDragOver(i);
  };
  const dragEnd = () => {
    if (dragFrom !== null && dragOver !== null) move(dragFrom, dragOver);
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <Modal isOpen={isOpen} onClose={() => void close()} title={e.managerTitle} maxWidth="max-w-[1360px]">
      <div className="flex gap-5 h-[calc(90vh-7.5rem)] min-h-[440px]">
        {/* Templates */}
        <aside className="w-60 shrink-0 flex flex-col min-h-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">{e.templates}</div>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 p-0.5 pr-1.5">
            {templates.map((x) => (
              <TemplateItem
                key={x.id}
                template={x}
                active={selection === x.id}
                onSelect={() => void pick(x.id)}
                onDuplicate={() => duplicate(x)}
                onDelete={() => void remove(x)}
                busy={busy !== null}
              />
            ))}
            {selection === 'new' && (
              <div className="rounded-lg px-2.5 py-2 border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/50">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300 truncate">
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{draft.name || e.newName}</span>
                </span>
                <span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">{tf(e.columnsCount, { count: included.length })}</span>
              </div>
            )}
            {templates.length === 0 && selection !== 'new' && (
              <p className="px-1 text-[11px] text-slate-400">{e.noTemplates}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void startNew()}
            className="mt-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {e.newTemplate}
          </button>
        </aside>

        {/* Editor */}
        <section className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
          <div className="flex flex-wrap items-start gap-3">
            <label className="flex-1 min-w-[200px]">
              <span className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">{e.name}</span>
              <span className="flex items-center gap-2">
                <input
                  ref={nameRef}
                  type="text"
                  value={draft.name}
                  onChange={(ev) => update({ name: ev.target.value })}
                  placeholder={e.namePlaceholder}
                  aria-label={e.name}
                  className="flex-1 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500"
                />
                {dirty && (
                  <span className="shrink-0 rounded-full bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">{e.unsaved}</span>
                )}
              </span>
            </label>
            <div className="w-[26rem] max-w-full">
              <FilenameField
                label={e.defaultFilename}
                value={draft.filename}
                onChange={(filename) => update({ filename })}
                collectionName={collectionName}
                fallback={defaultFilename.replace(/_\{date\}$/, '')}
              />
            </div>
          </div>

          {/* Columns */}
          <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-[11px]">
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                {e.columns} · <span className="text-slate-500 dark:text-slate-400 font-medium">{tf(e.selectedCount, { count: included.length, total: draft.columns.length })}</span>
                <span className="ml-2 font-normal text-slate-400">{e.dragHint}</span>
              </span>
              <span className="flex items-center gap-2 font-semibold shrink-0">
                <button type="button" onClick={() => setAll(true)} className="text-primary-600 dark:text-primary-400 hover:underline">{e.selectAll}</button>
                <span className="text-slate-300">•</span>
                <button type="button" onClick={() => setAll(false)} className="text-slate-500 hover:underline">{e.selectNone}</button>
              </span>
            </div>
            <ul className={`flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 ${dragFrom !== null ? 'select-none cursor-grabbing' : ''}`}>
              {draft.columns.map((col, i) => (
                <ColumnRow
                  key={col.key}
                  col={col}
                  index={i}
                  dragging={dragFrom === i}
                  dropTarget={dragOver === i && dragFrom !== null && dragFrom !== i}
                  onToggle={() => setDraft((d) => ({ ...d, columns: toggleIncluded(d.columns, col.key) }))}
                  onChange={(patch) => updateColumn(col.key, patch)}
                  onKeyMove={(delta) => move(i, i + delta)}
                  onPointerDown={(ev) => dragStart(i, ev)}
                  onPointerMove={dragMove}
                  onPointerUp={dragEnd}
                  onPointerCancel={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                />
              ))}
            </ul>
          </div>

          {/* Preview */}
          <div className="shrink-0">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
              {e.preview} <span className="font-normal">· {tf(e.previewRows, { count: Math.min(PREVIEW_ROWS, data.length) })}</span>
            </div>
            <Preview columns={included} data={data} emptyText={e.noColumns} />
          </div>

          <div className="shrink-0 flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => duplicate()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Copy className="w-3.5 h-3.5" />
                {e.duplicate}
              </button>
              {typeof selection === 'number' && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    const x = templates.find((tpl) => tpl.id === selection);
                    if (x) void remove(x);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {e.delete}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void close()}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {e.close}
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={busy !== null || !dirty || included.length === 0 || !draft.name.trim()}
                className="flex items-center gap-1.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 px-4 py-2 text-xs font-semibold text-white shadow-sm"
              >
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {e.save}
              </button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
};

/** A template in a list: its name, column count, colour dots, and edit / duplicate / delete actions. */
export const TemplateItem: React.FC<{
  template: ExportTemplate;
  active: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}> = ({ template, active, onSelect, onEdit, onDuplicate, onDelete, busy, children }) => {
  const { t } = useApp();
  const e = t.exportManager;
  const action = 'p-1 rounded-md text-slate-400 hover:bg-white dark:hover:bg-slate-700 transition-colors';
  return (
    <div
      className={`group flex items-start gap-2 rounded-lg px-2.5 py-2 transition-colors ${
        active ? 'border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/50' : 'border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
      }`}
    >
      <button type="button" onClick={onSelect} className="flex-1 min-w-0 text-left">
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'}`}>
          <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{template.name}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
          {tf(e.columnsCount, { count: template.columns.length })}
          <span className="flex -space-x-0.5">
            {template.columns.filter((c) => c.color).slice(0, 6).map((c, i) => (
              <span key={i} className="w-2 h-2 rounded-full ring-1 ring-white dark:ring-slate-900" style={{ background: colorStyle(c.color)?.header }} />
            ))}
          </span>
        </span>
        {children}
      </button>
      <span className="flex items-center shrink-0">
        {onEdit && (
          <button type="button" onClick={onEdit} title={e.edit} aria-label={`${e.edit} ${template.name}`} className={`${action} hover:text-primary-600`}>
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {onDuplicate && (
          <button type="button" onClick={onDuplicate} title={e.duplicate} aria-label={`${e.duplicate} ${template.name}`} className={`${action} hover:text-primary-600`}>
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        <button type="button" onClick={onDelete} disabled={busy} title={e.delete} aria-label={`${e.delete} ${template.name}`} className={`${action} hover:text-rose-600`}>
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
};

/** One column in the editor: drag handle, tick, original name, new header, colour and fill. */
const ColumnRow: React.FC<{
  col: DraftColumn;
  index: number;
  dragging: boolean;
  dropTarget: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftColumn>) => void;
  onKeyMove: (delta: -1 | 1) => void;
  onPointerDown: (ev: React.PointerEvent) => void;
  onPointerMove: (ev: React.PointerEvent) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
}> = ({ col, index, dragging, dropTarget, onToggle, onChange, onKeyMove, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) => {
  const { t } = useApp();
  const e = t.exportManager;
  const off = !col.included;
  return (
    <li
      data-index={index}
      className={`flex items-center gap-2.5 px-2 py-1.5 transition-colors ${off ? 'bg-slate-50/60 dark:bg-slate-900/40' : ''} ${
        dragging ? 'opacity-40' : ''
      } ${dropTarget ? 'shadow-[inset_0_2px_0_0] shadow-primary-500 bg-primary-50/40 dark:bg-primary-950/20' : ''}`}
    >
      <button
        type="button"
        disabled={off}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ touchAction: 'none' }}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
            ev.preventDefault();
            onKeyMove(ev.key === 'ArrowUp' ? -1 : 1);
          }
        }}
        aria-label={`${e.dragHandle}: ${col.label}`}
        title={e.dragHandle}
        className="shrink-0 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-grab active:cursor-grabbing disabled:opacity-25 disabled:cursor-default focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <GripVertical className="w-4 h-4" />
      </button>
      <label className="flex items-center gap-2 w-48 shrink-0 min-w-0 cursor-pointer">
        <input
          type="checkbox"
          checked={col.included}
          onChange={onToggle}
          className="rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
        />
        <span className={`truncate text-xs ${off ? 'text-slate-400 dark:text-slate-500' : 'font-semibold text-slate-700 dark:text-slate-200'}`} title={col.label}>
          {col.label}
        </span>
      </label>
      <input
        type="text"
        value={col.header}
        onChange={(ev) => onChange({ header: ev.target.value })}
        disabled={off}
        placeholder={e.renamePlaceholder}
        aria-label={`${col.label}: ${e.renamePlaceholder}`}
        className="flex-1 min-w-0 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 disabled:opacity-40 focus:ring-2 focus:ring-primary-500"
      />
      <ColorPicker value={col.color} disabled={off} onChange={(color) => onChange({ color })} label={col.label} />
      <FillToggle value={col.fill} disabled={off || !col.color} onChange={(fill) => onChange({ fill })} />
    </li>
  );
};

const FillToggle: React.FC<{ value: ExportFill; disabled: boolean; onChange: (fill: ExportFill) => void }> = ({ value, disabled, onChange }) => {
  const { t } = useApp();
  const e = t.exportManager;
  return (
    <span role="group" title={e.fillHint} className={`shrink-0 inline-flex rounded-md border border-slate-200 dark:border-slate-700 p-0.5 ${disabled ? 'opacity-40' : ''}`}>
      {([['header', e.fillHeader], ['column', e.fillColumn]] as const).map(([fill, label]) => (
        <button
          key={fill}
          type="button"
          disabled={disabled}
          aria-pressed={value === fill}
          onClick={() => onChange(fill)}
          className={`rounded px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
            value === fill && !disabled ? 'bg-primary-600 text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </span>
  );
};

const POPOVER_WIDTH = 224;

/** Swatch button opening the palette, a colour slider and a hex code field. */
export const ColorPicker: React.FC<{ value: ExportColor | null; disabled: boolean; label: string; onChange: (c: ExportColor | null) => void }> = ({
  value, disabled, label, onChange,
}) => {
  const { t } = useApp();
  const e = t.exportManager;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const current = colorStyle(value);
  const [hexText, setHexText] = useState('');

  useEffect(() => {
    if (open) setHexText(current?.header || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    const h = panelRef.current?.offsetHeight ?? 190;
    const left = Math.min(Math.max(8, r.right - POPOVER_WIDTH), window.innerWidth - POPOVER_WIDTH - 8);
    const top = r.bottom + 4 + h > window.innerHeight - 8 ? r.top - h - 4 : r.bottom + 4;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (!panelRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (c: ExportColor | null, keepOpen = false) => {
    onChange(c);
    if (!keepOpen) setOpen(false);
  };
  const hexValid = !!normalizeHex(hexText);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={`${e.colorTitle}: ${label}`}
        title={e.colorTitle}
        onClick={() => setOpen((v) => !v)}
        className="shrink-0 w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:ring-2 hover:ring-primary-200 disabled:opacity-40 disabled:hover:ring-0"
      >
        {current ? (
          <span className="w-4 h-4 rounded" style={{ background: current.header }} />
        ) : (
          <span className="w-4 h-4 rounded border border-dashed border-slate-300 dark:border-slate-600" />
        )}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={e.colorTitle}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: POPOVER_WIDTH }}
          className="fixed z-[1000] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl p-2.5 space-y-2.5"
        >
          <div className="grid grid-cols-5 gap-1.5">
            {EXPORT_PALETTE.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-label={p.id}
                onClick={() => choose(p.id)}
                className={`w-8 h-8 rounded-md flex items-center justify-center hover:scale-110 transition-transform ${value === p.id ? 'ring-2 ring-offset-1 ring-primary-500 dark:ring-offset-slate-900' : ''}`}
                style={{ background: p.header }}
              >
                {value === p.id && <Check className="w-3.5 h-3.5" style={{ color: p.text }} />}
              </button>
            ))}
          </div>
          <div>
            <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mb-1">{e.customColor}</div>
            <div className="flex items-center gap-1.5">
              <input
                type="color"
                aria-label={e.colorSlider}
                value={normalizeHex(hexText) || current?.header || '#2980B9'}
                onChange={(ev) => {
                  setHexText(ev.target.value.toUpperCase());
                  choose(normalizeHex(ev.target.value), true);
                }}
                className="w-9 h-8 shrink-0 cursor-pointer rounded-md border border-slate-200 dark:border-slate-700 bg-transparent p-0.5"
              />
              <input
                type="text"
                value={hexText}
                aria-label={e.hexCode}
                placeholder="#1E88E5"
                maxLength={7}
                onChange={(ev) => setHexText(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' && hexValid) choose(normalizeHex(hexText));
                }}
                className={`flex-1 min-w-0 rounded-md border px-2 py-1 text-xs font-mono uppercase bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 ${
                  hexText && !hexValid ? 'border-rose-300' : 'border-slate-200 dark:border-slate-700'
                }`}
              />
              <button
                type="button"
                disabled={!hexValid}
                onClick={() => choose(normalizeHex(hexText))}
                className="shrink-0 rounded-md bg-primary-600 hover:bg-primary-700 disabled:opacity-40 px-2 py-1 text-[11px] font-semibold text-white"
              >
                {e.apply}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => choose(null)}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {e.noColor}
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};

/** A few real rows as the file will look: headers renamed, colours applied. */
export const Preview: React.FC<{
  columns: DraftColumn[];
  data: any[];
  emptyText: string;
  rows?: number;
  /** Size of the scroll box */
  className?: string;
}> = ({ columns, data, emptyText, rows: rowCount = PREVIEW_ROWS, className = 'max-h-32' }) => {
  if (columns.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 px-3 py-3 text-center text-xs text-slate-500">{emptyText}</p>;
  }
  const rows = buildExportRows(data.slice(0, rowCount), columns);
  return (
    <div className={`overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 ${className}`}>
      <table className="text-[11px] border-collapse">
        <thead>
          <tr>
            {columns.map((c) => {
              const p = colorStyle(c.color);
              return (
                <th
                  key={c.key}
                  className="sticky top-0 px-2.5 py-1.5 font-bold whitespace-nowrap border-r border-white/30 text-center"
                  style={{ background: p?.header || DEFAULT_HEADER.header, color: p?.text || DEFAULT_HEADER.text }}
                >
                  {c.header.trim() || c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {columns.map((c, i) => {
                const p = colorStyle(c.color);
                const tint = p && c.fill === 'column' ? p.tint : i % 2 ? '#F2F7FA' : '#FFFFFF';
                return (
                  <td key={c.key} className="px-2.5 py-1 whitespace-nowrap border border-slate-200 text-slate-700 max-w-[200px] truncate" style={{ background: tint }}>
                    {String(row[c.key])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

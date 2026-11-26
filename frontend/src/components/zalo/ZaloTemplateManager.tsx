import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, Loader2, MessageSquareText, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { useConfirm } from '../../hooks/useConfirm';
import { createZaloTemplate, deleteZaloTemplate, updateZaloTemplate } from '../../services/zaloApi';
import type { ZaloTemplate } from '../../types';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_FIELDS,
  categoryOf,
  normalizeShortcut,
  searchTemplates,
  unknownFields,
} from './zaloTemplates';

export type TemplateSelection = number | 'new';

interface Draft {
  name: string;
  shortcut: string;
  category: string;
  content: string;
}

const EMPTY: Draft = { name: '', shortcut: '', category: 'general', content: '' };
const toDraft = (t: ZaloTemplate | undefined): Draft =>
  t ? { name: t.name, shortcut: t.shortcut, category: t.category || 'general', content: t.content } : EMPTY;
const sig = (d: Draft) => JSON.stringify([d.name.trim(), normalizeShortcut(d.shortcut), d.category, d.content]);

interface Props {
  isOpen: boolean;
  onClose: () => void;
  templates: ZaloTemplate[];
  initial: TemplateSelection;
  /** Values from the open chat, shown in the preview instead of sample ones */
  chatValues: { driver_name?: string; vehicle_plate?: string };
  /** Reload the list after a save or delete */
  onChanged: () => Promise<void> | void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const errorText = (err: any, fallback: string) => {
  const detail = err?.response?.data?.detail;
  return (typeof detail === 'string' && detail) || fallback;
};

/** Create, edit, duplicate and delete the Zalo quick-message templates. */
export const ZaloTemplateManager: React.FC<Props> = ({ isOpen, onClose, templates, initial, chatValues, onChanged, addToast }) => {
  const rawConfirm = useConfirm();
  // While a confirm dialog is up, this dialog's own Esc / Cmd+S handling stays out of its way.
  const askingRef = useRef(false);
  const confirm: typeof rawConfirm = async (opts) => {
    askingRef.current = true;
    try {
      return await rawConfirm(opts);
    } finally {
      askingRef.current = false;
    }
  };
  const [selection, setSelection] = useState<TemplateSelection>('new');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [baseline, setBaseline] = useState(sig(EMPTY));
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const dirty = sig(draft) !== baseline;

  const select = (sel: TemplateSelection, from?: Draft) => {
    const tpl = typeof sel === 'number' ? templates.find((t) => t.id === sel) : undefined;
    const next = from || toDraft(tpl);
    setSelection(tpl ? sel : 'new');
    setDraft(next);
    setBaseline(tpl ? sig(next) : sig(EMPTY));
    if (!tpl) requestAnimationFrame(() => nameRef.current?.focus());
  };

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setCategory(null);
    select(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const leaveDraft = async () =>
    !dirty || confirm({ title: 'Bỏ thay đổi?', message: 'Mẫu đang sửa chưa được lưu.', confirmText: 'Bỏ thay đổi', danger: true });

  const pick = async (sel: TemplateSelection, from?: Draft) => {
    if (sel === selection && !from) return;
    if (await leaveDraft()) select(sel, from);
  };

  const close = async () => {
    if (busy) return;
    if (await leaveDraft()) onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (askingRef.current || e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const visible = useMemo(() => searchTemplates(templates, query, category), [templates, query, category]);
  const shortcut = normalizeShortcut(draft.shortcut);
  const shortcutTaken = !!shortcut && templates.some((t) => t.id !== selection && t.shortcut.toLowerCase() === shortcut);
  const unknown = useMemo(() => unknownFields(draft.content), [draft.content]);
  const canSave = !!draft.name.trim() && !!draft.content.trim() && !shortcutTaken && dirty && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy('save');
    const payload = { name: draft.name.trim(), shortcut, category: draft.category, content: draft.content };
    try {
      const saved =
        selection === 'new' ? await createZaloTemplate(payload) : await updateZaloTemplate(selection, payload);
      await onChanged();
      setSelection(saved.id);
      const next = toDraft(saved);
      setDraft(next);
      setBaseline(sig(next));
      addToast(selection === 'new' ? `Đã thêm mẫu "${saved.name}"` : `Đã lưu mẫu "${saved.name}"`, 'success');
    } catch (err) {
      addToast(errorText(err, 'Không lưu được mẫu tin nhắn'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (selection === 'new') return;
    const ok = await confirm({
      title: 'Xóa mẫu tin nhắn?',
      message: `Mẫu "${draft.name || 'không tên'}" sẽ bị xóa vĩnh viễn.`,
      confirmText: 'Xóa mẫu',
      danger: true,
    });
    if (!ok) return;
    setBusy('delete');
    try {
      await deleteZaloTemplate(selection);
      await onChanged();
      select('new');
      addToast('Đã xóa mẫu tin nhắn', 'success');
    } catch (err) {
      addToast(errorText(err, 'Không xóa được mẫu tin nhắn'), 'error');
    } finally {
      setBusy(null);
    }
  };

  const duplicate = () =>
    pick('new', { ...draft, name: `${draft.name} (bản sao)`, shortcut: shortcut ? `${shortcut}-2` : '' });

  const insertField = (key: string) => {
    const el = contentRef.current;
    const token = `{${key}}`;
    const start = el ? el.selectionStart : draft.content.length;
    const end = el ? el.selectionEnd : draft.content.length;
    const content = draft.content.slice(0, start) + token + draft.content.slice(end);
    setDraft((d) => ({ ...d, content }));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  // Preview: chat fields from the open chat (or samples), booking fields stay marked until a booking fills them.
  const preview = useMemo(() => {
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const m of draft.content.matchAll(/\{([^{}\s]+)\}/g)) {
      const at = m.index ?? 0;
      parts.push(draft.content.slice(last, at));
      const field = TEMPLATE_FIELDS.find((f) => f.key === m[1]);
      const chatValue = field?.source === 'chat' ? chatValues[field.key as keyof typeof chatValues] : undefined;
      if (!field) {
        parts.push(<mark key={at} className="bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 rounded px-0.5">{m[0]}</mark>);
      } else if (field.source === 'chat') {
        parts.push(<span key={at} className="font-semibold text-emerald-700 dark:text-emerald-400">{chatValue || field.sample}</span>);
      } else {
        parts.push(<span key={at} className="rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 px-1">{field.sample}</span>);
      }
      last = at + m[0].length;
    }
    parts.push(draft.content.slice(last));
    return parts;
  }, [draft.content, chatValues]);

  if (!isOpen) return null;

  const inputCls =
    'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500';
  const labelCls = 'block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={close} />
      <div
        role="dialog"
        aria-label="Quản lý mẫu tin nhắn nhanh"
        className="relative z-10 w-full max-w-5xl h-[min(680px,90vh)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Mẫu tin nhắn nhanh</h3>
            <span className="text-[11px] text-slate-400">{templates.length} mẫu</span>
          </div>
          <button onClick={close} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer" title="Đóng (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* List */}
          <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 flex flex-col min-h-0 bg-slate-50/60 dark:bg-slate-950/40">
            <div className="p-3 space-y-2 border-b border-slate-200 dark:border-slate-800">
              <button
                onClick={() => pick('new')}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> Mẫu mới
              </button>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên, phím tắt, nội dung..." className={`${inputCls} pl-8 py-1.5`} />
              </div>
              <div className="flex flex-wrap gap-1">
                {[{ id: null as string | null, label: 'Tất cả' }, ...TEMPLATE_CATEGORIES].map((c) => (
                  <button
                    key={c.id ?? 'all'}
                    onClick={() => setCategory(c.id)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-medium cursor-pointer ${
                      category === c.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-blue-400'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <ul className="flex-1 overflow-y-auto p-2 space-y-1">
              {selection === 'new' && (
                <li className="rounded-lg border border-dashed border-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                  <div className="text-xs font-semibold text-blue-700 dark:text-blue-300 truncate">{draft.name.trim() || 'Mẫu mới (chưa lưu)'}</div>
                </li>
              )}
              {visible.map((t) => {
                const cat = categoryOf(t.category);
                const active = t.id === selection;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => pick(t.id)}
                      className={`w-full text-left rounded-lg px-3 py-2 border cursor-pointer transition-colors ${
                        active
                          ? 'bg-white dark:bg-slate-800 border-blue-500 ring-1 ring-blue-500'
                          : 'border-transparent hover:bg-white dark:hover:bg-slate-800/70 hover:border-slate-200 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cat.dot}`} title={cat.label} />
                        <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate flex-1">
                          {t.name}
                          {active && dirty && <span className="text-amber-500"> •</span>}
                        </span>
                        {t.shortcut && <code className="text-[10px] text-slate-400 shrink-0">{t.shortcut}</code>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 whitespace-pre-line">{t.content}</div>
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 && (
                <li className="px-3 py-6 text-center text-[11px] text-slate-400">
                  {templates.length === 0 ? 'Chưa có mẫu nào.' : 'Không có mẫu khớp.'}
                </li>
              )}
            </ul>
          </aside>

          {/* Editor */}
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-[1fr_180px_150px] gap-3">
                <div>
                  <label className={labelCls} htmlFor="tpl-name">Tên mẫu *</label>
                  <input id="tpl-name" ref={nameRef} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="vd: Báo lấy rỗng" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tpl-shortcut">Phím tắt</label>
                  <input
                    id="tpl-shortcut"
                    value={draft.shortcut}
                    onChange={(e) => setDraft({ ...draft, shortcut: e.target.value })}
                    onBlur={() => setDraft((d) => ({ ...d, shortcut: normalizeShortcut(d.shortcut) }))}
                    placeholder="/lay-rong"
                    className={`${inputCls} font-mono ${shortcutTaken ? 'border-rose-500 focus:ring-rose-500' : ''}`}
                  />
                </div>
                <div>
                  <label className={labelCls} htmlFor="tpl-category">Nhóm</label>
                  <select id="tpl-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={inputCls}>
                    {TEMPLATE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              {shortcutTaken ? (
                <p className="-mt-2 text-[11px] text-rose-600 dark:text-rose-400">Phím tắt {shortcut} đã dùng cho mẫu khác.</p>
              ) : (
                <p className="-mt-2 text-[11px] text-slate-400">
                  Gõ phím tắt vào ô soạn tin (vd <code>{shortcut || '/lay-rong'}</code>) rồi nhấn Tab hoặc Enter để chèn mẫu.
                </p>
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className={labelCls + ' mb-0'} htmlFor="tpl-content">Nội dung *</label>
                  <span className="text-[10px] text-slate-400">{draft.content.length} ký tự</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 mb-1.5">
                  <span className="text-[10px] text-slate-400 mr-0.5">Chèn ô:</span>
                  {TEMPLATE_FIELDS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => insertField(f.key)}
                      title={`{${f.key}} — ${f.source === 'chat' ? 'lấy từ hội thoại' : 'điền khi bấm "Chèn vào tin" ở booking'}`}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer ${
                        f.source === 'chat'
                          ? 'border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:bg-emerald-950/40'
                          : 'border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:bg-amber-950/40'
                      }`}
                    >
                      + {f.label}
                    </button>
                  ))}
                </div>
                <textarea
                  id="tpl-content"
                  ref={contentRef}
                  rows={7}
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  placeholder={'Chào anh {driver_name} ({vehicle_plate}),\n...'}
                  className={`${inputCls} font-mono leading-relaxed resize-y`}
                />
                {unknown.length > 0 && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="w-3 h-3" />
                    Ô không có dữ liệu để điền: {unknown.map((u) => `{${u}}`).join(', ')} — tin sẽ không gửi được cho tới khi sửa tay.
                  </p>
                )}
              </div>

              <div>
                <div className={labelCls}>Xem trước</div>
                <div className="rounded-xl bg-blue-50 dark:bg-slate-800 border border-blue-100 dark:border-slate-700 p-3 text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap min-h-[64px] max-w-xl">
                  {draft.content.trim() ? preview : <span className="text-slate-400">Nội dung mẫu sẽ hiện ở đây.</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-slate-400">
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1" />Từ hội thoại đang mở{chatValues.driver_name ? '' : ' (giá trị mẫu)'}</span>
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />Điền khi chèn booking (giá trị mẫu)</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2">
              {selection !== 'new' && (
                <>
                  <button onClick={remove} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 cursor-pointer">
                    {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Xóa
                  </button>
                  <button onClick={duplicate} disabled={!!busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer">
                    <Copy className="w-3.5 h-3.5" /> Nhân bản
                  </button>
                </>
              )}
              <div className="flex-1" />
              {dirty && selection !== 'new' && (
                <button onClick={() => select(selection)} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
                  Hoàn tác
                </button>
              )}
              <button
                onClick={save}
                disabled={!canSave}
                title="Lưu (⌘S / Ctrl+S)"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
              >
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {selection === 'new' ? 'Thêm mẫu' : 'Lưu thay đổi'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

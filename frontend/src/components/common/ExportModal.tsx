import React, { useEffect, useMemo, useState } from 'react';
import { Download, Layers, Loader2, Plus, Settings2 } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { useConfirm } from '../../hooks/useConfirm';
import { exportColumnsExcelApi, exportTemplatesApi } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import type { ExportColumn, ExportTab, ExportTemplate } from '../../types';
import { TabColumn, buildDraft, buildExportRows, draftToColumns, resolveFilename } from './exportTemplates';
import { ExportTemplateManager, ManagerSelection, Preview, TemplateItem, errorText } from './ExportTemplateManager';
import { FilenameField } from './FilenameField';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  allColumns: TabColumn[];
  /** Which tab's templates to offer */
  tab: ExportTab;
  /** File name of the built-in template */
  filenamePrefix?: string;
  /** Fills {collection} in file names */
  collectionName?: string;
}

/** Rows shown in the preview before exporting */
const PREVIEW_ROWS = 10;

/** A saved template's id, or 'all' for the built-in "every column" one */
type Choice = number | 'all';

const lastTemplateKey = (tab: ExportTab) => `export_template_${tab}`;
const readLast = (tab: ExportTab): Choice => {
  try {
    const v = localStorage.getItem(lastTemplateKey(tab));
    return v && /^\d+$/.test(v) ? Number(v) : 'all';
  } catch {
    return 'all';
  }
};
const writeLast = (tab: ExportTab, choice: Choice) => {
  try {
    localStorage.setItem(lastTemplateKey(tab), String(choice));
  } catch {
    /* only a convenience */
  }
};

/** Export dialog: pick a template, name the file, export. Templates are made and edited in their own window. */
export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen, onClose, data, allColumns, tab, filenamePrefix = 'export_data', collectionName,
}) => {
  const { t, addToast } = useApp();
  const e = t.exportManager;
  const confirm = useConfirm();
  const builtInFilename = `${filenamePrefix}_{date}`;

  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [choice, setChoice] = useState<Choice>('all');
  const [fileName, setFileName] = useState(builtInFilename);
  const [busy, setBusy] = useState(false);
  const [manager, setManager] = useState<ManagerSelection | null>(null);

  const chosen = typeof choice === 'number' ? templates.find((x) => x.id === choice) || null : null;
  const select = (next: Choice, list = templates) => {
    const template = typeof next === 'number' ? list.find((x) => x.id === next) || null : null;
    setChoice(template ? next : 'all');
    setFileName(template?.filename || builtInFilename);
  };

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    exportTemplatesApi.list(tab)
      .then((list) => {
        if (!alive) return;
        setTemplates(list);
        select(readLast(tab), list);
      })
      .catch(() => {
        if (!alive) return;
        addToast(e.loadFailed, 'error');
        select('all', []);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tab]);

  /** The chosen template's columns with their headers (blank = the table's label). */
  const columns: ExportColumn[] = useMemo(() => {
    const draft = buildDraft(chosen, allColumns, { name: '', filename: '' });
    return draftToColumns(draft).map((c) => ({ ...c, header: c.header || allColumns.find((a) => a.key === c.key)?.label || c.key }));
  }, [chosen, allColumns]);

  const remove = async (template: ExportTemplate) => {
    if (!(await confirm({ message: tf(e.deleteConfirm, { name: template.name }), confirmText: e.delete, danger: true }))) return;
    try {
      await exportTemplatesApi.remove(template.id);
      const list = templates.filter((x) => x.id !== template.id);
      setTemplates(list);
      if (choice === template.id) select('all', list);
      addToast(tf(e.deleted, { name: template.name }), 'success');
    } catch (err) {
      addToast(errorText(err, t.common.error), 'error');
    }
  };

  const doExport = async () => {
    if (data.length === 0) return addToast(e.noData, 'error');
    if (columns.length === 0) return addToast(e.noColumns, 'error');
    const file = resolveFilename(fileName, { collection: collectionName, fallback: filenamePrefix });
    setBusy(true);
    try {
      const blob = await exportColumnsExcelApi(buildExportRows(data, columns), columns, file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
      writeLast(tab, choice);
      addToast(tf(e.exported, { file }), 'success');
      onClose();
    } catch (err) {
      addToast(errorText(err, t.common.error), 'error');
    } finally {
      setBusy(false);
    }
  };


  /** The template's headers on one line (the preview on the right shows them in full). */
  const headerSummary = (cols: ExportColumn[]) => {
    const names = cols.map((c) => c.header || allColumns.find((a) => a.key === c.key)?.label || c.key).join(', ');
    return (
      <span className="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400" title={names}>
        {names}
      </span>
    );
  };

  /** The chosen template's columns for the preview (table labels where no header was given). */
  const previewColumns = useMemo(
    () => buildDraft(chosen, allColumns, { name: '', filename: '' }).columns.filter((c) => c.included),
    [chosen, allColumns],
  );

  return (
    <>
      <Modal isOpen={isOpen && manager === null} onClose={onClose} title={e.title} maxWidth="max-w-[1280px]">
        <div className="flex gap-5 h-[calc(90vh-7.5rem)] min-h-[420px]">
          {/* Templates */}
          <aside className="w-[340px] shrink-0 flex flex-col min-h-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{e.chooseTemplate}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setManager(typeof choice === 'number' ? choice : templates[0]?.id ?? 'new')}
                  title={e.manage}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  {e.manage}
                </button>
                <button
                  type="button"
                  onClick={() => setManager('new')}
                  className="flex items-center gap-1 rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/40 px-2 py-1 text-[11px] font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {e.newTemplate}
                </button>
              </span>
            </div>

            <div role="radiogroup" aria-label={e.chooseTemplate} className="flex-1 min-h-0 overflow-y-auto space-y-1.5 p-0.5 pr-1.5">
              <button
                type="button"
                role="radio"
                aria-checked={choice === 'all'}
                onClick={() => select('all')}
                className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                  choice === 'all'
                    ? 'border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/50'
                    : 'border border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/70'
                }`}
              >
                <span className={`flex items-center gap-1.5 text-xs font-semibold ${choice === 'all' ? 'text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'}`}>
                  <Layers className="w-3.5 h-3.5" />
                  {e.builtIn}
                  <span className="font-normal text-[10px] text-slate-400">· {tf(e.columnsCount, { count: allColumns.length })}</span>
                </span>
              </button>
              {templates.map((x) => (
                <div key={x.id} role="radio" aria-checked={choice === x.id}>
                  <TemplateItem
                    template={x}
                    active={choice === x.id}
                    onSelect={() => select(x.id)}
                    onEdit={() => setManager(x.id)}
                    onDelete={() => void remove(x)}
                  >
                    {headerSummary(x.columns)}
                  </TemplateItem>
                </div>
              ))}
              {templates.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 px-3 py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                  {e.noTemplatesHint}
                </p>
              )}
            </div>
          </aside>

          {/* Preview of the file + file name + export */}
          <section className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{e.filePreview}</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {tf(e.filePreviewInfo, { shown: Math.min(PREVIEW_ROWS, data.length), rows: data.length, columns: previewColumns.length })}
              </span>
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              <Preview columns={previewColumns} data={data} emptyText={e.noColumns} rows={PREVIEW_ROWS} className="flex-1 min-h-0" />
            </div>

            <div className="shrink-0 pt-3 border-t border-slate-100 dark:border-slate-800">
              <FilenameField
                label={e.filename}
                value={fileName}
                onChange={setFileName}
                collectionName={collectionName}
                fallback={filenamePrefix}
              />
            </div>

            <div className="shrink-0 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {tf(e.rows, { count: data.length })} · {tf(e.columnsCount, { count: columns.length })}
              </span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {t.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => void doExport()}
                  disabled={busy || columns.length === 0 || data.length === 0}
                  className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-4 py-2 text-xs font-semibold text-white shadow-sm"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  {busy ? e.exporting : e.export}
                </button>
              </span>
            </div>
          </section>
        </div>
      </Modal>

      <ExportTemplateManager
        isOpen={isOpen && manager !== null}
        onClose={() => setManager(null)}
        tab={tab}
        allColumns={allColumns}
        data={data}
        templates={templates}
        initial={manager ?? 'new'}
        defaultFilename={builtInFilename}
        collectionName={collectionName}
        onChanged={(list, selectId) => {
          setTemplates(list);
          if (selectId !== null) select(selectId, list);
          else if (typeof choice === 'number' && !list.some((x) => x.id === choice)) select('all', list);
        }}
      />
    </>
  );
};

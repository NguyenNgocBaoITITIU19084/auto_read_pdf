import React, { useEffect, useMemo, useState } from 'react';
import { Layers, MoveRight, Copy, Loader2, Check } from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { moveItemsToCollection } from '../../services/api';
import { tf } from '../../services/i18nFormat';
import { BulkEntity } from '../../types';

export interface MoveToCollectionResult {
  moved: number;
  targetCollectionId: number;
  copy: boolean;
}

export interface MoveToCollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  entity: BulkEntity;
  ids: number[];
  /** Called after a successful move/copy (before onClose). Reload data / clear selection here. */
  onDone?: (result: MoveToCollectionResult) => void;
}

export const MoveToCollectionModal: React.FC<MoveToCollectionModalProps> = ({
  isOpen,
  onClose,
  entity,
  ids,
  onDone,
}) => {
  const { t, collections, activeCollection, addToast } = useApp();
  const [targetId, setTargetId] = useState<number | null>(null);
  const [copy, setCopy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const targets = useMemo(
    () => collections.filter((c) => c.id !== activeCollection?.id),
    [collections, activeCollection]
  );

  useEffect(() => {
    if (isOpen) {
      setTargetId((prev) => (prev !== null && targets.some((c) => c.id === prev) ? prev : targets[0]?.id ?? null));
      setSubmitting(false);
    }
  }, [isOpen, targets]);

  const entityLabel =
    entity === 'bookings' ? t.bulk.entityBookings : entity === 'vessels' ? t.bulk.entityVessels : t.bulk.entityContainers;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (targetId === null || ids.length === 0 || submitting) return;
    const target = targets.find((c) => c.id === targetId);
    try {
      setSubmitting(true);
      const res = await moveItemsToCollection(entity, ids, targetId, copy);
      const moved = typeof res?.moved === 'number' ? res.moved : ids.length;
      addToast(
        tf(copy ? t.bulk.copySuccess : t.bulk.moveSuccess, { count: moved, name: target?.name || '' }),
        'success'
      );
      onDone?.({ moved, targetCollectionId: targetId, copy });
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      addToast((typeof detail === 'string' && detail) || err?.message || t.common.error, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={submitting ? () => undefined : onClose} title={t.bulk.moveTitle} maxWidth="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {tf(t.bulk.selectedCount, { count: ids.length })} {entityLabel}
          {activeCollection ? ` · ${activeCollection.name}` : ''}
        </p>

        {/* Move / copy toggle */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: false, label: t.bulk.modeMove, desc: t.bulk.modeMoveDesc, Icon: MoveRight },
            { value: true, label: t.bulk.modeCopy, desc: t.bulk.modeCopyDesc, Icon: Copy },
          ].map(({ value, label, desc, Icon }) => {
            const active = copy === value;
            return (
              <button
                key={String(value)}
                type="button"
                onClick={() => setCopy(value)}
                aria-pressed={active}
                className={`text-left p-2.5 rounded-xl border transition-all ${
                  active
                    ? 'border-primary-500 ring-2 ring-primary-500/20 bg-primary-50/60 dark:bg-primary-950/40'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
                  <Icon className={`w-3.5 h-3.5 ${active ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`} />
                  {label}
                </span>
                <span className="block mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{desc}</span>
              </button>
            );
          })}
        </div>

        {/* Target collection list */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400">{t.bulk.targetCollection}</label>
          {targets.length === 0 ? (
            <div className="text-center py-6 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
              {t.bulk.noOtherCollections}
            </div>
          ) : (
            <div role="radiogroup" className="max-h-64 overflow-y-auto space-y-1 pr-1">
              {targets.map((col) => {
                const selected = targetId === col.id;
                return (
                  <button
                    key={col.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTargetId(col.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-left transition-colors ${
                      selected
                        ? 'border-primary-400 dark:border-primary-600 bg-primary-50 dark:bg-primary-950/50'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Layers className={`w-4 h-4 shrink-0 ${selected ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`} />
                    <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {col.name}
                    </span>
                    {selected && <Check className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitting || targetId === null || ids.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl text-white bg-primary-600 hover:bg-primary-700 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : copy ? (
              <Copy className="w-3.5 h-3.5" />
            ) : (
              <MoveRight className="w-3.5 h-3.5" />
            )}
            <span>{tf(copy ? t.bulk.submitCopy : t.bulk.submitMove, { count: ids.length })}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
};

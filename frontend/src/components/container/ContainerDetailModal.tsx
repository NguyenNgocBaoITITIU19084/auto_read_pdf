import React from 'react';
import { Copy, Check, Box, Clock, CheckCircle2, MapPin, Anchor, ShieldCheck, ChevronRight, AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ContainerInfo } from '../../types';
import { useApp } from '../../context/AppContext';
import { formatTimeAgo, isRecentUpdate } from '../../utils/formatters';
import { getPortDisplayName } from '../../utils/ports';
import { ValueBadge } from '../common/ValueBadge';
import { copyTextToClipboard } from '../../utils/formatters';
import { CustomsStatusBadge, ImdgLink, getCustomsStatus, getImdgInfo, sanitizeDisplayValue } from './customs';

interface ContainerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  container: ContainerInfo | null;
}

export const ContainerDetailModal: React.FC<ContainerDetailModalProps> = ({
  isOpen,
  onClose,
  container,
}) => {
  const { t, language, addToast } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!container) return null;

  const copyField = (val: string, keyName: string) => {
    if (!val || val === 'null') return;
    copyTextToClipboard(val).then((ok) => {
      if (!ok) {
        addToast(t.common.error, 'error');
        return;
      }
      setCopiedKey(keyName);
      addToast(t.common.copySuccess, 'success');
      setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  const renderCopyButton = (value: string, keyName: string, title?: string) => (
    <button
      type="button"
      onClick={() => copyField(value, keyName)}
      className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 p-0.5 rounded transition-colors"
      title={title || t.common.copy}
    >
      {copiedKey === keyName ? (
        <Check className="w-3.5 h-3.5 text-emerald-500" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );

  const isRecent = isRecentUpdate(container.queried_at, 45);
  const portName = getPortDisplayName(container.site_id, language);

  const sections: { title: string; fields: string[] }[] = [
    {
      title: "Thông tin chung",
      fields: ["containerno", "site_id", "event_type", "fel", "iso", "category", "im_exp", "line_oper", "bill_book", "item_seal_no", "item_key"]
    },
    {
      title: "Trọng lượng & VGM",
      fields: ["gross", "container_gross", "tare_wt", "manifest_wt", "gate_wt", "gate_gross_wt", "certified_weight", "vgm"]
    },
    {
      title: "Vị trí & Vận chuyển",
      fields: ["location", "stack", "in_yard", "truck_vessel", "pod_destination", "load_to_vessel", "temp", "haz"]
    },
    {
      title: "Hải quan & Phí hạ tầng",
      fields: ["customs_status", "infras_fee_status"]
    },
    {
      title: "Thời gian & Ghi chú",
      fields: ["event_time", "trans_in", "trans_out", "cont_in_ts", "cont_out_ts", "queried_at", "note"]
    }
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Chi tiết Container: ${container.containerno || ''}`}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-4">
        {/* Port & Update Status Header Banner */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-slate-50 via-slate-50 to-sky-50/50 dark:from-slate-800/80 dark:via-slate-800/60 dark:to-sky-950/30 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary-100 dark:bg-primary-950/70 text-primary-600 dark:text-primary-400 flex items-center justify-center shrink-0 shadow-2xs">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-extrabold font-mono text-slate-900 dark:text-slate-100">
                  {container.containerno}
                </span>
                {container.fel && (
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                    container.fel.toUpperCase() === 'F'
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}>
                    {container.fel.toUpperCase() === 'F' ? 'F (Hàng)' : 'E (Rỗng)'}
                  </span>
                )}
                {container.iso && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                    ISO {container.iso}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-400 mt-1">
                <span className="flex items-center gap-1 font-semibold text-primary-700 dark:text-primary-400">
                  <Anchor className="w-3.5 h-3.5 shrink-0" />
                  <span>Cảng: {portName || container.site_id || 'Chưa xác định'}</span>
                </span>
                {container.location && container.location.trim() && (
                  <span className="flex items-center gap-1 font-medium text-slate-600 dark:text-slate-300">
                    <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>Vị trí bãi: <strong>{container.location}</strong></span>
                  </span>
                )}
                {container.line_oper && (
                  <span className="text-slate-500 dark:text-slate-400">
                    Hãng tàu: <strong>{container.line_oper}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="text-right shrink-0 ml-auto flex flex-col items-end">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-2xs ${
                isRecent
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {isRecent ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
              ) : (
                <Clock className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>Cập nhật: {formatTimeAgo(container.queried_at)}</span>
            </span>
            {container.queried_at && (
              <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-medium">
                {container.queried_at}
              </span>
            )}
          </div>
        </div>

        {/* Detailed Sections */}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {sections.map((section, sIdx) => {
            return (
              <div key={sIdx} className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-primary-600 dark:text-primary-400 border-b border-slate-100 dark:border-slate-800 pb-1">
                  {section.title}
                </h4>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {section.fields.map((key) => {
                    const label = (t.container.columns as Record<string, string>)[key] || key;

                    // Merged customs status: "Tình trạng thông quan" (badge + approval date)
                    if (key === 'customs_status') {
                      const status = getCustomsStatus(container);
                      const approval = container.cust_approval_date && container.cust_approval_date !== 'null'
                        ? String(container.cust_approval_date)
                        : '';
                      return (
                        <div
                          key={key}
                          className={`col-span-2 p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                            status
                              ? 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs'
                              : 'bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                              <ShieldCheck className="w-3 h-3" />
                              {label}
                            </span>
                            {status && renderCopyButton(approval ? `${status} (${approval})` : status, key)}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                            <CustomsStatusBadge row={container} showDate={false} />
                            {approval && (
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                {t.container.approvalDate}: <strong className="text-slate-700 dark:text-slate-200">{approval}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Dangerous goods: text + IMDG lookup link (never raw HTML)
                    if (key === 'haz') {
                      const { text, url } = getImdgInfo(container);
                      const hasValue = !!(text || url);
                      return (
                        <div
                          key={key}
                          className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                            hasValue
                              ? 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs'
                              : 'bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                              {url && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                              {label}
                            </span>
                            {hasValue && renderCopyButton(url || text, key, url ? t.container.copyLink : undefined)}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                            {text && <span className="text-slate-900 dark:text-slate-100 break-words">{text}</span>}
                            {url && <ImdgLink url={url} label={t.container.imdgLookup} />}
                            {!hasValue && <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">null</span>}
                          </div>
                        </div>
                      );
                    }

                    let val = container[key] !== undefined && container[key] !== null ? sanitizeDisplayValue(container[key]) : 'null';

                    // Special display for site_id to include full port name
                    if (key === 'site_id' && val && val !== 'null') {
                      val = `${val} - ${portName}`;
                    }

                    const isNull = val === 'null' || val === '' || val === 0;
                    const isNote = key === 'note';

                    return (
                      <div
                        key={key}
                        className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                          isNote ? 'col-span-2 md:col-span-3' : ''
                        } ${
                          isNull
                            ? 'bg-slate-50/50 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                            : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">
                            {label}
                          </span>
                          {!isNull && renderCopyButton(String(val), key)}
                        </div>
                        <div className={`text-xs font-semibold break-words whitespace-pre-line ${
                          isNull ? 'text-slate-400 dark:text-slate-500 italic text-[11px]' : 'text-slate-900 dark:text-slate-100'
                        }`}>
                          {key === 'infras_fee_status' && !isNull ? (
                            <ValueBadge table="container" columnKey={key} value={val} fallbackText="null" />
                          ) : (
                            String(val)
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {section.fields.includes('customs_status') && (
                  <details className="group text-[11px] text-slate-500 dark:text-slate-400">
                    <summary className="inline-flex items-center gap-1 cursor-pointer select-none font-semibold hover:text-slate-700 dark:hover:text-slate-200 list-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" />
                      {t.container.rawCustomsDetails}
                    </summary>
                    <div className="mt-1 ml-4 flex flex-wrap gap-x-4 gap-y-0.5 font-mono">
                      {(['custom_clearance_status', 'cust', 'cust_approval_date'] as const).map((rawKey) => {
                        const rawVal = container[rawKey];
                        const shown = rawVal === undefined || rawVal === null || rawVal === '' ? 'null' : String(sanitizeDisplayValue(rawVal));
                        return (
                          <span key={rawKey}>
                            {(t.container.columns as Record<string, string>)[rawKey] || rawKey}: <strong className="text-slate-700 dark:text-slate-300">{shown}</strong>
                          </span>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};

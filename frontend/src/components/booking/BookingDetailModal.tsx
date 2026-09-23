import React from 'react';
import { Copy, Check, Ship, Calendar, MapPin, Package, Building2, Anchor, Search, Pencil, StickyNote } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Booking } from '../../types';
import { useApp } from '../../context/AppContext';
import type { TabId } from '../common/Tabs';
import { QuickVesselSearch } from './QuickVesselSearch';
import { detectBookingCarrier, getCarrierBadgeClass } from './carriers';
import { getBookingVesselCandidates } from '../../utils/vessel';
import { NOTE_KEY, getBookingNote } from './NoteHover';

interface BookingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
  /** Enables "Open Vessels tab" in the quick vessel lookup */
  onNavigateTab?: (tab: TabId, query?: string) => void;
  onEdit?: (booking: Booking) => void;
}

export const BookingDetailModal: React.FC<BookingDetailModalProps> = ({
  isOpen,
  onClose,
  booking,
  onNavigateTab,
  onEdit,
}) => {
  const { t, addToast } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);
  const [quickVesselOpen, setQuickVesselOpen] = React.useState(false);
  const closeQuickVessel = React.useCallback(() => setQuickVesselOpen(false), []);

  React.useEffect(() => {
    if (!isOpen) setQuickVesselOpen(false);
  }, [isOpen]);

  if (!booking) return null;

  const copyField = (val: string, keyName: string) => {
    if (!val || val === 'null') return;
    navigator.clipboard.writeText(val);
    setCopiedKey(keyName);
    addToast(t.common.copySuccess, 'success');
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const carrierName = detectBookingCarrier(booking, 'Khác');
  const hasVessel = getBookingVesselCandidates(booking).length > 0;
  const note = getBookingNote(booking);

  const fields: { key: string; label: string; icon?: any }[] = [
    { key: "Carrier", label: t.booking.columns["Carrier"] || "Hãng tàu", icon: Building2 },
    { key: "Booking No", label: t.booking.columns["Booking No"], icon: Package },
    { key: "Vessel", label: t.booking.columns["Vessel"], icon: Ship },
    { key: "ETD", label: t.booking.columns["ETD"], icon: Calendar },
    { key: "Port of Discharging", label: t.booking.columns["Port of Discharging"], icon: Anchor },
    { key: "Place of Delivery", label: t.booking.columns["Place of Delivery"], icon: MapPin },
    { key: "T/S Port", label: t.booking.columns["T/S Port"], icon: MapPin },
    { key: "Block", label: t.booking.columns["Block"] },
    { key: "Equipment Type", label: t.booking.columns["Equipment Type"] },
    { key: "Q'ty", label: t.booking.columns["Q'ty"] },
    { key: "Empty Pick Up CY", label: t.booking.columns["Empty Pick Up CY"] },
    { key: "Full return CY", label: t.booking.columns["Full return CY"] },
    { key: "Port Cargo Cut-off", label: t.booking.columns["Port Cargo Cut-off"], icon: Calendar },
    { key: "Tên file PDF", label: t.booking.columns["Tên file PDF"] },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Chi tiết Booking: ${booking["Booking No"] || ''}`} maxWidth="max-w-2xl">
      <div className="space-y-4">
        {/* Prominent Carrier & Booking Header Banner */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800/80 dark:to-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-primary-600 dark:text-primary-400 shadow-sm shrink-0">
              <Ship className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md border uppercase tracking-wider ${getCarrierBadgeClass(carrierName)}`}>
                  Hãng tàu: {carrierName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900 dark:text-slate-50">
                  {booking["Booking No"] || 'Chưa có số Booking'}
                </span>
                {booking["Booking No"] && (
                  <button
                    type="button"
                    onClick={() => copyField(String(booking["Booking No"]), "Booking No Header")}
                    className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 p-1 rounded-md hover:bg-slate-200/50 dark:hover:bg-slate-700/50 transition-colors"
                    title={t.common.copy}
                  >
                    {copiedKey === "Booking No Header" ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-slate-500" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="text-right flex flex-col items-end gap-1">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 hidden sm:block">Tàu / Số chuyến</span>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px] hidden sm:block">
              {booking["Vessel"] || 'null'}
            </span>
            <div className="flex items-center gap-1.5">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(booking)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t.booking.form.editButton}
                </button>
              )}
              <button
                type="button"
                onClick={() => setQuickVesselOpen(true)}
                disabled={!hasVessel}
                title={t.booking.quickVessel.rowTooltip}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-primary-600 hover:bg-primary-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Search className="w-3 h-3" />
                {t.booking.quickVessel.button}
              </button>
            </div>
          </div>
        </div>

        {note && (
          <div className="p-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                <StickyNote className="w-3.5 h-3.5" />
                {t.booking.columns[NOTE_KEY]}
              </span>
              <button
                type="button"
                onClick={() => copyField(note, NOTE_KEY)}
                className="text-amber-600/70 hover:text-amber-700 dark:text-amber-400/70 dark:hover:text-amber-300 p-0.5 rounded transition-colors"
                title={t.common.copy}
              >
                {copiedKey === NOTE_KEY ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            <div className="text-xs text-slate-800 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed">{note}</div>
          </div>
        )}

        {/* Detailed Fields Grid */}
        <div className="grid grid-cols-2 gap-2.5 max-h-[60vh] overflow-y-auto pr-1">
          {fields.map((f) => {
            const rawVal = f.key === "Carrier" ? carrierName : booking[f.key];
            const val = rawVal !== undefined && rawVal !== null && rawVal !== '' ? rawVal : 'null';
            const isNull = val === 'null' || !val;
            const Icon = f.icon;

            return (
              <div
                key={f.key}
                className={`p-2.5 rounded-xl border flex flex-col justify-between transition-all ${
                  f.key === "Carrier"
                    ? 'col-span-2 bg-primary-50/40 dark:bg-primary-950/20 border-primary-200/80 dark:border-primary-800/80'
                    : isNull
                    ? 'bg-slate-50/40 dark:bg-slate-800/20 border-slate-200/50 dark:border-slate-800/50'
                    : 'bg-white dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 shadow-xs'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
                    <span>{f.label}</span>
                  </span>
                  {!isNull && (
                    <span className="flex items-center gap-0.5">
                    {f.key === "Vessel" && (
                      <button
                        type="button"
                        onClick={() => setQuickVesselOpen(true)}
                        className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 p-0.5 rounded transition-colors"
                        title={t.booking.quickVessel.rowTooltip}
                      >
                        <Ship className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => copyField(String(val), f.key)}
                      className="text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 p-0.5 rounded transition-colors"
                      title={t.common.copy}
                    >
                      {copiedKey === f.key ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    </span>
                  )}
                </div>
                <div className={`text-xs font-semibold break-words ${f.key === "Carrier" ? 'text-sm font-bold text-primary-700 dark:text-primary-300' : isNull ? 'text-slate-400 dark:text-slate-500 italic font-normal' : 'text-slate-900 dark:text-slate-100'}`}>
                  {String(val)}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-md shadow-primary-500/20 transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
      <QuickVesselSearch
        isOpen={isOpen && quickVesselOpen}
        onClose={closeQuickVessel}
        booking={booking}
        onNavigateTab={onNavigateTab}
      />
    </Modal>
  );
};

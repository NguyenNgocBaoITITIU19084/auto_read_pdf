import React from 'react';
import { Copy, Check, Ship, Calendar, MapPin, Package, Building2, Anchor } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Booking } from '../../types';
import { useApp } from '../../context/AppContext';

interface BookingDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: Booking | null;
}

export const BookingDetailModal: React.FC<BookingDetailModalProps> = ({
  isOpen,
  onClose,
  booking,
}) => {
  const { t, addToast } = useApp();
  const [copiedKey, setCopiedKey] = React.useState<string | null>(null);

  if (!booking) return null;

  const copyField = (val: string, keyName: string) => {
    if (!val || val === 'null') return;
    navigator.clipboard.writeText(val);
    setCopiedKey(keyName);
    addToast(t.common.copySuccess, 'success');
    setTimeout(() => setCopiedKey(null), 1500);
  };

  // Helper to detect carrier if missing
  const detectCarrier = (b: Booking): string => {
    if (b["Carrier"] && b["Carrier"] !== 'null') return b["Carrier"];
    const text = `${b["Booking No"] || ''} ${b["Vessel"] || ''} ${b["Tên file PDF"] || ''}`.toUpperCase();
    if (text.includes('DONGJIN') || text.includes('DJSC') || (b["Booking No"] && b["Booking No"].startsWith('DJ'))) return 'DONGJIN';
    if (text.includes('PIL') || (b["Booking No"] && b["Booking No"].startsWith('SGN6')) || text.includes('KOTA')) return 'PIL';
    if (text.includes('ONE') || (b["Booking No"] && b["Booking No"].startsWith('ONEY'))) return 'ONE';
    if (text.includes('SITC')) return 'SITC';
    if (text.includes('COSCO')) return 'COSCO';
    if (text.includes('MAERSK') || text.includes('SEALAND')) return 'MAERSK';
    if (text.includes('CMA') || text.includes('CNC')) return 'CMA CGM';
    if (text.includes('EVER')) return 'EVERGREEN';
    if (text.includes('WAN HAI') || text.includes('WHL')) return 'WAN HAI';
    return 'Khác';
  };

  const carrierName = detectCarrier(booking);

  // Styling per carrier
  const getCarrierBadgeStyle = (carrier: string) => {
    switch (carrier.toUpperCase()) {
      case 'DONGJIN':
        return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800';
      case 'PIL':
        return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800';
      case 'ONE':
        return 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-200 dark:border-pink-800';
      case 'SITC':
        return 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800';
      case 'COSCO':
        return 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800';
      case 'MAERSK':
        return 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800';
      case 'EVERGREEN':
        return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800';
      default:
        return 'bg-primary-500/10 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-800';
    }
  };

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
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md border uppercase tracking-wider ${getCarrierBadgeStyle(carrierName)}`}>
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

          <div className="text-right hidden sm:block">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">Tàu / Số chuyến</span>
            <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px] block">
              {booking["Vessel"] || 'null'}
            </span>
          </div>
        </div>

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
    </Modal>
  );
};

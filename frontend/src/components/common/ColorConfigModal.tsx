import React, { useState, useMemo, useEffect } from 'react';
import { 
  Palette, Plus, Edit2, Trash2, RotateCcw, 
  Check, Eye, Sparkles, Filter, X
} from 'lucide-react';
import { Modal } from './Modal';
import { useApp } from '../../context/AppContext';
import { ColorRule, MatchType, TargetTable } from '../../types';
import { COLOR_PRESETS, getColorPreset } from '../../utils/colorPresets';
import { Tooltip } from './Tooltip';

const RULES_PAGE_SIZE = 40;

const LIST_FILTERS: { value: TargetTable | 'every'; label: string }[] = [
  { value: 'every', label: 'Tất cả' },
  { value: 'container', label: 'Container' },
  { value: 'booking', label: 'Booking' },
  { value: 'vessel', label: 'Lịch tàu' },
  { value: 'all', label: 'Mọi bảng' },
];

interface ColorConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ColorConfigModal: React.FC<ColorConfigModalProps> = ({ isOpen, onClose }) => {
  const { 
    t, colorRules, saveColorRule, deleteColorRuleById, 
    toggleColorRule, resetColorRulesDefault 
  } = useApp();

  // Form editing state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [targetTable, setTargetTable] = useState<TargetTable>('container');
  const [columnKey, setColumnKey] = useState<string>('all');
  const [matchValue, setMatchValue] = useState<string>('');
  const [matchType, setMatchType] = useState<MatchType>('exact');
  const [presetId, setPresetId] = useState<string>('rose');
  const [isCustomColor, setIsCustomColor] = useState<boolean>(false);
  const [customBg, setCustomBg] = useState<string>('#ffe4e6');
  const [customBorder, setCustomBorder] = useState<string>('#fecdd3');
  const [customText, setCustomText] = useState<string>('#9f1239');

  // Columns definition per table
  const columnsByTable: Record<TargetTable, { key: string; label: string }[]> = useMemo(() => ({
    all: [
      { key: 'all', label: t.common.allColumns },
    ],
    booking: [
      { key: 'all', label: t.common.allColumns },
      { key: 'Carrier', label: t.booking.columns['Carrier'] || 'Hãng tàu' },
      { key: 'Equipment Type', label: t.booking.columns['Equipment Type'] || 'Loại cont' },
      { key: 'Booking No', label: t.booking.columns['Booking No'] || 'Số Booking' },
      { key: 'Vessel', label: t.booking.columns['Vessel'] || 'Tên tàu' },
      { key: 'ETD', label: t.booking.columns['ETD'] || 'Ngày tàu chạy' },
      { key: 'Port of Discharging', label: t.booking.columns['Port of Discharging'] || 'Cảng đích' },
      { key: 'Place of Delivery', label: t.booking.columns['Place of Delivery'] || 'Điểm giao' },
      { key: 'T/S Port', label: t.booking.columns['T/S Port'] || 'Cảng chuyển tải' },
      { key: 'Block', label: t.booking.columns['Block'] || 'Block' },
      { key: 'Q\'ty', label: t.booking.columns['Q\'ty'] || 'Số lượng' },
      { key: 'Empty Pick Up CY', label: t.booking.columns['Empty Pick Up CY'] || 'Bãi cấp rỗng' },
      { key: 'Full return CY', label: t.booking.columns['Full return CY'] || 'Nơi hạ bãi' },
      { key: 'Port Cargo Cut-off', label: t.booking.columns['Port Cargo Cut-off'] || 'Thời gian cắt máng' },
      { key: 'Tên file PDF', label: t.booking.columns['Tên file PDF'] || 'Tên file PDF' },
    ],
    container: [
      { key: 'all', label: t.common.allColumns },
      { key: 'customs_status', label: (t.container.columns as Record<string, string>)['customs_status'] || t.common.customsStatus || 'Tình trạng thông quan' },
      { key: 'custom_clearance_status', label: t.container.columns['custom_clearance_status'] || 'Trạng thái HQ' },
      { key: 'infras_fee_status', label: t.container.columns['infras_fee_status'] || 'Phí hạ tầng' },
      { key: 'event_type', label: t.container.columns['event_type'] || 'Tác nghiệp' },
      { key: 'site_id', label: t.container.columns['site_id'] || 'Cảng' },
      { key: 'containerno', label: t.container.columns['containerno'] || 'Số Container' },
      { key: 'fel', label: t.container.columns['fel'] || 'F/E' },
      { key: 'vgm', label: t.container.columns['vgm'] || 'VGM' },
      { key: 'line_oper', label: t.container.columns['line_oper'] || 'Hãng tàu' },
      { key: 'location', label: t.container.columns['location'] || 'Vị trí bãi' },
      { key: 'im_exp', label: t.container.columns['im_exp'] || 'Nhập/Xuất' },
      { key: 'category', label: t.container.columns['category'] || 'Phân loại' },
      { key: 'cust', label: t.container.columns['cust'] || 'Giám sát HQ' },
      { key: 'stack', label: t.container.columns['stack'] || 'Stack' },
      { key: 'temp', label: t.container.columns['temp'] || 'Nhiệt độ' },
      { key: 'haz', label: t.container.columns['haz'] || 'Hàng nguy hiểm' },
      { key: 'load_to_vessel', label: t.container.columns['load_to_vessel'] || 'Tàu xếp' },
      { key: 'pod_destination', label: t.container.columns['pod_destination'] || 'Cảng đến' },
      { key: 'truck_vessel', label: t.container.columns['truck_vessel'] || 'Xe/Tàu' },
      { key: 'bill_book', label: t.container.columns['bill_book'] || 'Số Bill/Booking' },
      { key: 'item_seal_no', label: t.container.columns['item_seal_no'] || 'Số Seal' },
      { key: 'note', label: t.container.columns['note'] || 'Ghi chú' },
    ],
    vessel: [
      { key: 'all', label: t.common.allColumns },
      { key: 'site_id', label: t.vessel.columns['site_id'] || 'Cảng' },
      { key: 'vessel_name', label: t.vessel.columns['vessel_name'] || 'Tên tàu' },
      { key: 'agent', label: t.vessel.columns['agent'] || 'Đại lý' },
      { key: 'in_out_voyage', label: t.vessel.columns['in_out_voyage'] || 'Số chuyến' },
      { key: 'actual_berth_time', label: t.vessel.columns['actual_berth_time'] || 'Cập bến' },
      { key: 'actual_departure_time', label: t.vessel.columns['actual_departure_time'] || 'Rời bến' },
      { key: 'closing_time', label: t.vessel.columns['closing_time'] || 'Closing time' },
      { key: 'closing_time_icd', label: t.vessel.columns['closing_time_icd'] || 'Closing time ICD' },
      { key: 'in_gate', label: t.vessel.columns['in_gate'] || 'Hạ bãi' },
      { key: 'open_ts', label: t.vessel.columns['open_ts'] || 'Mở bãi' },
      { key: 'reefer_open_ts', label: t.vessel.columns['reefer_open_ts'] || 'Mở bãi cont lạnh' },
      { key: 'oog_open_ts', label: t.vessel.columns['oog_open_ts'] || 'Mở bãi OOG' },
      { key: 'haz_open_ts', label: t.vessel.columns['haz_open_ts'] || 'Mở bãi HAZ' },
      { key: 'remarks', label: t.vessel.columns['remarks'] || 'Ghi chú' },
    ],
  }), [t]);

  const availableColumns = columnsByTable[targetTable] || [{ key: 'all', label: t.common.allColumns }];

  // Rules list display (sorted newest first)
  const sortedRules = useMemo(() => {
    return [...colorRules].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
  }, [colorRules]);

  // Long lists: filter by table group and render in pages ("show more") to keep the modal responsive
  const [listFilter, setListFilter] = useState<TargetTable | 'every'>('every');
  const [visibleCount, setVisibleCount] = useState(RULES_PAGE_SIZE);

  const ruleCountsByTable = useMemo(() => {
    const counts: Record<string, number> = {};
    sortedRules.forEach((r) => {
      counts[r.target_table] = (counts[r.target_table] || 0) + 1;
    });
    return counts;
  }, [sortedRules]);

  const filteredRules = useMemo(
    () => (listFilter === 'every' ? sortedRules : sortedRules.filter((r) => r.target_table === listFilter)),
    [sortedRules, listFilter]
  );

  useEffect(() => {
    setVisibleCount(RULES_PAGE_SIZE);
  }, [listFilter, isOpen]);

  const visibleRules = filteredRules.length > visibleCount ? filteredRules.slice(0, visibleCount) : filteredRules;

  const handleStartEdit = (rule: ColorRule) => {
    setEditingId(rule.id || null);
    setTargetTable(rule.target_table);
    setColumnKey(rule.column_key);
    setMatchValue(rule.match_value);
    setMatchType(rule.match_type || 'exact');
    if (rule.custom_bg || rule.custom_text) {
      setIsCustomColor(true);
      setCustomBg(rule.custom_bg || '#ffe4e6');
      setCustomBorder(rule.custom_border || '#fecdd3');
      setCustomText(rule.custom_text || '#9f1239');
      setPresetId('');
    } else {
      setIsCustomColor(false);
      setPresetId(rule.preset_id || 'rose');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setMatchValue('');
    setMatchType('exact');
    setPresetId('rose');
    setIsCustomColor(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedMatchValue = matchType === 'any' ? '*' : matchValue.trim();
    if (matchType !== 'any' && !trimmedMatchValue) return;

    // Check if an existing rule with exact target_table, column_key, and match_value exists
    let targetRuleId = editingId;
    if (!targetRuleId) {
      const existing = colorRules.find(
        (r) =>
          r.target_table === targetTable &&
          r.column_key === columnKey &&
          r.match_value.trim().toUpperCase() === trimmedMatchValue.toUpperCase()
      );
      if (existing && existing.id) {
        targetRuleId = existing.id;
      }
    }

    const payload: Partial<ColorRule> = {
      target_table: targetTable,
      column_key: columnKey,
      match_value: trimmedMatchValue,
      match_type: matchType,
      is_enabled: true,
    };

    if (targetRuleId) {
      payload.id = targetRuleId;
    }

    if (isCustomColor) {
      payload.preset_id = undefined;
      payload.custom_bg = customBg;
      payload.custom_border = customBorder;
      payload.custom_text = customText;
    } else {
      payload.preset_id = presetId;
      payload.custom_bg = undefined;
      payload.custom_border = undefined;
      payload.custom_text = undefined;
    }

    await saveColorRule(payload);
    handleCancelEdit();
  };

  // Preview styling
  const activePreset = getColorPreset(presetId);
  const previewBadgeStyle = isCustomColor
    ? {
        backgroundColor: customBg,
        borderColor: customBorder,
        color: customText,
      }
    : undefined;

  const previewBadgeClass = !isCustomColor && activePreset
    ? activePreset.badgeClass
    : '';

  const previewText = matchType === 'any'
    ? (columnKey !== 'all' ? `[Mọi giá trị ${columnKey}]` : 'Giá trị bất kỳ')
    : (matchValue.trim() || 'Giá trị mẫu');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t.common.colorConfig} maxWidth="max-w-4xl">
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        {/* Rule Form (Add / Edit) */}
        <form onSubmit={handleSubmit} className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 space-y-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-900/60 text-primary-600 dark:text-primary-400">
                <Palette className="w-4 h-4" />
              </div>
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                {editingId ? t.common.editColorRule : t.common.addColorRule}
              </h4>
            </div>

            {editingId && (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
                <span>{t.common.cancel}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Target Table & Column */}
            <div data-tour="color-target-select" className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {t.common.targetTable}
                </label>
                <select
                  value={targetTable}
                  onChange={(e) => {
                    setTargetTable(e.target.value as TargetTable);
                    setColumnKey('all');
                  }}
                  className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                >
                  <option value="container">Container (ePort)</option>
                  <option value="booking">Booking (PDF)</option>
                  <option value="vessel">Lịch tàu (ePort)</option>
                  <option value="all">Tất cả bảng</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {t.common.targetColumn}
                </label>
                <select
                  value={columnKey}
                  onChange={(e) => setColumnKey(e.target.value)}
                  className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                >
                  {availableColumns.map((col) => (
                    <option key={col.key} value={col.key}>
                      {col.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Match Type & Value */}
            <div data-tour="color-condition" className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-2 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80">
              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {t.common.matchType}
                </label>
                <select
                  value={matchType}
                  onChange={(e) => {
                    const newType = e.target.value as MatchType;
                    setMatchType(newType);
                    if (newType === 'any') {
                      setMatchValue('*');
                    } else if (matchValue === '*') {
                      setMatchValue('');
                    }
                  }}
                  className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                >
                  <option value="exact">{t.common.exactMatch}</option>
                  <option value="contains">{t.common.containsMatch}</option>
                  <option value="starts_with">{t.common.startsWithMatch}</option>
                  <option value="ends_with">{t.common.endsWithMatch}</option>
                  <option value="any">{t.common.anyMatch}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  {t.common.matchValue}
                </label>
                {matchType === 'any' ? (
                  <div className="w-full text-xs font-medium bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-500 dark:text-slate-400 italic flex items-center gap-1.5 truncate" title={t.common.anyValueNote}>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span className="truncate">Áp dụng mọi giá trị</span>
                  </div>
                ) : (
                  <input
                    type="text"
                    required
                    value={matchValue}
                    onChange={(e) => setMatchValue(e.target.value)}
                    placeholder={
                      matchType === 'starts_with'
                        ? 'vd: TCLU, MSCU...'
                        : matchType === 'ends_with'
                        ? 'vd: 40HC, 20DC...'
                        : 'vd: Chưa duyệt (N), CTL, UNLOAD...'
                    }
                    className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Color Selection Mode & Palette */}
          <div data-tour="color-palette" className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>{isCustomColor ? t.common.customColor : t.common.colorPalette}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={isCustomColor}
                  onChange={(e) => setIsCustomColor(e.target.checked)}
                  className="rounded text-primary-600 focus:ring-primary-500"
                />
                <span>Tùy chỉnh mã màu HEX riêng</span>
              </label>
            </div>

            {/* Curated Presets Grid */}
            {!isCustomColor ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                {COLOR_PRESETS.map((p) => {
                  const isSelected = presetId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPresetId(p.id)}
                      className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                        isSelected
                          ? 'border-primary-500 ring-2 ring-primary-500/20 bg-white dark:bg-slate-900 shadow-xs'
                          : 'border-slate-200/80 dark:border-slate-700/80 bg-white/70 dark:bg-slate-900/50 hover:border-slate-300'
                      }`}
                    >
                      <span
                        className="w-4 h-4 rounded-full shrink-0 shadow-2xs border border-white/40"
                        style={{ backgroundColor: p.hexPreview }}
                      />
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                        {p.nameVi}
                      </span>
                      {isSelected && <Check className="w-3 h-3 text-primary-600 ml-auto shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Custom Color Inputs */
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    {t.common.bgColor}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={customBg}
                      onChange={(e) => setCustomBg(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                    />
                    <input
                      type="text"
                      value={customBg}
                      onChange={(e) => setCustomBg(e.target.value)}
                      className="flex-1 text-xs font-mono px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    {t.common.borderColor}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={customBorder}
                      onChange={(e) => setCustomBorder(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                    />
                    <input
                      type="text"
                      value={customBorder}
                      onChange={(e) => setCustomBorder(e.target.value)}
                      className="flex-1 text-xs font-mono px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    {t.common.textColor}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border-0 p-0"
                    />
                    <input
                      type="text"
                      value={customText}
                      onChange={(e) => setCustomText(e.target.value)}
                      className="flex-1 text-xs font-mono px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Live Preview & Action Submit */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {t.common.preview}:
              </span>
              <span
                style={previewBadgeStyle}
                className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold border shadow-2xs ${previewBadgeClass}`}
              >
                {previewText}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold rounded-xl shadow-md shadow-primary-500/20 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{editingId ? t.common.save : t.common.addColorRule}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Existing Rules List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
            <div className="flex items-center gap-2">
              <span>{t.common.colorRules}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">
                {sortedRules.length}
              </span>
            </div>
            <button
              type="button"
              onClick={resetColorRulesDefault}
              className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline"
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t.common.resetColorRules}</span>
            </button>
          </div>

          {sortedRules.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              <Filter className="w-3 h-3 text-slate-400 mr-0.5" />
              {LIST_FILTERS.map((f) => {
                const n = f.value === 'every' ? sortedRules.length : ruleCountsByTable[f.value] || 0;
                if (f.value !== 'every' && n === 0) return null;
                const active = listFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setListFilter(f.value)}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors ${
                      active
                        ? 'bg-primary-50 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 border-primary-300 dark:border-primary-700'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {f.label} <span className="opacity-60">{n}</span>
                  </button>
                );
              })}
            </div>
          )}

          {filteredRules.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              {t.common.noRulesFound}
            </div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto pr-1 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {visibleRules.map((rule, ruleIdx) => {
                const preset = getColorPreset(rule.preset_id);
                const badgeStyle = rule.custom_bg
                  ? {
                      backgroundColor: rule.custom_bg,
                      borderColor: rule.custom_border,
                      color: rule.custom_text,
                    }
                  : undefined;
                const badgeClass = !rule.custom_bg && preset ? preset.badgeClass : '';

                const displayMatchValue = rule.match_type === 'any' || rule.match_value === '*'
                  ? 'Toàn bộ cột (*)'
                  : rule.match_value;

                const matchTypeLabel = 
                  rule.match_type === 'any' || rule.match_value === '*' ? 'toàn bộ cột' :
                  rule.match_type === 'starts_with' ? 'bắt đầu bằng' :
                  rule.match_type === 'ends_with' ? 'kết thúc bằng' :
                  rule.match_type === 'contains' ? 'chứa từ khóa' : 'khớp chính xác';

                return (
                  <div
                    key={rule.id ?? `rule-${ruleIdx}`}
                    className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                      rule.is_enabled
                        ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xs'
                        : 'bg-slate-50/50 dark:bg-slate-900/40 border-slate-200/50 dark:border-slate-800/50 opacity-60'
                    }`}
                  >
                    {/* Badge Preview & Rule details */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span
                        style={badgeStyle}
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border shadow-2xs shrink-0 max-w-[130px] truncate ${badgeClass}`}
                        title={displayMatchValue}
                      >
                        {displayMatchValue}
                      </span>

                      <div className="min-w-0 flex-1 text-[11px]">
                        <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-semibold truncate">
                          <span className="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-slate-500 uppercase">
                            {rule.target_table}
                          </span>
                          <span className="truncate">
                            {rule.column_key === 'all' ? t.common.allColumns : rule.column_key}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {matchTypeLabel}
                        </span>
                      </div>
                    </div>

                    {/* Actions: Enable Toggle, Edit, Delete */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Tooltip content={rule.is_enabled ? 'Đang bật' : 'Đang tắt'}>
                        <button
                          type="button"
                          onClick={() => rule.id && toggleColorRule(rule.id, !rule.is_enabled)}
                          className={`w-7 h-4 rounded-full transition-colors relative ${
                            rule.is_enabled ? 'bg-primary-600' : 'bg-slate-300 dark:bg-slate-700'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                              rule.is_enabled ? 'right-0.5' : 'left-0.5'
                            }`}
                          />
                        </button>
                      </Tooltip>

                      <Tooltip content={t.common.editColorRule}>
                        <button
                          type="button"
                          onClick={() => handleStartEdit(rule)}
                          className="p-1 text-slate-400 hover:text-primary-600 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>

                      <Tooltip content={t.common.deleteColorRule}>
                        <button
                          type="button"
                          onClick={() => rule.id && deleteColorRuleById(rule.id)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
            {filteredRules.length > visibleRules.length && (
              <div className="flex items-center justify-center gap-2 pt-1">
                <span className="text-[11px] text-slate-400">
                  {visibleRules.length}/{filteredRules.length}
                </span>
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + RULES_PAGE_SIZE)}
                  className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  {t.common.showMore}
                </button>
              </div>
            )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-xl transition-all"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </Modal>
  );
};

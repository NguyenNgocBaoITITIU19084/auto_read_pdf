import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, Search, RefreshCw, Trash2, FileSpreadsheet, 
  SlidersHorizontal, Eye, BookmarkPlus, BookmarkCheck
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ContainerInfo, ContainerWatchlist } from '../../types';
import { 
  getContainers, searchContainersApi, deleteContainer, clearContainers, 
  addContainerWatchlist, getContainerWatchlist, deleteContainerWatchlist 
} from '../../services/api';
import { ExportModal } from '../common/ExportModal';
import { ColumnConfigModal, ColumnDef } from '../common/ColumnConfigModal';
import { ContainerDetailModal } from './ContainerDetailModal';
import { ContainerWatchlistModal } from './ContainerWatchlistModal';
import { ResizableTh } from '../common/ResizableTh';
import { useColumnSettings } from '../../hooks/useColumnSettings';
import { Tooltip } from '../common/Tooltip';
import { formatTimeAgo, isRecentUpdate } from '../../utils/formatters';

export const ContainerTab: React.FC = () => {
  const { t, activeCollection, addToast, autoSyncEnabled } = useApp();
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState('all');

  const [siteId, setSiteId] = useState('CTL');
  const [containerNosInput, setContainerNosInput] = useState('');

  const [selectedContainer, setSelectedContainer] = useState<ContainerInfo | null>(null);
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<ContainerWatchlist[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isColumnConfigOpen, setIsColumnConfigOpen] = useState(false);

  const defaultColumns: ColumnDef[] = useMemo(() => [
    { key: "site_id", label: t.container.columns["site_id"], visible: true },
    { key: "containerno", label: t.container.columns["containerno"], visible: true },
    { key: "event_type", label: t.container.columns["event_type"], visible: true },
    { key: "event_time", label: t.container.columns["event_time"], visible: true },
    { key: "fel", label: t.container.columns["fel"], visible: true },
    { key: "iso", label: t.container.columns["iso"], visible: true },
    { key: "category", label: t.container.columns["category"], visible: false },
    { key: "gross", label: t.container.columns["gross"], visible: true },
    { key: "vgm", label: t.container.columns["vgm"], visible: true },
    { key: "location", label: t.container.columns["location"], visible: true },
    { key: "truck_vessel", label: t.container.columns["truck_vessel"], visible: true },
    { key: "im_exp", label: t.container.columns["im_exp"], visible: true },
    { key: "bill_book", label: t.container.columns["bill_book"], visible: true },
    { key: "custom_clearance_status", label: t.container.columns["custom_clearance_status"], visible: true },
    { key: "infras_fee_status", label: t.container.columns["infras_fee_status"], visible: true },
    { key: "note", label: t.container.columns["note"], visible: false },
    { key: "item_seal_no", label: t.container.columns["item_seal_no"], visible: false },
    { key: "queried_at", label: t.container.columns["queried_at"], visible: true },
  ], [t]);

  const defaultWidths = useMemo(() => ({
    "site_id": 75,
    "containerno": 130,
    "event_type": 130,
    "event_time": 140,
    "fel": 60,
    "iso": 70,
    "category": 90,
    "gross": 80,
    "vgm": 80,
    "location": 90,
    "truck_vessel": 130,
    "im_exp": 70,
    "bill_book": 120,
    "custom_clearance_status": 110,
    "infras_fee_status": 110,
    "note": 120,
    "item_seal_no": 110,
    "queried_at": 140,
  }), []);

  const { columns, setColumns, resetColumns, columnWidths, startResize } = useColumnSettings({
    storageKey: 'container_table',
    defaultColumns,
    defaultWidths,
  });

  useEffect(() => {
    setColumns((prev) =>
      prev.map((c) => {
        const def = defaultColumns.find((d) => d.key === c.key);
        const defLabel = def ? def.label : c.key;
        return {
          ...c,
          defaultLabel: defLabel,
          label: c.customLabel !== undefined && c.customLabel !== '' ? c.customLabel : defLabel,
        };
      })
    );
  }, [t, defaultColumns, setColumns]);

  const getColLabel = (key: string, fallback: string) => {
    const col = columns.find((c) => c.key === key);
    return col?.label || fallback;
  };

  const loadWatchlist = async () => {
    if (!activeCollection) return;
    try {
      const data = await getContainerWatchlist(activeCollection.id);
      setWatchlist(data);
    } catch (e) {
      console.error(e);
    }
  };

  const loadData = async (showLoading = true) => {
    if (!activeCollection) return;
    try {
      if (showLoading) setLoading(true);
      const data = await getContainers(activeCollection.id, searchQuery, searchField);
      setContainers(data);
      loadWatchlist();
    } catch (e: any) {
      console.error(e);
      if (showLoading) addToast(e.message || t.common.error, 'error');
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    loadData(true);
    loadWatchlist();
  }, [activeCollection, searchQuery, searchField]);

  // Periodic polling when auto-sync is active to automatically reflect new container statuses
  useEffect(() => {
    if (!autoSyncEnabled || !activeCollection) return;

    const timer = setInterval(() => {
      loadData(false);
    }, 10000);

    return () => clearInterval(timer);
  }, [autoSyncEnabled, activeCollection, searchQuery, searchField]);

  // Match a container item with watchlist
  const getWatchlistItem = (item: ContainerInfo): ContainerWatchlist | undefined => {
    const itemNo = (item.containerno || '').trim().toUpperCase();
    const itemSite = (item.site_id || '').trim().toUpperCase();

    return watchlist.find((w) => {
      const wSite = (w.site_id || '').trim().toUpperCase();
      if (wSite && itemSite && wSite !== itemSite) return false;
      return (w.container_no || '').trim().toUpperCase() === itemNo;
    });
  };

  // Toggle add/remove container from watchlist
  const handleToggleWatchlist = async (item: ContainerInfo) => {
    if (!activeCollection) return;
    const matched = getWatchlistItem(item);
    try {
      if (matched) {
        await deleteContainerWatchlist(matched.id);
        setWatchlist((prev) => prev.filter((w) => w.id !== matched.id));
        addToast(`Đã xóa container ${item.containerno} khỏi Watchlist!`, 'success');
      } else {
        await addContainerWatchlist(
          activeCollection.id,
          item.site_id || 'CTL',
          item.containerno
        );
        addToast(`Đã thêm container ${item.containerno} vào Watchlist!`, 'success');
        await loadWatchlist();
      }
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleQueryEport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCollection) return;
    if (!containerNosInput.trim()) {
      addToast('Vui lòng nhập danh sách số Container', 'error');
      return;
    }

    try {
      setQuerying(true);
      const cleaned = containerNosInput
        .split(/[\s,\n]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .join(',');

      const res = await searchContainersApi(activeCollection.id, siteId, cleaned);
      if (res.count > 0) {
        addToast(`Tìm thấy ${res.count} kết quả tra cứu container!`, 'success');
      } else {
        addToast(res.message || 'Không tìm thấy thông tin container trên ePort', 'info');
      }
      await loadData();
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    } finally {
      setQuerying(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t.common.deleteConfirm)) return;
    try {
      await deleteContainer(id);
      addToast(t.common.success, 'success');
      setContainers((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  const handleClearAll = async () => {
    if (!activeCollection) return;
    if (!window.confirm(t.common.clearConfirm)) return;
    try {
      await clearContainers(activeCollection.id);
      addToast(t.common.success, 'success');
      setContainers([]);
    } catch (e: any) {
      addToast(e.message || t.common.error, 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-3.5 gap-2.5 bg-slate-50/50 dark:bg-slate-950/50">
      {/* Top Searcher Form */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <form onSubmit={handleQueryEport} className="flex flex-wrap items-center gap-2.5">
          <div className="w-40 shrink-0">
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="w-full text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500"
            >
              <option value="CTL">{t.vessel.siteCTL}</option>
              <option value="GNL">{t.vessel.siteGNL}</option>
            </select>
          </div>

          <div className="flex-1 min-w-[240px]">
            <input
              type="text"
              required
              value={containerNosInput}
              onChange={(e) => setContainerNosInput(e.target.value.toUpperCase())}
              placeholder="Nhập danh sách số container (VD: TEMU1234567, TCLU7654321)..."
              className="w-full text-xs font-medium uppercase bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <button
            type="submit"
            disabled={querying}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm transition-all shrink-0"
          >
            <Search className={`w-3.5 h-3.5 ${querying ? 'animate-spin' : ''}`} />
            <span>{querying ? t.common.loading : t.container.queryBtn}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsWatchlistOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 hover:bg-primary-100 transition-colors ml-auto shrink-0"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>{t.container.watchlistTitle}</span>
          </button>
        </form>
      </div>

      {/* Controls: Filter & Table actions */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <select
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
            className="text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-primary-500 shrink-0"
          >
            <option value="all">{t.common.all}</option>
            <option value="containerno">{getColLabel("containerno", t.container.columns["containerno"])}</option>
            <option value="location">{getColLabel("location", t.container.columns["location"])}</option>
            <option value="item_seal_no">{getColLabel("item_seal_no", t.container.columns["item_seal_no"])}</option>
            <option value="line_oper">{getColLabel("line_oper", t.container.columns["line_oper"])}</option>
            <option value="bill_book">{getColLabel("bill_book", t.container.columns["bill_book"])}</option>
          </select>

          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.common.search}
              className="w-full pl-8 pr-3 py-1.5 text-xs font-medium bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip content="Cấu hình hiển thị và sắp xếp thứ tự các cột">
            <button
              onClick={() => setIsColumnConfigOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{t.common.columnsConfig}</span>
            </button>
          </Tooltip>

          <Tooltip content="Xuất danh sách Container ra file Excel">
            <button
              onClick={() => setIsExportOpen(true)}
              disabled={containers.length === 0}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{t.common.exportExcel}</span>
            </button>
          </Tooltip>

          <Tooltip content="Tải lại dữ liệu Container">
            <button
              onClick={() => loadData(true)}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          {containers.length > 0 && (
            <Tooltip content="Xóa tất cả Container trong bộ sưu tập này">
              <button
                onClick={handleClearAll}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Container Table */}
      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-sm min-h-0">
        <div className="flex-1 overflow-x-auto overflow-y-auto w-full">
          <table className="min-w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 shadow-sm">
              <tr>
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-10 shrink-0 text-[11px]">
                  {t.common.stt}
                </th>
                {columns
                  .filter((c) => c.visible)
                  .map((col) => (
                    <ResizableTh
                      key={col.key}
                      colKey={col.key}
                      label={col.label}
                      width={columnWidths[col.key]}
                      onResize={startResize}
                    />
                  ))}
                <th className="py-2 px-2.5 font-bold text-slate-600 dark:text-slate-300 text-center w-20 text-[11px]">
                  {t.common.actions}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {containers.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.filter((c) => c.visible).length + 2}
                    className="py-12 text-center text-slate-400 dark:text-slate-500"
                  >
                    <Box className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <p className="text-xs font-medium">{t.common.noData}</p>
                  </td>
                </tr>
              ) : (
                containers.map((item, idx) => {
                  const isRecent = isRecentUpdate(item.queried_at, 45);
                  const watchlistItem = getWatchlistItem(item);
                  const isBookmarked = !!watchlistItem;
                  return (
                    <tr
                      key={item.id || idx}
                      onDoubleClick={() => setSelectedContainer(item)}
                      className={`hover:bg-sky-100/80 dark:hover:bg-sky-950/70 hover:shadow-xs transition-colors group cursor-pointer ${
                        isRecent ? 'bg-emerald-50/25 dark:bg-emerald-950/20 border-l-[3px] border-l-emerald-500' : ''
                      }`}
                    >
                      <td className="py-1.5 px-2.5 text-center font-medium text-slate-400 w-10">
                        {idx + 1}
                      </td>
                      {columns
                        .filter((c) => c.visible)
                        .map((col) => {
                          const val = item[col.key] !== undefined && item[col.key] !== null ? item[col.key] : 'null';
                          const isNull = val === 'null' || val === '' || val === 0;
                          const w = columnWidths[col.key];

                          if (col.key === 'queried_at') {
                            return (
                              <td
                                key={col.key}
                                style={{
                                  width: w ? `${w}px` : undefined,
                                  maxWidth: w ? `${w}px` : undefined,
                                }}
                                className="py-1.5 px-2.5 truncate"
                                title={`Thời gian cập nhật: ${String(val)}`}
                              >
                                {isNull ? (
                                  <span className="text-slate-400 dark:text-slate-500 italic text-[11px]">Chưa cập nhật</span>
                                ) : (
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-tight border ${
                                      isRecent
                                        ? 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700 shadow-2xs'
                                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                    }`}
                                  >
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                        isRecent ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                      }`}
                                    />
                                    <span>{formatTimeAgo(val)}</span>
                                  </span>
                                )}
                              </td>
                            );
                          }

                          if (col.key === 'containerno') {
                            return (
                              <td
                                key={col.key}
                                style={{
                                  width: w ? `${w}px` : undefined,
                                  maxWidth: w ? `${w}px` : undefined,
                                }}
                                className="py-1.5 px-2.5 truncate font-mono font-bold text-slate-900 dark:text-slate-100"
                                title={String(val)}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  {isRecent && (
                                    <span
                                      title="Mới cập nhật từ ePort"
                                      className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse"
                                    />
                                  )}
                                  <span className="truncate">{String(val)}</span>
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={col.key}
                              style={{
                                width: w ? `${w}px` : undefined,
                                maxWidth: w ? `${w}px` : undefined,
                              }}
                              className={`py-1.5 px-2.5 truncate ${
                                isNull ? 'text-slate-400 dark:text-slate-500 italic' : 'text-slate-800 dark:text-slate-200 font-medium'
                              }`}
                              title={String(val)}
                            >
                              {String(val)}
                            </td>
                          );
                        })}
                    <td className="py-1.5 px-2.5 text-center w-20">
                      <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <Tooltip content="Xem chi tiết đầy đủ thông tin Container">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedContainer(item); }}
                            className="p-1 rounded-md text-slate-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-950/50 transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                        <Tooltip
                          content={
                            isBookmarked
                              ? (t.container.inWatchlistTooltip || 'Đang trong Watchlist (Nhấn để hủy theo dõi)')
                              : (t.container.addToWatchlistTooltip || 'Thêm vào Watchlist để theo dõi')
                          }
                        >
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleWatchlist(item); }}
                            className={`p-1 rounded-md transition-all ${
                              isBookmarked
                                ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800 shadow-2xs'
                                : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/50'
                            }`}
                          >
                            {isBookmarked ? (
                              <BookmarkCheck className="w-3.5 h-3.5 fill-amber-500/20 text-amber-500 dark:text-amber-400" />
                            ) : (
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </Tooltip>
                        <Tooltip content="Xóa dòng Container này">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>

        <div className="px-3.5 py-1.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            {t.common.total}: <strong className="text-slate-800 dark:text-slate-200">{containers.length}</strong> {t.common.items}
          </span>
          <span>Kéo đường viền cột để đổi độ rộng • Double-click để xem chi tiết</span>
        </div>
      </div>

      {/* Modals */}
      <ContainerDetailModal
        isOpen={!!selectedContainer}
        onClose={() => setSelectedContainer(null)}
        container={selectedContainer}
      />

      <ContainerWatchlistModal
        isOpen={isWatchlistOpen}
        onClose={() => setIsWatchlistOpen(false)}
        onDataUpdated={loadData}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        data={containers}
        allColumns={[
          { key: "STT", label: t.container.columns["STT"] },
          ...columns.map((c) => ({ key: c.key, label: c.label })),
        ]}
        filenamePrefix="containers"
      />

      <ColumnConfigModal
        isOpen={isColumnConfigOpen}
        onClose={() => setIsColumnConfigOpen(false)}
        columns={columns}
        onChange={setColumns}
        onReset={resetColumns}
      />
    </div>
  );
};

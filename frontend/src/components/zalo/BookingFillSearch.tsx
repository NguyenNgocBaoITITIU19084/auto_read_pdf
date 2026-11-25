import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { lookupBookingTasksApi } from '../../services/api';
import type { BookingTask } from '../../types';

interface Props {
  /** Fill the composer's open fields from this booking */
  onPick: (task: BookingTask) => void;
}

/** Search every collection's bookings by booking no / vessel / carrier and fill the message with the one picked. */
export const BookingFillSearch: React.FC<Props> = ({ onPick }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookingTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      lookupBookingTasksApi(q)
        .then((rows) => {
          if (mine !== seq.current) return;
          setResults(rows);
          setFailed(false);
          setActive(0);
        })
        .catch(() => {
          if (mine !== seq.current) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => mine === seq.current && setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (task: BookingTask) => {
    onPick(task);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-amber-500" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showList || results.length === 0) {
              if (e.key === 'Escape') setOpen(false);
              return;
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => (i + step + results.length) % results.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(results[Math.min(active, results.length - 1)]);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
            }
          }}
          placeholder="Tìm booking để điền: số booking, tên tàu, hãng tàu..."
          className="w-full rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 pl-8 pr-8 py-1.5 text-xs text-slate-800 dark:text-slate-100 placeholder:text-amber-700/60 dark:placeholder:text-amber-300/50 focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {loading && <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-amber-500" />}
      </div>
      {showList && !loading && (
        <ul className="absolute bottom-full left-0 mb-1 w-full max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-1 z-30">
          {results.length === 0 ? (
            <li className={`px-2 py-3 text-center text-[11px] ${failed ? 'text-rose-500' : 'text-slate-400'}`}>
              {failed ? 'Không tìm được — kiểm tra kết nối backend rồi thử lại.' : 'Không tìm thấy booking nào.'}
            </li>
          ) : (
            results.map((t, i) => {
              const qty = t["Q'ty"] && t['Equipment Type'] ? `${t["Q'ty"]}x${t['Equipment Type']}` : t['Equipment Type'] || '';
              const closed = !['new', 'dispatched', 'stuffed', undefined, ''].includes(t['Trạng thái'] as string);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(t);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`w-full text-left rounded-md px-2 py-1.5 cursor-pointer ${i === active ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{t['Booking No'] || '(không số)'}</span>
                      <span className="text-slate-400 truncate">{[t.Carrier, qty].filter(Boolean).join(' · ')}</span>
                      {closed && <span className="ml-auto shrink-0 text-[10px] text-slate-400">đã xong</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {t['Hạn cut-off'] ? <span className="text-amber-600 dark:text-amber-400">Cut-off {t['Hạn cut-off']}</span> : 'Chưa có cut-off'}
                      {t.Vessel ? ` · ${t.Vessel}` : ''}
                      {t['Full return CY'] ? ` · Hạ ${t['Full return CY']}` : ''}
                      {t['Bộ sưu tập'] ? ` · ${t['Bộ sưu tập']}` : ''}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
};

import React from 'react';
import { AlertCircle, ArrowRight, FileSearch, Mail, MessageCircle, MessageSquareReply } from 'lucide-react';
import { DashboardMessaging } from '../../types';
import { TabId } from '../common/Tabs';
import { useApp } from '../../context/AppContext';
import { tf } from '../../services/i18nFormat';

interface MessagingCardProps {
  messaging: DashboardMessaging;
  onNavigateTab: (tabId: TabId, searchKeyword?: string) => void;
}

const rowBtn =
  'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors cursor-pointer';

/** What is waiting in Zalo and Gmail; every line opens that tab. */
export const MessagingCard: React.FC<MessagingCardProps> = React.memo(({ messaging, onNavigateTab }) => {
  const { t } = useApp();
  const m = t.dashboard.messaging;
  const { zalo, gmail } = messaging;

  const count = (n: number, tone: string) => (
    <strong className={`tabular-nums ${n > 0 ? tone : 'text-slate-400 dark:text-slate-500'}`}>{n}</strong>
  );
  const muted = (text: string) => <p className="px-2 py-1.5 text-[11px] text-slate-400 dark:text-slate-500">{text}</p>;
  const header = (icon: React.ReactNode, label: string, tab: TabId, open: string) => (
    <div className="flex items-center justify-between px-2">
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </span>
      <button type="button" onClick={() => onNavigateTab(tab)}
        className="text-[11px] font-semibold text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-0.5 cursor-pointer">
        {open}
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );

  const zaloBody = () => {
    if (!zalo) return muted(m.unavailable);
    if (!zalo.connected) return muted(m.zaloOff);
    return (
      <>
        <button type="button" className={rowBtn} onClick={() => onNavigateTab('zalo')} title={zalo.account_name || undefined}>
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="text-lg font-black leading-none">{count(zalo.unread_messages, 'text-sky-600 dark:text-sky-400')}</span>
            <span className="text-slate-500 dark:text-slate-400">{m.unreadMessages}</span>
          </span>
          <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
            {tf(m.unreadConversations, { n: zalo.unread_conversations })}
          </span>
        </button>
        <button type="button" className={rowBtn} onClick={() => onNavigateTab('zalo')}>
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <MessageSquareReply className="w-3.5 h-3.5 text-amber-500" />
            {m.pendingConversations}
          </span>
          {count(zalo.pending_conversations, 'text-amber-600 dark:text-amber-400')}
        </button>
        <button type="button" className={rowBtn} onClick={() => onNavigateTab('zalo')}>
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <FileSearch className="w-3.5 h-3.5 text-emerald-500" />
            {m.bookingsToReview}
          </span>
          {count(zalo.bookings_to_review, 'text-emerald-600 dark:text-emerald-400')}
        </button>
      </>
    );
  };

  const gmailBody = () => {
    if (!gmail) return muted(m.unavailable);
    if (!gmail.accounts.length) return muted(m.gmailNone);
    return (
      <>
        <button type="button" className={rowBtn} onClick={() => onNavigateTab('gmail')}>
          <span className="flex items-baseline gap-1.5">
            <span className="text-lg font-black leading-none">{count(gmail.unread_total, 'text-rose-600 dark:text-rose-400')}</span>
            <span className="text-slate-500 dark:text-slate-400">{m.gmailUnread}</span>
          </span>
        </button>
        {gmail.accounts.map((acc) => (
          <button key={acc.id} type="button" className={rowBtn} onClick={() => onNavigateTab('gmail')}>
            <span className="truncate text-slate-600 dark:text-slate-300" title={acc.email}>{acc.email}</span>
            {acc.status === 'error' ? (
              <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                <AlertCircle className="w-3 h-3" />
                {m.gmailRelogin}
              </span>
            ) : (
              count(acc.unread_count, 'text-slate-700 dark:text-slate-200')
            )}
          </button>
        ))}
      </>
    );
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm p-3 flex flex-col gap-2">
      <h3 className="px-2 text-sm font-bold text-slate-900 dark:text-slate-100">{m.title}</h3>
      <div className="space-y-0.5">
        {header(<MessageCircle className="w-3.5 h-3.5 text-sky-500" />, 'Zalo', 'zalo', m.openZalo)}
        {zaloBody()}
      </div>
      <div className="border-t border-slate-100 dark:border-slate-800 pt-2 space-y-0.5">
        {header(<Mail className="w-3.5 h-3.5 text-rose-500" />, 'Gmail', 'gmail', m.openGmail)}
        {gmailBody()}
      </div>
    </div>
  );
});
MessagingCard.displayName = 'MessagingCard';

import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { tf } from '../../services/i18nFormat';
import { Tooltip } from '../common/Tooltip';

interface CaptchaCountdownProps {
  /** When the captcha expires (Date.now() milliseconds) */
  expiresAt: number;
  /** Shown on hover while the captcha is valid ("{time}" is replaced by m:ss when present) */
  tooltip: string;
  expiredText: string;
  expiredTooltip: string;
}

const WARN_SECONDS = 60;

type Tone = 'ok' | 'warn' | 'expired';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
  warn: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  expired: 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700',
};

export const formatCountdown = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Time left before the SP-ITC captcha expires. Ticks on its own, so the container table does not re-render. */
export const CaptchaCountdown: React.FC<CaptchaCountdownProps> = ({ expiresAt, tooltip, expiredText, expiredTooltip }) => {
  const [now, setNow] = useState(() => Date.now());
  const left = (expiresAt - now) / 1000;
  const tone: Tone = left <= 0 ? 'expired' : left <= WARN_SECONDS ? 'warn' : 'ok';

  useEffect(() => {
    setNow(Date.now());
    if (expiresAt <= Date.now()) return undefined;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= expiresAt) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const time = formatCountdown(left);
  const hint = tone === 'expired' ? expiredTooltip : tf(tooltip, { time });
  return (
    // above: below it the next card (filters) paints over the tooltip
    <Tooltip content={hint} position="top">
      <span
        role="timer"
        aria-live="off"
        aria-label={hint}
        data-tone={tone}
        className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-bold tabular-nums whitespace-nowrap cursor-default transition-colors ${TONE_CLASSES[tone]}`}
      >
        <Timer className={`w-3 h-3 ${tone === 'warn' ? 'animate-pulse' : ''}`} />
        {tone === 'expired' ? expiredText : time}
      </span>
    </Tooltip>
  );
};

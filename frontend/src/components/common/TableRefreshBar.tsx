import React from 'react';

/** Thin bar across the top of a table while new search / filter results load (the old rows stay, dimmed). */
export const TableRefreshBar: React.FC<{ active: boolean }> = ({ active }) => (
  <div
    aria-hidden
    className={`pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 bg-primary-500 transition-opacity duration-200 ${
      active ? 'opacity-100 animate-pulse' : 'opacity-0'
    }`}
  />
);

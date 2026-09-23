import React from 'react';

interface SparklineSeries {
  values: number[];
  className: string;
  dashed?: boolean;
}

interface SparklineProps {
  series: SparklineSeries[];
  /** Number of slots on the x axis (history size) so the line grows from the right. */
  capacity: number;
  height?: number;
}

/** Tiny dependency-free SVG line chart; y axis is fixed to 0-100 (%). */
export const Sparkline: React.FC<SparklineProps> = ({ series, capacity, height = 40 }) => {
  const width = 100;
  const step = capacity > 1 ? width / (capacity - 1) : width;
  const toPoints = (values: number[]) => {
    const offset = capacity - values.length;
    return values
      .map((v, i) => `${((offset + i) * step).toFixed(2)},${(height - (Math.max(0, Math.min(100, v)) / 100) * height).toFixed(2)}`)
      .join(' ');
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} aria-hidden="true">
      <line x1="0" x2={width} y1={height * 0.2} y2={height * 0.2} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="0.5" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      {series.map((s, i) =>
        s.values.length > 1 ? (
          <polyline
            key={i}
            points={toPoints(s.values)}
            fill="none"
            className={s.className}
            strokeWidth={s.dashed ? 1.25 : 2}
            strokeDasharray={s.dashed ? '3 2' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null,
      )}
    </svg>
  );
};

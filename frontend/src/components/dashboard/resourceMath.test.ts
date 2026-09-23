import { describe, expect, it } from 'vitest';
import { evaluateLevel, formatBytes, mergeSample, pushSample } from './resourceMath';
import { AppMetrics, SystemResources } from '../../types';

const backend: SystemResources = {
  sampled_at: '2026-09-23 10:00:00',
  system: { cpu_percent: 40, cpu_count: 8, ram_total: 8 * 1024 ** 3, ram_used: 4 * 1024 ** 3, ram_percent: 50 },
  backend: { pid: 1, rss: 200 * 1024 ** 2, cpu_percent: 5, child_count: 0 },
};

const electron: AppMetrics = {
  processes: [],
  totalCpuPercent: 10,
  totalWorkingSetBytes: 600 * 1024 ** 2,
  cpuCount: 8,
};

describe('mergeSample', () => {
  it('uses backend only when Electron metrics are missing', () => {
    const s = mergeSample(backend, undefined, 1);
    expect(s.appRamBytes).toBe(200 * 1024 ** 2);
    expect(s.appCpu).toBe(5);
    expect(s.sysCpu).toBe(40);
    expect(s.sysRamPct).toBe(50);
  });

  it('adds Electron processes to the app totals', () => {
    const s = mergeSample(backend, electron, 1);
    expect(s.appRamBytes).toBe(800 * 1024 ** 2);
    expect(s.appCpu).toBe(15);
    expect(s.appRamPct).toBeCloseTo(9.77, 1);
  });

  it('clamps CPU to 100', () => {
    const s = mergeSample({ ...backend, backend: { ...backend.backend, cpu_percent: 95 } }, electron, 1);
    expect(s.appCpu).toBe(100);
  });
});

describe('pushSample', () => {
  it('keeps at most `max` items, dropping the oldest', () => {
    let buf: number[] = [];
    for (let i = 0; i < 105; i++) buf = pushSample(buf, i, 100);
    expect(buf).toHaveLength(100);
    expect(buf[0]).toBe(5);
    expect(buf[99]).toBe(104);
  });
});

describe('evaluateLevel', () => {
  it('ignores a single spike', () => {
    expect(evaluateLevel([95, 50, 95])).toBe('ok');
  });
  it('warns after 3 consecutive samples above 80', () => {
    expect(evaluateLevel([10, 85, 85, 85])).toBe('warn');
  });
  it('is critical after 3 consecutive samples above 90', () => {
    expect(evaluateLevel([91, 92, 95])).toBe('crit');
  });
  it('mixed warn/crit tail is a warning', () => {
    expect(evaluateLevel([85, 95, 95])).toBe('warn');
  });
  it('needs enough samples', () => {
    expect(evaluateLevel([99, 99])).toBe('ok');
  });
});

describe('formatBytes', () => {
  it('formats MB and GB', () => {
    expect(formatBytes(512 * 1024 ** 2)).toBe('512 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(16 * 1024 ** 3)).toBe('16 GB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});

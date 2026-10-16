import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EportCutoffCell, effectiveCutoff, eportTooltip } from './EportCutoff';

const labels = { badge: 'ePort', tooltip: 'ePort {eport} / gốc {original}', tooltipNoOriginal: 'ePort {eport}' };

describe('EportCutoffCell', () => {
  it('shows the ePort time and its badge, without the booking\'s own time', () => {
    const { container } = render(<EportCutoffCell eport="23/09/2026 11:00" badge="ePort" />);
    expect(screen.getByText('23/09/2026 11:00')).toBeInTheDocument();
    expect(screen.getByText('ePort')).toBeInTheDocument();
    expect(container.querySelector('.line-through')).toBeNull();
  });

  it('builds the tooltip with or without the original', () => {
    expect(eportTooltip(labels, 'A', 'B')).toBe('ePort A / gốc B');
    expect(eportTooltip(labels, 'A', '')).toBe('ePort A');
    expect(eportTooltip(labels, 'A', 'null')).toBe('ePort A');
  });
});

describe('effectiveCutoff', () => {
  it("takes ePort's time when known, else the booking's own", () => {
    expect(effectiveCutoff({ 'Port Cargo Cut-off': '13/10/2026 19:00', 'Cut-off ePort': '15/10/2026 10:00' })).toBe('15/10/2026 10:00');
    expect(effectiveCutoff({ 'Port Cargo Cut-off': '13/10/2026 19:00', 'Cut-off ePort': '' })).toBe('13/10/2026 19:00');
    expect(effectiveCutoff({ 'Port Cargo Cut-off': '13/10/2026 19:00' })).toBe('13/10/2026 19:00');
  });
});

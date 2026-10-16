import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EportCutoffCell, eportTooltip } from './EportCutoff';

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

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EportCutoffCell, eportTooltip } from './EportCutoff';

const labels = { badge: 'ePort', tooltip: 'ePort {eport} / gốc {original}', tooltipNoOriginal: 'ePort {eport}' };

describe('EportCutoffCell', () => {
  it('leads with the ePort time and strikes through a different original', () => {
    render(<EportCutoffCell eport="23/09/2026 11:00" original="20/09/2026 03:00" badge="ePort" />);
    expect(screen.getByText('23/09/2026 11:00')).toBeInTheDocument();
    expect(screen.getByText('ePort')).toBeInTheDocument();
    expect(screen.getByText('20/09/2026 03:00').className).toContain('line-through');
  });

  it('shows no original when it is identical, blank or "null"', () => {
    const { rerender, container } = render(<EportCutoffCell eport="23/09/2026 11:00" original="23/09/2026 11:00" badge="ePort" />);
    expect(container.querySelector('.line-through')).toBeNull();
    rerender(<EportCutoffCell eport="23/09/2026 11:00" original="null" badge="ePort" />);
    expect(container.querySelector('.line-through')).toBeNull();
    rerender(<EportCutoffCell eport="23/09/2026 11:00" original="" badge="ePort" />);
    expect(container.querySelector('.line-through')).toBeNull();
  });

  it('builds the tooltip with or without the original', () => {
    expect(eportTooltip(labels, 'A', 'B')).toBe('ePort A / gốc B');
    expect(eportTooltip(labels, 'A', '')).toBe('ePort A');
    expect(eportTooltip(labels, 'A', 'null')).toBe('ePort A');
  });
});

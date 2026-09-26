import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ColorRule } from '../../types';

let rules: ColorRule[] = [];
vi.mock('../../context/AppContext', () => ({
  useColorRuleLookup: () => () => rules,
}));

import { ValueBadge } from './ValueBadge';

const rule = (match_value: string, match_type: string, preset_id: string, id = 1) =>
  ({ id, target_table: 'booking', column_key: 'Carrier', match_value, match_type, preset_id, is_enabled: true } as unknown as ColorRule);

describe('ValueBadge carrier colours (from DB colour rules)', () => {
  it('colours a carrier from its rule, case-insensitively', () => {
    rules = [rule('WAN HAI', 'contains', 'orange')];
    render(<ValueBadge table="booking" columnKey="Carrier" value="Wan Hai Lines" />);
    expect(screen.getByText('Wan Hai Lines').className).toContain('bg-orange-100');
  });

  it('has no hard-coded colour when no rule matches', () => {
    rules = [];
    render(<ValueBadge table="booking" columnKey="Carrier" value="ONE" />);
    expect(screen.getByText('ONE').className).not.toContain('bg-');
  });

  it('an exact short-code rule does not colour longer names containing it', () => {
    rules = [rule('ONE', 'exact', 'fuchsia')];
    render(<><ValueBadge table="booking" columnKey="Carrier" value="ONE" /><ValueBadge table="booking" columnKey="Carrier" value="PHONE LINE" /></>);
    expect(screen.getByText('ONE').className).toContain('bg-fuchsia-100');
    expect(screen.getByText('PHONE LINE').className).not.toContain('bg-');
  });
});

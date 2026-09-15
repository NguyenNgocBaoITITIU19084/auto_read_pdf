import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));

import { Tabs } from './Tabs';

describe('Tabs', () => {
  it('renders a Logs tab alongside the other main tabs', () => {
    render(<Tabs activeTab="dashboard" onChange={() => {}} />);
    expect(screen.getByText(translations.vi.tabs.logs)).toBeInTheDocument();
    expect(screen.getByText(translations.vi.tabs.dashboard)).toBeInTheDocument();
  });

  it('calls onChange with "logs" when the Logs tab is clicked', () => {
    const onChange = vi.fn();
    render(<Tabs activeTab="dashboard" onChange={onChange} />);
    screen.getByText(translations.vi.tabs.logs).click();
    expect(onChange).toHaveBeenCalledWith('logs');
  });
});

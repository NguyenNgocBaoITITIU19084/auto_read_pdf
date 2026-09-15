import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('./LogViewerPanel', () => ({ LogViewerPanel: () => <div data-testid="log-viewer-panel" /> }));

import { LogsTab } from './LogsTab';

describe('LogsTab', () => {
  it('renders a header and the shared log viewer panel', () => {
    render(<LogsTab />);
    expect(screen.getByText(translations.vi.logs.modalTitle)).toBeInTheDocument();
    expect(screen.getByTestId('log-viewer-panel')).toBeInTheDocument();
  });
});

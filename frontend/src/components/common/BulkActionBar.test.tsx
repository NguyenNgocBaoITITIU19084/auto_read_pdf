import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Trash2, FileSpreadsheet, ClipboardCopy, BookmarkPlus, RotateCw, FolderInput } from 'lucide-react';
import { BulkActionBar, type BulkAction } from './BulkActionBar';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi }),
}));

const makeActions = (): BulkAction[] => [
  { key: 'export', label: 'Xuất Excel', icon: FileSpreadsheet, onClick: vi.fn() },
  { key: 'copy', label: 'Sao chép', icon: ClipboardCopy, onClick: vi.fn() },
  { key: 'watch-add', label: 'Theo dõi', icon: BookmarkPlus, onClick: vi.fn() },
  { key: 'resync', label: 'Tra lại', icon: RotateCw, onClick: vi.fn() },
  { key: 'move', label: 'Chuyển', icon: FolderInput, onClick: vi.fn() },
  { key: 'delete', label: 'Xóa', icon: Trash2, onClick: vi.fn(), danger: true },
];

describe('BulkActionBar', () => {
  it('shows only the first 3 non-danger actions as labelled buttons, collapses the rest into "Thêm"', () => {
    render(<BulkActionBar count={2} onClear={vi.fn()} actions={makeActions()} />);

    expect(screen.getByRole('button', { name: 'Xuất Excel' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Sao chép' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Theo dõi' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Tra lại' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Chuyển' })).toBeNull();
    expect(screen.getByRole('button', { name: translations.vi.bulk.more })).not.toBeNull();
  });

  it('opens the "Thêm" menu to reveal overflow actions and fires their onClick', () => {
    const actions = makeActions();
    render(<BulkActionBar count={2} onClear={vi.fn()} actions={actions} />);

    fireEvent.click(screen.getByRole('button', { name: translations.vi.bulk.more }));
    const resyncItem = screen.getByRole('menuitem', { name: 'Tra lại' });
    expect(resyncItem).not.toBeNull();
    fireEvent.click(resyncItem);
    expect(actions.find((a) => a.key === 'resync')!.onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the danger action as a trailing icon-only button, unlike a labelled main button', () => {
    render(<BulkActionBar count={2} onClear={vi.fn()} actions={makeActions()} />);
    const deleteBtn = screen.getByRole('button', { name: 'Xóa' });
    const exportBtn = screen.getByRole('button', { name: 'Xuất Excel' });
    expect(deleteBtn.textContent?.trim()).toBe('');
    expect(exportBtn.textContent?.trim()).toBe('Xuất Excel');
  });

  it('does not render an overflow menu when there are 3 or fewer non-danger actions', () => {
    const actions = makeActions().filter((a) => ['watch-add', 'resync', 'delete'].includes(a.key));
    render(<BulkActionBar count={1} onClear={vi.fn()} actions={actions} />);
    expect(screen.queryByRole('button', { name: translations.vi.bulk.more })).toBeNull();
  });
});

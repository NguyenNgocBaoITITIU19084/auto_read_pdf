import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const ctx = vi.hoisted(() => ({
  collections: [
    { id: 1, name: 'Kho HCM', created_at: '2026-01-01 00:00:00', booking_count: 120, vessel_count: 8, container_count: 3200 },
    { id: 2, name: 'Kho Hải Phòng', created_at: '2026-02-01 00:00:00', booking_count: 40, vessel_count: 2, container_count: 900 },
  ],
  activeCollection: null as any,
  setActiveCollection: vi.fn(),
  refreshCollections: vi.fn(async () => undefined),
  handleCreateCollection: vi.fn(),
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, ...ctx }) }));

import { CollectionSwitcher, formatCount } from './CollectionSwitcher';
const c = translations.vi.collections;

beforeEach(() => {
  ctx.activeCollection = ctx.collections[0];
  ctx.setActiveCollection.mockReset();
  ctx.handleCreateCollection.mockReset();
});

describe('CollectionSwitcher', () => {
  it('formats counts compactly', () => {
    expect([formatCount(950), formatCount(3200), formatCount(12500), formatCount(1_200_000), formatCount(undefined)])
      .toEqual(['950', '3,2k', '12,5k', '1,2M', '0']);
  });

  it('opens, filters, and switches with the keyboard', async () => {
    render(<CollectionSwitcher onManage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    expect(ctx.refreshCollections).toHaveBeenCalled();
    const search = screen.getByPlaceholderText(c.searchPlaceholder);
    fireEvent.change(search, { target: { value: 'hải' } });
    const list = screen.getByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(ctx.setActiveCollection).toHaveBeenCalledWith(ctx.collections[1]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('creates a collection and switches to it', async () => {
    ctx.handleCreateCollection.mockResolvedValue({ id: 3, name: 'Kho Mới', created_at: '' });
    render(<CollectionSwitcher onManage={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    fireEvent.change(screen.getByPlaceholderText(c.newPlaceholder), { target: { value: ' Kho Mới ' } });
    fireEvent.click(screen.getByRole('button', { name: c.create }));
    await waitFor(() => expect(ctx.handleCreateCollection).toHaveBeenCalledWith('Kho Mới'));
    await waitFor(() => expect(ctx.setActiveCollection).toHaveBeenCalledWith(expect.objectContaining({ id: 3 })));
  });

  it('opens the manager', () => {
    const onManage = vi.fn();
    render(<CollectionSwitcher onManage={onManage} />);
    fireEvent.click(screen.getByRole('button', { name: /Kho HCM/ }));
    fireEvent.click(screen.getByRole('button', { name: c.manage }));
    expect(onManage).toHaveBeenCalled();
  });
});

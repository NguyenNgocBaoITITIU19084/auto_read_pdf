import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Copy, Trash2 } from 'lucide-react';
import { RowContextMenu, bulkMenuItems } from './RowContextMenu';

const groups = (onCopy = vi.fn(), onDelete = vi.fn()) => [
  { items: [{ key: 'copy', label: 'Sao chép dòng', icon: Copy, onClick: onCopy }] },
  { label: 'Đã chọn 2 dòng', items: [{ key: 'del', label: 'Xóa đã chọn', icon: Trash2, onClick: onDelete, danger: true }] },
];

describe('RowContextMenu', () => {
  it('renders nothing while closed', () => {
    render(<RowContextMenu position={null} groups={groups()} onClose={vi.fn()} />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows the groups (with captions) and closes before running the clicked action', () => {
    const order: string[] = [];
    const onClose = vi.fn(() => order.push('close'));
    const onCopy = vi.fn(() => order.push('copy'));
    render(<RowContextMenu position={{ x: 10, y: 10 }} groups={groups(onCopy)} onClose={onClose} />);
    expect(screen.getByText('Đã chọn 2 dòng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sao chép dòng' }));
    expect(order).toEqual(['close', 'copy']);
  });

  it('does not run disabled / loading items', () => {
    const onClick = vi.fn();
    render(
      <RowContextMenu
        position={{ x: 0, y: 0 }}
        onClose={vi.fn()}
        groups={[{ items: [
          { key: 'a', label: 'Tắt', icon: Copy, onClick, disabled: true },
          { key: 'b', label: 'Đang chạy', icon: Copy, onClick, loading: true },
        ] }]}
      />
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Tắt' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Đang chạy' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape, outside click and scroll, but not on a click inside', () => {
    const onClose = vi.fn();
    render(<div><span>outside</span><RowContextMenu position={{ x: 0, y: 0 }} groups={groups()} onClose={onClose} /></div>);
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByText('outside'));
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('moves focus with the arrow keys', () => {
    render(<RowContextMenu position={{ x: 0, y: 0 }} groups={groups()} onClose={vi.fn()} />);
    const [first, second] = screen.getAllByRole('menuitem');
    expect(first).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(second).toHaveFocus();
  });
});

describe('bulkMenuItems', () => {
  const actions = ['export', 'copy', 'delete'].map((key) => ({ key, label: key, icon: Copy, onClick: () => undefined }));
  it('drops copy/delete when only the clicked row is selected (its own entries replace them)', () => {
    expect(bulkMenuItems(actions, 1).map((a) => a.key)).toEqual(['export']);
    expect(bulkMenuItems(actions, 3).map((a) => a.key)).toEqual(['export', 'copy', 'delete']);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BookingStatusCell, BookingStatusLabels, statusOf } from './BookingStatus';

const labels: BookingStatusLabels = {
  labels: { new: 'Mới', dispatched: 'Đã điều xe', stuffed: 'Đã đóng hàng', gated_in: 'Đã hạ bãi', done: 'Hoàn tất', cancelled: 'Huỷ' },
  overdue: 'Trễ cut-off',
  overdueTooltip: 'quá giờ',
};

describe('BookingStatusCell', () => {
  it('shows the status by name and changes it from the menu', () => {
    const onChange = vi.fn();
    render(<BookingStatusCell status="stuffed" labels={labels} onChange={onChange} />);
    const button = screen.getByRole('button', { name: /Đã đóng hàng/ });
    fireEvent.click(button);
    expect(screen.getByRole('menuitemradio', { name: /Đã đóng hàng/ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Hoàn tất/ }));
    expect(onChange).toHaveBeenCalledWith('done');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not report picking the current status again', () => {
    const onChange = vi.fn();
    render(<BookingStatusCell status="new" labels={labels} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Mới/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('treats unknown or missing values as new', () => {
    expect(statusOf(undefined)).toBe('new');
    expect(statusOf('bogus')).toBe('new');
    expect(statusOf('gated_in')).toBe('gated_in');
  });
});

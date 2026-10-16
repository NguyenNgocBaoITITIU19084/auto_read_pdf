import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { ExportTemplate } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
const confirm = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirm }));

const { api, exportApi } = vi.hoisted(() => ({
  api: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  exportApi: vi.fn(),
}));
vi.mock('../../services/api', () => ({
  exportTemplatesApi: api,
  exportColumnsExcelApi: (...a: unknown[]) => exportApi(...a),
}));

import { ExportModal } from './ExportModal';

const e = translations.vi.exportManager;
const COLUMNS = [
  { key: 'STT', label: 'STT' },
  { key: 'Booking No', label: 'Số Booking' },
  { key: 'Carrier', label: 'Hãng tàu' },
];
const DATA = [{ 'Booking No': 'BK1', Carrier: 'ONE' }, { 'Booking No': 'BK2', Carrier: 'MSC' }];
const PLAN: ExportTemplate = {
  id: 7, tab: 'booking', name: 'Đội xe', filename: 'doi_xe_{date}',
  columns: [{ key: 'Carrier', header: 'Hãng', color: 'red', fill: 'column' }, { key: 'Booking No', header: '', color: '#1E88E5', fill: 'header' }],
  created_at: '', updated_at: '',
};

const open = (props = {}) => render(
  <ExportModal isOpen onClose={vi.fn()} data={DATA} allColumns={COLUMNS} tab="booking" filenamePrefix="bookings" collectionName="Test" {...props} />,
);
const radio = (name: string) => screen.getAllByRole('radio').find((r) => r.textContent?.includes(name)) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  addToast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockResolvedValue([PLAN]);
  exportApi.mockReset().mockResolvedValue(new Blob(['x']));
  (URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});   // no jsdom navigation
});

describe('ExportModal (quick export)', () => {
  it('opens on the template used last, with its file name and coloured headers, without the editor', async () => {
    localStorage.setItem('export_template_booking', '7');
    open();
    await waitFor(() => expect(radio('Đội xe').getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByDisplayValue('doi_xe_{date}')).toBeInTheDocument();
    expect(within(radio('Đội xe')).getByText('Hãng, Số Booking')).toBeInTheDocument();
    expect(screen.queryByText(e.managerTitle)).toBeNull();
  });

  it('exports the chosen template with headers falling back to the table labels', async () => {
    localStorage.setItem('export_template_booking', '7');
    const onClose = vi.fn();
    open({ onClose });
    await waitFor(() => expect(radio('Đội xe').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(e.export) }));
    await waitFor(() => expect(exportApi).toHaveBeenCalled());
    const [rows, columns, file] = exportApi.mock.calls[0];
    expect(columns).toEqual([
      { key: 'Carrier', header: 'Hãng', color: 'red', fill: 'column' },
      { key: 'Booking No', header: 'Số Booking', color: '#1E88E5', fill: 'header' },
    ]);
    expect(rows).toEqual([{ Carrier: 'ONE', 'Booking No': 'BK1' }, { Carrier: 'MSC', 'Booking No': 'BK2' }]);
    expect(file).toMatch(/^doi_xe_\d{2}-\d{2}-\d{4}\.xlsx$/);
    expect(onClose).toHaveBeenCalled();
  });

  it('exports every column with the built-in template', async () => {
    open();
    await screen.findByText('Đội xe');
    fireEvent.click(radio(e.builtIn));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(e.export) }));
    await waitFor(() => expect(exportApi).toHaveBeenCalled());
    expect(exportApi.mock.calls[0][1].map((c: any) => c.key)).toEqual(['STT', 'Booking No', 'Carrier']);
    expect(exportApi.mock.calls[0][0][1].STT).toBe(2);
  });

  it('deletes a template from the list after confirming', async () => {
    api.remove.mockResolvedValue(undefined);
    open();
    await screen.findByText('Đội xe');
    fireEvent.click(screen.getByLabelText(`${e.delete} Đội xe`));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('Đội xe')).toBeNull());
    expect(screen.getByText(e.noTemplatesHint)).toBeInTheDocument();
  });

  it('opens the template manager from the edit button', async () => {
    open();
    await screen.findByText('Đội xe');
    fireEvent.click(screen.getByLabelText(`${e.edit} Đội xe`));
    await screen.findByText(e.managerTitle);
    await waitFor(() => expect((screen.getByLabelText(e.name) as HTMLInputElement).value).toBe('Đội xe'));
  });

  it('inserts placeholders with a separator, shows their values and the resulting name', async () => {
    open();
    await screen.findByText('Đội xe');
    const input = screen.getByDisplayValue('bookings_{date}') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Đội xe số 1' } });
    input.setSelectionRange(11, 11);
    const dateButton = screen.getByRole('button', { name: /^Ngày: \d{2}-\d{2}-\d{4}$/ });
    fireEvent.click(dateButton);
    expect(input.value).toBe('Đội xe số 1 - {date}');
    input.setSelectionRange(input.value.length, input.value.length);
    fireEvent.click(screen.getByRole('button', { name: 'Bộ sưu tập: Test' }));
    expect(input.value).toBe('Đội xe số 1 - {date} - {collection}');
    expect(screen.getByText(/^Đội xe số 1 - \d{2}-\d{2}-\d{4} - Test\.xlsx$/)).toBeInTheDocument();
  });

  it('exports with the day-first date in the file name', async () => {
    localStorage.setItem('export_template_booking', '7');
    open();
    await waitFor(() => expect(radio('Đội xe').getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(e.export) }));
    await waitFor(() => expect(exportApi).toHaveBeenCalled());
    expect(exportApi.mock.calls[0][2]).toMatch(/^doi_xe_\d{2}-\d{2}-\d{4}\.xlsx$/);
  });

  it('previews the file of the chosen template and lists every column of each template', async () => {
    const many = Array.from({ length: 14 }, (_, n) => ({ 'Booking No': `BK${n + 1}`, Carrier: 'ONE' }));
    localStorage.setItem('export_template_booking', '7');
    open({ data: many });
    await waitFor(() => expect(radio('Đội xe').getAttribute('aria-checked')).toBe('true'));
    const headers = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Hãng', 'Số Booking']);
    expect(screen.getByText('BK10')).toBeInTheDocument();          // 10 rows shown
    expect(screen.queryByText('BK11')).toBeNull();
    expect(screen.getByText('10 / 14 dòng đầu · 2 cột')).toBeInTheDocument();
    fireEvent.click(radio(e.builtIn));
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['STT', 'Số Booking', 'Hãng tàu']);
  });

  it('sums up a template\'s columns on one line, the full list on hover', async () => {
    const long: ExportTemplate = { ...PLAN, id: 8, name: 'Dài', columns: Array.from({ length: 12 }, (_, n) => ({ key: `K${n}`, header: `Cột ${n + 1}`, color: null, fill: 'header' as const })) };
    api.list.mockResolvedValue([long]);
    open();
    await screen.findByText('Dài');
    const line = within(radio('Dài')).getByTitle(/^Cột 1, Cột 2, .*Cột 12$/);
    expect(line.className).toContain('truncate');
  });
});

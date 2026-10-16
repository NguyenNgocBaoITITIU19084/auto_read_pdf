import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { ExportTemplate } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, addToast }) }));
const confirm = vi.fn();
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirm }));

const { api } = vi.hoisted(() => ({ api: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() } }));
vi.mock('../../services/api', () => ({ exportTemplatesApi: api }));

import { ExportTemplateManager } from './ExportTemplateManager';

const e = translations.vi.exportManager;
const COLUMNS = [
  { key: 'STT', label: 'STT' },
  { key: 'Booking No', label: 'Số Booking' },
  { key: 'Carrier', label: 'Hãng tàu' },
];
const DATA = [{ 'Booking No': 'BK1', Carrier: 'ONE' }];
const PLAN: ExportTemplate = {
  id: 7, tab: 'booking', name: 'Đội xe', filename: 'doi_xe_{date}',
  columns: [{ key: 'Carrier', header: 'Hãng', color: 'red', fill: 'column' }, { key: 'Booking No', header: '', color: null, fill: 'header' }],
  created_at: '', updated_at: '',
};

const onChanged = vi.fn();
const onClose = vi.fn();
const open = (initial: number | 'new' = 7, templates = [PLAN]) => render(
  <ExportTemplateManager isOpen onClose={onClose} tab="booking" allColumns={COLUMNS} data={DATA} templates={templates}
    initial={initial} defaultFilename="bookings_{date}" onChanged={onChanged} />,
);
const nameInput = () => screen.getByLabelText(e.name) as HTMLInputElement;
const row = (label: string) => screen.getAllByText(label).map((el) => el.closest('li')).find(Boolean) as HTMLElement;
const keys = () => screen.getAllByRole('checkbox').map((b) => (b.closest('li') as HTMLElement).querySelector('span[title]')?.getAttribute('title'));

beforeEach(() => {
  addToast.mockReset();
  onChanged.mockReset();
  onClose.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  Object.values(api).forEach((f) => f.mockReset());
});

describe('ExportTemplateManager', () => {
  it('edits a template: template columns first, the others unticked after', async () => {
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    expect(keys()).toEqual(['Hãng tàu', 'Số Booking', 'STT']);
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((b) => b.checked)).toEqual([true, true, false]);
    expect(screen.queryByText(e.unsaved)).toBeNull();
  });

  it('reorders with the drag handle (keyboard) and saves', async () => {
    api.update.mockImplementation(async (id: number, input: any) => ({ ...PLAN, ...input, id }));
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    fireEvent.keyDown(screen.getByLabelText(`${e.dragHandle}: Số Booking`), { key: 'ArrowUp' });
    expect(keys()).toEqual(['Số Booking', 'Hãng tàu', 'STT']);
    expect(screen.getByText(e.unsaved)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${e.save}$`) }));
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(api.update.mock.calls[0][1].columns.map((c: any) => c.key)).toEqual(['Booking No', 'Carrier']);
    expect(onChanged).toHaveBeenCalledWith(expect.any(Array), 7);
  });

  it('reorders by dragging the handle onto another row', async () => {
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    const handle = screen.getByLabelText(`${e.dragHandle}: Số Booking`);
    const target = row('Hãng tàu');
    const original = document.elementFromPoint;
    document.elementFromPoint = () => target;                    // jsdom has no layout
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 5, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 5, clientY: 10 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    document.elementFromPoint = original;
    expect(keys()).toEqual(['Số Booking', 'Hãng tàu', 'STT']);
  });

  it('creates a template with a custom hex colour on the whole column', async () => {
    api.create.mockImplementation(async (tab: string, input: any) => ({ ...input, id: 9, tab, created_at: '', updated_at: '' }));
    open('new', []);
    await waitFor(() => expect(nameInput().value).toBe(e.newName));
    fireEvent.change(nameInput(), { target: { value: 'Báo khách' } });
    const fill = () => within(row('STT')).getByRole('button', { name: e.fillColumn });
    expect(fill()).toBeDisabled();
    fireEvent.click(screen.getByLabelText(`${e.colorTitle}: STT`));
    const hex = screen.getByLabelText(e.hexCode);
    fireEvent.change(hex, { target: { value: '1e88e5' } });
    fireEvent.click(screen.getByRole('button', { name: e.apply }));
    fireEvent.click(fill());
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${e.save}$`) }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const [tab, input] = api.create.mock.calls[0];
    expect(tab).toBe('booking');
    expect(input.name).toBe('Báo khách');
    expect(input.columns[0]).toEqual({ key: 'STT', header: '', color: '#1E88E5', fill: 'column' });
    expect(onChanged).toHaveBeenCalledWith([expect.objectContaining({ id: 9 })], 9);
  });

  it('picks a palette colour and renames a column in the preview', async () => {
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    fireEvent.click(screen.getByLabelText(`${e.colorTitle}: Số Booking`));
    fireEvent.click(screen.getByRole('button', { name: 'green' }));
    fireEvent.change(screen.getByLabelText(`Số Booking: ${e.renamePlaceholder}`), { target: { value: 'Số BK' } });
    const header = screen.getAllByRole('columnheader').find((th) => th.textContent === 'Số BK') as HTMLElement;
    expect(header.style.background).toBe('rgb(39, 174, 96)');
  });

  it('asks before dropping unsaved changes and deletes from the list', async () => {
    api.remove.mockResolvedValue(undefined);
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    fireEvent.change(nameInput(), { target: { value: 'Đội xe 2' } });
    confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: e.close }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(`${e.delete} Đội xe`));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(7));
    expect(onChanged).toHaveBeenCalledWith([], null);
  });

  it('keeps the edits on screen and warns when the server stored something else', async () => {
    // an older backend drops the custom colour
    api.update.mockImplementation(async (id: number, input: any) => ({
      ...PLAN, ...input, id, columns: input.columns.map((c: any) => ({ ...c, color: c.color?.startsWith('#') ? null : c.color })),
    }));
    open();
    await waitFor(() => expect(nameInput().value).toBe('Đội xe'));
    fireEvent.click(screen.getByLabelText(`${e.colorTitle}: Số Booking`));
    fireEvent.change(screen.getByLabelText(e.hexCode), { target: { value: '#00897B' } });
    fireEvent.click(screen.getByRole('button', { name: e.apply }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${e.save}$`) }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(e.savedPartially, 'error'));
    const swatch = screen.getByLabelText(`${e.colorTitle}: Số Booking`).querySelector('span') as HTMLElement;
    expect(swatch.style.background).toBe('rgb(0, 137, 123)');          // still shown
    expect(screen.getByText(e.unsaved)).toBeInTheDocument();            // and still to be saved
  });
});

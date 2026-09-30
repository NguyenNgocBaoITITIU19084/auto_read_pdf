import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { ImageExtractResult } from '../../types';

const addToast = vi.fn();
const collection = { id: 1, name: 'Test' };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, activeCollection: collection }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));
vi.mock('../common/Modal', () => ({ Modal: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null) }));
vi.mock('../common/AISettingsCard', () => ({ AISettingsCard: () => <div>ai-settings</div> }));
vi.mock('./QuickVesselSearch', () => ({ QuickVesselSearch: () => null }));
vi.mock('./useCarrierBadge', () => ({ useCarrierBadge: () => ({ style: {}, className: '' }) }));

const extract = vi.fn();
const saveManual = vi.fn();
vi.mock('../../services/api', () => ({
  extractBookingImageDetailedApi: (...a: unknown[]) => extract(...a),
  checkBookingDuplicatesApi: vi.fn().mockResolvedValue([]),
  saveManualBookingApi: (...a: unknown[]) => saveManual(...a),
}));

import { ImageQueueProvider, useImageQueue } from '../../context/ImageQueueContext';
import { ImageBookingModal } from './ImageBookingModal';

const q = translations.vi.booking.imageQueue;
const png = (name: string, size = 5) => new File([new Uint8Array(size)], name, { type: 'image/png', lastModified: 1 });
const good = (no: string): ImageExtractResult => ({
  data: { 'Booking No': no, Carrier: 'PIL', Vessel: 'KOTA NEKAD 0272S', ETD: '14/07/2026' },
  engine_used: 'gemini', warnings: [], model_used: 'gemini-2.5-flash',
});

beforeEach(() => {
  addToast.mockReset();
  extract.mockReset();
  saveManual.mockReset().mockImplementation(async (_c: number, b: any) => ({ item: { id: 7, ...b }, warnings: [] }));
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

const setup = (props: Partial<React.ComponentProps<typeof ImageBookingModal>> = {}) => {
  const onClose = vi.fn();
  const onPdfFiles = vi.fn();
  const utils = render(
    <ImageQueueProvider><ImageBookingModal isOpen onClose={onClose} onPdfFiles={onPdfFiles} {...props} /></ImageQueueProvider>
  );
  const pick = (files: File[]) => {
    const input = utils.container.querySelector('input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  };
  return { ...utils, onClose, onPdfFiles, pick };
};

describe('ImageBookingModal (reading queue)', () => {
  it('reads several images, showing which succeeded / failed and who read them', async () => {
    extract
      .mockResolvedValueOnce(good('SGN1'))
      .mockResolvedValueOnce({ data: {}, engine_used: 'gemini', warnings: ['Không tìm thấy thông tin booking trong ảnh.'] })
      .mockResolvedValueOnce({ ...good('SGN3'), engine_used: 'ocr', model_used: null, warnings: ['Gemini trả về lỗi (503)'] });
    const { pick } = setup();
    pick([png('a.png'), png('b.png'), png('c.png')]);

    const list = await screen.findByRole('listbox');
    await waitFor(() => expect(within(list).getByText(q.status.failed)).toBeInTheDocument());
    await waitFor(() => expect(within(list).getByText(q.status.review)).toBeInTheDocument());
    expect(within(list).getByText(q.status.success)).toBeInTheDocument();
    expect(within(list).getByText(/gemini-2\.5-flash/)).toBeInTheDocument();        // which model read it
    expect(within(list).getByText(translations.vi.booking.paste.engineOcr)).toBeInTheDocument();
    expect(within(list).getByText(/Không tìm thấy thông tin booking/)).toBeInTheDocument();
    expect(screen.getByText(/1 thành công · 1 cần kiểm tra · 1 thất bại/)).toBeInTheDocument();
    expect(extract).toHaveBeenCalledTimes(3); // each image is read exactly once, even when the answers come back instantly
  });

  it('shows the extracted fields of the clicked image and marks what the user edited', async () => {
    extract.mockResolvedValueOnce(good('SGN1')).mockResolvedValueOnce(good('SGN2'));
    const { pick } = setup();
    pick([png('a.png'), png('b.png')]);
    await waitFor(() => expect(screen.getAllByText(q.status.success)).toHaveLength(2 + 1)); // 2 rows + the header chip

    fireEvent.click(screen.getAllByRole('option')[1]);
    const bookingNo = screen.getByDisplayValue('SGN2') as HTMLInputElement;
    expect(bookingNo).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('PIL'), { target: { value: 'PIL LINE' } });
    expect(screen.getByDisplayValue('PIL LINE').className).toContain('amber');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${q.aiOriginal} · 1 ${q.edited}`) }));
    expect(screen.getByText('PIL')).toBeInTheDocument();                              // the untouched AI value stays visible
  });

  it('a failed image cannot be saved; a good one saves the edited values and the modal moves on / closes', async () => {
    extract.mockResolvedValueOnce(good('SGN1')).mockResolvedValueOnce({ data: {}, engine_used: 'none', warnings: ['x'] });
    const { pick, onClose } = setup();
    pick([png('a.png'), png('b.png')]);
    await waitFor(() => expect(screen.getByText(q.status.failed)).toBeInTheDocument());

    const saveBtn = () => screen.getByRole('button', { name: translations.vi.booking.imageModal.saveToCollection });
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(saveBtn()).toBeDisabled();

    fireEvent.click(screen.getAllByRole('option')[0]);
    fireEvent.change(screen.getByDisplayValue('SGN1'), { target: { value: 'SGN1X' } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(saveManual).toHaveBeenCalledWith(1, expect.objectContaining({ 'Booking No': 'SGN1X', 'Tên file PDF': 'a.png' })));
    expect(onClose).not.toHaveBeenCalled();                                            // the failed image is still waiting
    await waitFor(() => expect(screen.getAllByText(q.status.saved).length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: new RegExp(q.saveAll.replace(' ({count})', '')) })).toBeDisabled();
  });

  it('a single image behaves like before: no list, save closes the window', async () => {
    extract.mockResolvedValueOnce(good('SGN1'));
    const { pick, onClose } = setup();
    pick([png('a.png')]);
    await waitFor(() => expect(screen.getByDisplayValue('SGN1')).toBeInTheDocument());
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: translations.vi.booking.imageModal.saveToCollection }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('hands PDFs back to the parent and keeps only images in the queue', async () => {
    extract.mockResolvedValue(good('SGN1'));
    const { pick, onPdfFiles } = setup();
    const pdf = new File([new Uint8Array(3)], 'b.pdf', { type: 'application/pdf' });
    pick([png('a.png'), pdf]);
    await waitFor(() => expect(onPdfFiles).toHaveBeenCalledWith([pdf]));
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('warns once, for the whole batch, when Gemini has no key', async () => {
    extract.mockResolvedValue({ ...good('SGN1'), engine_used: 'ocr', model_used: null, gemini_error_kind: 'no_key', warnings: ['no key'] });
    const { pick } = setup();
    pick([png('a.png'), png('b.png')]);
    await waitFor(() => expect(screen.getAllByText(q.noKey)).toHaveLength(1));
  });

  /** Enqueues through the app-wide queue and passes the first new id as the focus hint, like the Booking tab does. */
  const FocusHarness: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const queue = useImageQueue();
    const [focus, setFocus] = React.useState<string | null>(null);
    return (
      <>
        <button onClick={() => { const r = queue.enqueue([png('a.png'), png('b.png')], 'drop'); setFocus(r.ids[0]); }}>drop-two</button>
        <button onClick={() => queue.enqueue([png('c.png')], 'drop')}>add-third</button>
        <ImageBookingModal isOpen onClose={onClose} focusItemId={focus} />
      </>
    );
  };

  it('focus is a one-shot hint: the user can pick another image, edit it and let more reads finish without snapping back', async () => {
    extract.mockResolvedValueOnce(good('SGN1')).mockResolvedValueOnce(good('SGN2')).mockResolvedValueOnce(good('SGN3'));
    render(<ImageQueueProvider><FocusHarness onClose={vi.fn()} /></ImageQueueProvider>);
    fireEvent.click(screen.getByText('drop-two'));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    await waitFor(() => expect(screen.getAllByText(q.status.success)).toHaveLength(3));   // 2 rows + header chip
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');    // focused on the first new image

    fireEvent.click(screen.getAllByRole('option')[1]);
    fireEvent.change(screen.getByDisplayValue('SGN2'), { target: { value: 'SGN2X' } });   // every keystroke changes the items
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByText('add-third'));                                       // another read finishes later
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getAllByText(q.status.success).length).toBeGreaterThanOrEqual(3));
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByDisplayValue('SGN2X')).toBeInTheDocument();
  });

  it('closing discards a lone image the user just brought in, but not a phone photo or a batch', async () => {
    extract.mockResolvedValue(good('SGN1'));
    const Lone: React.FC<{ source: 'paste' | 'phone'; count: number; onClose: () => void }> = ({ source, count, onClose }) => {
      const queue = useImageQueue();
      return (
        <>
          <button onClick={() => queue.enqueue(Array.from({ length: count }, (_, i) => png(`${source}${i}.png`, i + 1)), source)}>add</button>
          <span data-testid="count">{queue.items.length}</span>
          <ImageBookingModal isOpen onClose={onClose} />
        </>
      );
    };
    const run = async (source: 'paste' | 'phone', count: number) => {
      const onClose = vi.fn();
      const view = render(<ImageQueueProvider><Lone source={source} count={count} onClose={onClose} /></ImageQueueProvider>);
      fireEvent.click(screen.getByText('add'));
      await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent(String(count)));
      await waitFor(() => expect(screen.queryByText(q.status.reading)).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: translations.vi.common.close }));
      expect(onClose).toHaveBeenCalled();
      const left = screen.getByTestId('count').textContent;
      view.unmount();
      return left;
    };
    expect(await run('paste', 1)).toBe('0');   // discarded
    expect(await run('phone', 1)).toBe('1');   // kept
    expect(await run('paste', 2)).toBe('2');   // a batch keeps running
  });

  it('a selected image can be removed from the footer', async () => {
    extract.mockResolvedValueOnce(good('SGN1')).mockResolvedValueOnce(good('SGN2'));
    const { pick } = setup();
    pick([png('a.png'), png('b.png')]);
    await waitFor(() => expect(screen.getAllByText(q.status.success)).toHaveLength(3));
    fireEvent.click(screen.getAllByRole('button', { name: q.remove }).find((b) => b.className.includes('rounded-xl'))!);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());               // one image left: back to the plain view
  });

  it('accepts a drop anywhere on the window, not just on the empty drop area', async () => {
    extract.mockResolvedValueOnce(good('SGN1')).mockResolvedValueOnce(good('SGN2'));
    const { pick, container } = setup();
    pick([png('a.png')]);
    await waitFor(() => expect(screen.getByDisplayValue('SGN1')).toBeInTheDocument());   // a preview is showing now
    const target = screen.getByDisplayValue('SGN1');
    fireEvent.drop(target, { dataTransfer: { files: [png('b.png')] } });
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(container).toBeTruthy();
  });
});

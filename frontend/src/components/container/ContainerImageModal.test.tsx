import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';
import type { ContainerImageResult } from '../../types';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));
vi.mock('../common/AISettingsCard', () => ({ AISettingsCard: () => <div>ai-settings</div> }));
vi.mock('../common/Modal', () => ({ Modal: ({ isOpen, children }: any) => (isOpen ? <div>{children}</div> : null) }));
const extract = vi.fn();
vi.mock('../../services/api', () => ({ extractContainerImageApi: (...a: unknown[]) => extract(...a) }));

import { ContainerImageQueueProvider } from '../../context/ContainerImageQueueContext';
import { ContainerImageModal } from './ContainerImageModal';

const L = translations.vi.container.imageOcr;
const B = translations.vi.booking;
const png = (name: string) => new File([name], name, { type: 'image/png', lastModified: 1 });
const read = (no: string, over: Partial<ContainerImageResult> = {}): ContainerImageResult => ({
  data: { container_no: no, tare_kg: 3700, max_gross_kg: 32500, check_digit_ok: true },
  engine_used: 'gemini', warnings: [], model_used: 'gemini-2.5-flash', gemini_error_kind: null, ...over,
});

const setup = (lookup: (no: string) => Promise<{ count: number; message?: string }> = async () => ({ count: 2 })) => {
  const onLookup = vi.fn(lookup);
  const onClose = vi.fn();
  const onSiteChange = vi.fn();
  const utils = render(
    <ContainerImageQueueProvider>
      <ContainerImageModal isOpen onClose={onClose} siteId="CTL" onSiteChange={onSiteChange} collectionName="Bộ A" onLookup={onLookup} />
    </ContainerImageQueueProvider>
  );
  const pick = (...files: File[]) => fireEvent.change(utils.container.querySelector('input[type=file]')!, { target: { files } });
  return { onLookup, onClose, onSiteChange, pick, ...utils };
};

beforeEach(() => {
  addToast.mockReset();
  extract.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('ContainerImageModal', () => {
  it('shows the same dropzone as the booking reader while the queue is empty', () => {
    setup();
    expect(screen.getByText(B.imageModal.dropOrPaste)).toBeInTheDocument();
  });

  it('reads a photo and shows container number, tare and max gross with a valid check digit', async () => {
    extract.mockResolvedValue(read('HPCU5330042'));
    const { pick } = setup();
    pick(png('a.png'));
    await waitFor(() => expect(screen.getByDisplayValue('HPCU5330042')).toBeInTheDocument());
    expect(screen.getByDisplayValue('3700')).toBeInTheDocument();
    expect(screen.getByDisplayValue('32500')).toBeInTheDocument();
    expect(screen.getByText(L.checkOk)).toBeInTheDocument();
    expect(screen.getByText('Lưu vào: Bộ A · Cảng: CTL')).toBeInTheDocument();
  });

  it('warns when the check digit does not match and marks the photo for review', async () => {
    extract.mockResolvedValue(read('HPCU5330043', { warnings: ['sai chữ số kiểm tra'] }));
    const { pick } = setup();
    pick(png('a.png'));
    await waitFor(() => expect(screen.getByText(L.issueCheck)).toBeInTheDocument());
    expect(screen.getAllByText(L.status.review).length).toBeGreaterThan(0);
  });

  it('editing the number re-validates it and highlights it as edited', async () => {
    extract.mockResolvedValue(read('HPCU5330043'));
    const { pick } = setup();
    pick(png('a.png'));
    const input = await screen.findByDisplayValue('HPCU5330043');
    fireEvent.change(input, { target: { value: 'hpcu 5330042' } });
    expect(screen.getByDisplayValue('HPCU5330042')).toBeInTheDocument();
    expect(screen.getByText(L.checkOk)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(B.imageQueue.edited))).toBeInTheDocument();
  });

  it('approving looks the container up on ePort, adds it to the table and closes when it was the last photo', async () => {
    extract.mockResolvedValue(read('HPCU5330042'));
    const { pick, onLookup, onClose } = setup();
    pick(png('a.png'));
    await screen.findByDisplayValue('HPCU5330042');
    fireEvent.click(screen.getByRole('button', { name: L.lookupAndAdd }));
    await waitFor(() => expect(onLookup).toHaveBeenCalledWith('HPCU5330042'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(addToast).toHaveBeenCalledWith('Đã thêm HPCU5330042 vào bảng: tìm thấy 2 kết quả', 'success');
  });

  it('keeps the photo for another try when ePort does not know the container', async () => {
    extract.mockResolvedValue(read('HPCU5330042'));
    const { pick, onClose } = setup(async () => ({ count: 0 }));
    pick(png('a.png'));
    await screen.findByDisplayValue('HPCU5330042');
    fireEvent.click(screen.getByRole('button', { name: L.lookupAndAdd }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Không tìm thấy cont HPCU5330042 trên ePort', 'info'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: L.lookupAndAdd })).toBeEnabled();
  });

  it('shows the error and keeps the photo when the lookup request fails', async () => {
    extract.mockResolvedValue(read('HPCU5330042'));
    const { pick } = setup(async () => { throw new Error('boom'); });
    pick(png('a.png'));
    await screen.findByDisplayValue('HPCU5330042');
    fireEvent.click(screen.getByRole('button', { name: L.lookupAndAdd }));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Tra cứu thất bại: boom', 'error'));
  });

  it('lets the user pick the terminal used for the lookup', () => {
    const { onSiteChange } = setup();
    fireEvent.change(screen.getByLabelText(L.site), { target: { value: 'GNL' } });
    expect(onSiteChange).toHaveBeenCalledWith('GNL');
  });

  it('looks up every successful photo of the batch, skipping duplicates and bad check digits', async () => {
    extract
      .mockResolvedValueOnce(read('HPCU5330042'))
      .mockResolvedValueOnce(read('CSQU3054383'))
      .mockResolvedValueOnce(read('HPCU5330042'))      // same container again: skipped
      .mockResolvedValueOnce(read('HPCU5330043'));     // bad check digit: needs review, skipped
    const { pick, onLookup } = setup(async (no) => ({ count: no === 'CSQU3054383' ? 0 : 1 }));
    pick(png('a.png'), png('b.png'), png('c.png'), png('d.png'));
    const button = await screen.findByRole('button', { name: 'Tra cứu & thêm tất cả ảnh Thành công (2)' }, { timeout: 3000 });
    fireEvent.click(button);
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('Đã thêm 1 cont vào bảng, 1 cont không có trên ePort', 'info'));
    expect(onLookup.mock.calls.map((c) => c[0])).toEqual(['HPCU5330042', 'CSQU3054383']);
  });

  it('tells the user to resume when Gemini quota is used up', async () => {
    extract.mockResolvedValue(read('HPCU5330042', { gemini_error_kind: 'quota', engine_used: 'ocr' }));
    const { pick } = setup();
    pick(png('a.png'));
    expect(await screen.findByText(L.pausedQuota)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.resume })).toBeInTheDocument();
  });
});

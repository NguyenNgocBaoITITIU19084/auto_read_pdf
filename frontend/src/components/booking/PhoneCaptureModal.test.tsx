import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ t: translations.vi, language: 'vi' }),
}));

const addToastMock = vi.fn();
vi.mock('../../context/ToastContext', () => ({
  useToastActions: () => ({ addToast: addToastMock, removeToast: vi.fn() }),
}));

const toCanvasMock = vi.fn().mockResolvedValue(undefined);
vi.mock('qrcode', () => ({
  default: { toCanvas: (...args: unknown[]) => toCanvasMock(...args) },
  toCanvas: (...args: unknown[]) => toCanvasMock(...args),
}));

const startMock = vi.fn().mockResolvedValue(undefined);
const stopMock = vi.fn().mockResolvedValue(undefined);
let mockSession: any = null;
vi.mock('../../context/MobileBridgeContext', () => ({
  useMobileBridge: () => ({
    session: mockSession,
    status: mockSession?.active ? 'active' : 'idle',
    queue: [],
    start: startMock,
    stop: stopMock,
    takeNext: () => null,
    onPhotoArrived: () => () => {},
  }),
}));

import { PhoneCaptureModal } from './PhoneCaptureModal';

const p = translations.vi.booking.phone;

beforeEach(() => {
  vi.clearAllMocks();
  mockSession = null;
});

describe('PhoneCaptureModal', () => {
  it('draws the QR code once a pair_url is available', async () => {
    mockSession = {
      active: true,
      pair_url: 'http://192.168.1.5:8765/#p=abc',
      ips: ['192.168.1.5'],
      selected_ip: '192.168.1.5',
      devices: [],
      pending: [],
    };
    render(<PhoneCaptureModal isOpen onClose={() => {}} />);
    await waitFor(() => {
      expect(toCanvasMock).toHaveBeenCalledWith(
        expect.anything(),
        'http://192.168.1.5:8765/#p=abc',
        expect.objectContaining({ width: 240, margin: 1 })
      );
    });
  });

  it('shows an IP dropdown only when there is more than one candidate IP', async () => {
    mockSession = {
      active: true,
      pair_url: 'http://192.168.1.5:8765/#p=abc',
      ips: ['192.168.1.5', '10.0.0.2'],
      selected_ip: '192.168.1.5',
      devices: [],
      pending: [],
    };
    render(<PhoneCaptureModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('does not show an IP dropdown with a single candidate IP', () => {
    mockSession = {
      active: true,
      pair_url: 'http://192.168.1.5:8765/#p=abc',
      ips: ['192.168.1.5'],
      selected_ip: '192.168.1.5',
      devices: [],
      pending: [],
    };
    render(<PhoneCaptureModal isOpen onClose={() => {}} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('calls stop() when "Ngắt kết nối" is clicked', () => {
    mockSession = {
      active: true,
      pair_url: 'http://192.168.1.5:8765/#p=abc',
      ips: ['192.168.1.5'],
      selected_ip: '192.168.1.5',
      devices: [],
      pending: [],
    };
    render(<PhoneCaptureModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: p.disconnect }));
    expect(stopMock).toHaveBeenCalled();
  });

  it('closing the modal does not stop the session', () => {
    mockSession = {
      active: true,
      pair_url: 'http://192.168.1.5:8765/#p=abc',
      ips: ['192.168.1.5'],
      selected_ip: '192.168.1.5',
      devices: [],
      pending: [],
    };
    const onClose = vi.fn();
    render(<PhoneCaptureModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: translations.vi.common.close }));
    expect(onClose).toHaveBeenCalled();
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('calls start() on open when there is no active session yet', () => {
    mockSession = null;
    render(<PhoneCaptureModal isOpen onClose={() => {}} />);
    expect(startMock).toHaveBeenCalled();
  });
});

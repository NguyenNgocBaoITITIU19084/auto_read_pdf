import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { translations } from '../../i18n/translations';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, activeCollection: { id: 1, name: 'Test' } }) }));
vi.mock('../../context/ToastContext', () => ({ useToastActions: () => ({ addToast }) }));

const photo = (n: number) => new File([new Uint8Array(n)], `p${n}.jpg`, { type: 'image/jpeg' });
let buffer: File[] = [];
const takeNext = vi.fn(() => buffer.shift() ?? null);
const mobile = { get queue() { return buffer; }, takeNext };
vi.mock('../../context/MobileBridgeContext', () => ({ useMobileBridge: () => mobile }));

const enqueue = vi.fn((files: File[], _source?: string) => ({ ids: files.map((_, i) => `i${i}`), added: files.length, duplicates: 0, rejected: 0 }));
let room = 60;
vi.mock('../../context/ImageQueueContext', () => ({ useImageQueue: () => ({ enqueue, room }) }));

import { PhoneToImageQueue } from './PhoneToImageQueue';

describe('PhoneToImageQueue', () => {
  beforeEach(() => {
    addToast.mockReset();
    enqueue.mockClear();
    takeNext.mockClear();
    room = 60;
    buffer = [];
  });

  it('moves every waiting photo into the reading queue', () => {
    buffer = [photo(1), photo(2), photo(3)];
    render(<PhoneToImageQueue />);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0][0]).toHaveLength(3);
    expect(enqueue.mock.calls[0][1]).toBe('phone');
    expect(buffer).toHaveLength(0);
  });

  it('takes only what fits and leaves the rest in the phone buffer (a taken photo is acked and could not be recovered)', () => {
    room = 2;
    buffer = [photo(1), photo(2), photo(3), photo(4)];
    render(<PhoneToImageQueue />);
    expect(enqueue.mock.calls[0][0]).toHaveLength(2);
    expect(buffer).toHaveLength(2);
  });

  it('takes nothing while the queue is full', () => {
    room = 0;
    buffer = [photo(1)];
    render(<PhoneToImageQueue />);
    expect(takeNext).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

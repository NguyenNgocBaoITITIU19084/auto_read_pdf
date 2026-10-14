import { describe, expect, it } from 'vitest';
import { identifyBookingFile } from './clipboard';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const PDF = [...'%PDF-1.4\n'].map((c) => c.charCodeAt(0));
const file = (bytes: number[], name: string, type = '') => new File([new Uint8Array(bytes)], name, { type });

describe('identifyBookingFile', () => {
  it('reads a photo saved under a .pdf name as an image', async () => {
    const f = await identifyBookingFile(file(PNG, 'booking.pdf', 'application/pdf'));
    expect(f?.name).toBe('booking.png');
    expect(f?.type).toBe('image/png');
  });

  it('recognises images and PDFs without an extension or type', async () => {
    expect((await identifyBookingFile(file(PNG, 'chup-man-hinh')))?.type).toBe('image/png');
    expect((await identifyBookingFile(file(PDF, 'download')))?.name).toBe('download.pdf');
  });

  it('keeps correctly named files as they are and rejects other files', async () => {
    const png = file(PNG, 'a.png', 'image/png');
    expect(await identifyBookingFile(png)).toBe(png);
    const pdf = file(PDF, 'b.pdf', 'application/pdf');
    expect(await identifyBookingFile(pdf)).toBe(pdf);
    expect(await identifyBookingFile(file([0x68, 0x69], 'notes.txt', 'text/plain'))).toBeNull();
  });
});

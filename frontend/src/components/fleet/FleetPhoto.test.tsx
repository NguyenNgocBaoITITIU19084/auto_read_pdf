import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { translations } from '../../i18n/translations';

vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));

import { PhotoPicker, initials, photoProblem, type PhotoChoice } from './FleetPhoto';

const p = translations.vi.fleet.photo;
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

describe('FleetPhoto', () => {
  it('makes initials from the last words of a Vietnamese name', () => {
    expect(initials('Nguyễn Văn An')).toBe('VA');
    expect(initials('Bảo')).toBe('B');
    expect(initials('  ')).toBe('?');
  });

  it('rejects HEIC, non-images and huge files before uploading', () => {
    expect(photoProblem(file('a.HEIC', ''))).toBe('heic');
    expect(photoProblem(file('a.pdf', 'application/pdf'))).toBe('notImage');
    expect(photoProblem(file('a.jpg', 'image/jpeg', 16 * 1024 * 1024))).toBe('tooLarge');
    expect(photoProblem(file('a.png', 'image/png'))).toBeNull();
  });

  it('picks a file, refuses a bad one and marks a stored photo for removal', () => {
    const onChange = vi.fn();
    const onError = vi.fn();
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
    globalThis.URL.revokeObjectURL = vi.fn();
    const value: PhotoChoice = { file: null, remove: false };
    render(<PhotoPicker kind="driver" name="An" current="driver_1_0a1b2c3d.jpg" value={value} onChange={onChange} onError={onError} />);

    const input = screen.getByTestId('driver-photo-input');
    fireEvent.change(input, { target: { files: [file('x.heic', 'image/heic')] } });
    expect(onError).toHaveBeenLastCalledWith(p.heic);
    expect(onChange).not.toHaveBeenCalled();

    const good = file('x.png', 'image/png');
    fireEvent.change(input, { target: { files: [good] } });
    expect(onChange).toHaveBeenLastCalledWith({ file: good, remove: false });

    fireEvent.click(screen.getByText(p.remove));
    expect(onChange).toHaveBeenLastCalledWith({ file: null, remove: true });
  });
});

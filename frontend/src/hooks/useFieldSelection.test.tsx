import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { translations } from '../i18n/translations';

vi.mock('../context/AppContext', () => ({ useApp: () => ({ t: translations.vi }) }));

import { useFieldSelection } from './useFieldSelection';

/** A field card holding `text`, as the detail modals render it. */
function mountCard(key: string, text: string) {
  const card = document.createElement('div');
  card.setAttribute('data-field-key', key);
  card.textContent = text;
  document.body.appendChild(card);
  return card.firstChild as Text;
}

function select(node: Text, end: number) {
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, end);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('useFieldSelection pending part', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('offers the highlighted part of a card', () => {
    const node = mountCard('Port of Discharging', 'NORFOLK, VA');
    const { result } = renderHook(() => useFieldSelection('a'));
    act(() => select(node, 7));
    expect(result.current.pendingPart).toEqual({ key: 'Port of Discharging', text: 'NORFOLK' });
  });

  it('follows the highlight live while the mouse is still down', () => {
    const node = mountCard('Vessel', 'YEOSU VOYAGER 2608S');
    const { result } = renderHook(() => useFieldSelection('a'));

    act(() => { document.dispatchEvent(new MouseEvent('mousedown', { button: 0 })); });
    act(() => select(node, 5));
    expect(result.current.pendingPart).toEqual({ key: 'Vessel', text: 'YEOSU' });
    act(() => select(node, 13));
    expect(result.current.pendingPart).toEqual({ key: 'Vessel', text: 'YEOSU VOYAGER' });
  });
});

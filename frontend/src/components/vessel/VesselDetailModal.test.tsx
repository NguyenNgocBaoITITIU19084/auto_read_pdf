import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CLICK_TOGGLE_DELAY_MS } from '../../hooks/useFieldSelection';
import { translations } from '../../i18n/translations';
import { tf } from '../../services/i18nFormat';

const addToast = vi.fn();
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ t: translations.vi, language: 'vi', addToast }) }));

import { VesselDetailModal } from './VesselDetailModal';

const schedule: any = {
  id: 7, site_id: 'CTL', agent: 'HDM', vessel_name: 'HMM HOPE', in_out_voyage: '062E-062E',
  closing_time: '11:00 23/09/2026', closing_time_icd: '', queried_at: '2026-09-30 10:00:00',
};

const f = translations.vi.common.fieldCopy;
const writeText = vi.fn().mockResolvedValue(undefined);

/** The selectable card holding `text` (the header banner repeats some values). */
const cardWith = (text: string) =>
  screen.getAllByText(text).map((el) => el.closest('[role=checkbox]')).find(Boolean) as HTMLElement;

/** A single click ticks a card once the double-click window has passed. */
const clickCard = async (card: HTMLElement) => {
  fireEvent.click(card, { detail: 1 });
  await act(() => new Promise((r) => setTimeout(r, CLICK_TOGGLE_DELAY_MS + 20)));
};

describe('VesselDetailModal – copy several fields', () => {
  beforeEach(() => {
    addToast.mockReset();
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('copies only the ticked fields, with names', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    await clickCard(cardWith('HMM HOPE'));
    await clickCard(cardWith('062E-062E'));
    expect(screen.getByText('Đã chọn 2 ô')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: f.copyLabeled }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split('\n')).toEqual([
      `${translations.vi.vessel.columns['vessel_name']}: HMM HOPE`,
      `${translations.vi.vessel.columns['in_out_voyage']}: 062E-062E`,
    ]);
  });

  it('copies values only and can select / clear all', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    fireEvent.click(screen.getByRole('button', { name: f.selectAll }));
    // site_id, agent, vessel, voyage, queried? -> only fields with a value are selectable
    fireEvent.click(screen.getByRole('button', { name: f.copyValues }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0][0] as string).split('\n')).toEqual(['CTL', 'HDM', 'HMM HOPE', '062E-062E', '11:00 23/09/2026']);

    fireEvent.click(screen.getByRole('button', { name: f.clear }));
    expect(screen.queryByRole('button', { name: f.copyValues })).toBeNull();
  });

  it('selects by clicking a card (toggle), not when clicking its copy button, and skips empty fields', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    const cards = screen.getAllByRole('checkbox');
    expect(cards).toHaveLength(5); // only fields holding a value are selectable

    const card = cardWith('HMM HOPE');
    await clickCard(card);
    expect(card).toHaveAttribute('aria-checked', 'true');
    await clickCard(card);
    expect(card).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(within(card).getByRole('button', { name: translations.vi.common.copy }));
    expect(card).toHaveAttribute('aria-checked', 'false');
  });

  it('a double / triple click selects text to copy part of a value and does not tick the card', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    const card = cardWith('HMM HOPE');
    fireEvent.click(card, { detail: 1 });
    fireEvent.click(card, { detail: 2 });
    fireEvent.click(card, { detail: 3 });
    await act(() => new Promise((r) => setTimeout(r, CLICK_TOGGLE_DELAY_MS + 20)));
    expect(card).toHaveAttribute('aria-checked', 'false');
  });

  it('copies only a highlighted part of one field together with other whole fields', async () => {
    render(<VesselDetailModal isOpen onClose={() => undefined} schedule={schedule} />);
    // Highlight "062E" (first half of the voyage "062E-062E")
    const valueText = within(cardWith('062E-062E')).getByText('062E-062E').firstChild as Text;
    const range = document.createRange();
    range.setStart(valueText, 0);
    range.setEnd(valueText, 4);
    act(() => {
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    fireEvent.click(await screen.findByRole('button', { name: tf(f.pickPart, { text: '062E' }) }));
    const voyage = cardWith('062E-062E');
    expect(voyage).toHaveAttribute('aria-checked', 'true');
    expect(voyage).toHaveAttribute('data-part', `${f.partOnly} 062E`);

    await clickCard(cardWith('HMM HOPE'));
    fireEvent.click(screen.getByRole('button', { name: f.copyValues }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect((writeText.mock.calls[0][0] as string).split('\n')).toEqual(['HMM HOPE', '062E']);

    // A plain click on the card goes back to "not picked"; the next tick copies the whole value
    await clickCard(voyage);
    expect(voyage).toHaveAttribute('aria-checked', 'false');
    expect(voyage).not.toHaveAttribute('data-part');
  });
});

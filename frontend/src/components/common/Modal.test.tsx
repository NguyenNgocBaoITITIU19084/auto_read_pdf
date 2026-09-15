import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('Escape closes only the topmost modal', () => {
    const closeBottom = vi.fn();
    const closeTop = vi.fn();
    render(
      <>
        <Modal isOpen title="bottom" onClose={closeBottom}>a</Modal>
        <Modal isOpen title="top" onClose={closeTop}>b</Modal>
      </>
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(closeTop).toHaveBeenCalledTimes(1);
    expect(closeBottom).not.toHaveBeenCalled();
  });
});

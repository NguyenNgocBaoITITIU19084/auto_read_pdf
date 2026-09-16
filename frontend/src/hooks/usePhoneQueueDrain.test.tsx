import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { usePhoneQueueDrain, PhoneQueueDrainSource } from './usePhoneQueueDrain';

const Harness: React.FC<{ source: PhoneQueueDrainSource; isModalOpen: boolean; onPhoto: (f: File) => void }> = ({
  source,
  isModalOpen,
  onPhoto,
}) => {
  usePhoneQueueDrain(source, isModalOpen, onPhoto);
  return null;
};

describe('usePhoneQueueDrain', () => {
  it('opens a single arriving photo', () => {
    const fileA = new File(['a'], 'a.jpg');
    const onPhoto = vi.fn();
    render(<Harness source={{ queue: [fileA], takeNext: () => fileA }} isModalOpen={false} onPhoto={onPhoto} />);
    expect(onPhoto).toHaveBeenCalledTimes(1);
    expect(onPhoto).toHaveBeenCalledWith(fileA);
  });

  it('does not dequeue while the modal is open', () => {
    const fileA = new File(['a'], 'a.jpg');
    const takeNext = vi.fn(() => fileA);
    const onPhoto = vi.fn();
    render(<Harness source={{ queue: [fileA], takeNext }} isModalOpen onPhoto={onPhoto} />);
    expect(takeNext).not.toHaveBeenCalled();
    expect(onPhoto).not.toHaveBeenCalled();
  });

  it('opens the second photo once the modal closes after the first was dismissed (the case the queue-length guard broke)', () => {
    // This is exactly the steady-state flow the plan describes: take a photo, review it, save
    // it, take the next one — never letting two photos pile up in the queue at once. A
    // length-keyed guard collides here because the length is 1 both times.
    const fileA = new File(['a'], 'a.jpg');
    const fileB = new File(['b'], 'b.jpg');
    const onPhoto = vi.fn();
    let queue: File[] = [fileA];
    const takeNext = vi.fn(() => {
      const head = queue[0] ?? null;
      queue = queue.slice(1);
      return head;
    });
    const source: PhoneQueueDrainSource = { queue, takeNext };

    const { rerender } = render(<Harness source={source} isModalOpen={false} onPhoto={onPhoto} />);
    expect(onPhoto).toHaveBeenNthCalledWith(1, fileA);

    // Modal opens to review A, then closes once saved -- queue is empty in between.
    rerender(<Harness source={{ ...source, queue }} isModalOpen onPhoto={onPhoto} />);
    rerender(<Harness source={{ ...source, queue }} isModalOpen={false} onPhoto={onPhoto} />);
    expect(onPhoto).toHaveBeenCalledTimes(1); // nothing to dequeue yet

    // B arrives -- queue length is 1 again, identical to when A arrived.
    queue = [fileB];
    rerender(<Harness source={{ ...source, queue }} isModalOpen={false} onPhoto={onPhoto} />);
    expect(onPhoto).toHaveBeenNthCalledWith(2, fileB);
    expect(onPhoto).toHaveBeenCalledTimes(2);
  });

  it('drains a burst of three photos one at a time as the modal opens and closes for each', () => {
    const files = [new File(['a'], 'a.jpg'), new File(['b'], 'b.jpg'), new File(['c'], 'c.jpg')];
    let queue = [...files];
    const takeNext = () => {
      const head = queue[0] ?? null;
      queue = queue.slice(1);
      return head;
    };
    const onPhoto = vi.fn();

    const { rerender } = render(
      <Harness source={{ queue, takeNext }} isModalOpen={false} onPhoto={onPhoto} />
    );
    expect(onPhoto).toHaveBeenNthCalledWith(1, files[0]);

    for (let i = 1; i < files.length; i++) {
      rerender(<Harness source={{ queue, takeNext }} isModalOpen onPhoto={onPhoto} />);
      rerender(<Harness source={{ queue, takeNext }} isModalOpen={false} onPhoto={onPhoto} />);
      expect(onPhoto).toHaveBeenNthCalledWith(i + 1, files[i]);
    }
    expect(onPhoto).toHaveBeenCalledTimes(3);
  });

  it('a StrictMode-style double-invocation of the same render does not double-dequeue', () => {
    const fileA = new File(['a'], 'a.jpg');
    const fileB = new File(['b'], 'b.jpg');
    let queue = [fileA, fileB];
    const takeNext = vi.fn(() => {
      const head = queue[0] ?? null;
      queue = queue.slice(1);
      return head;
    });
    const onPhoto = vi.fn();

    render(
      <React.StrictMode>
        <Harness source={{ queue, takeNext }} isModalOpen={false} onPhoto={onPhoto} />
      </React.StrictMode>
    );

    // Only the head (A) should have been dequeued, exactly once, regardless of whether
    // StrictMode's development double-invocation actually fired in this test environment.
    expect(onPhoto).toHaveBeenCalledTimes(1);
    expect(onPhoto).toHaveBeenCalledWith(fileA);
    expect(takeNext).toHaveBeenCalledTimes(1);
  });
});

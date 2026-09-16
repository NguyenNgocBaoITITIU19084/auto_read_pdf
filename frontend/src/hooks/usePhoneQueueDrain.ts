import { useEffect, useRef } from 'react';

/** The slice of `MobileBridgeValue` this hook actually needs. */
export interface PhoneQueueDrainSource {
  queue: File[];
  takeNext: () => File | null;
}

/**
 * Opens photos arriving from a paired phone one at a time in the review modal — only once the
 * previous one has been saved/dismissed, so a fresh photo never clobbers an in-progress edit.
 *
 * `takeNext()` mutates the queue synchronously and returns immediately, so React 18
 * StrictMode's development-only mount double-invocation of the underlying effect (the caller
 * typically remounts every time the user switches back to its tab, since this app only renders
 * the active tab) could otherwise call `takeNext()` twice back-to-back for the same render.
 * Guarding on the QUEUE LENGTH is unsound: length oscillates as photos arrive and are
 * dequeued, so it can collide across two genuinely different photos and silently strand one —
 * every photo opens one arrival late, and the last of any burst never opens until a further
 * arrival forces the length to change again. Guarding on the IDENTITY of the queue's head
 * `File` is sound: a StrictMode double-invoke sees the exact same (unchanged) `queue` array
 * both times, so the head is the same object and the guard blocks the repeat; two distinct
 * photos are never `===`, so a real new arrival is never blocked.
 */
export function usePhoneQueueDrain(
  source: PhoneQueueDrainSource,
  isModalOpen: boolean,
  onPhoto: (file: File) => void
): void {
  const lastHandledFileRef = useRef<File | null>(null);
  useEffect(() => {
    if (isModalOpen) return;
    const head = source.queue[0];
    if (!head || head === lastHandledFileRef.current) return;
    lastHandledFileRef.current = head;
    const file = source.takeNext();
    if (file) onPhoto(file);
  }, [isModalOpen, source, onPhoto]);
}

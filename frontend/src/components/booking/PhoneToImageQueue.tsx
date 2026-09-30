import { useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToastActions } from '../../context/ToastContext';
import { useMobileBridge } from '../../context/MobileBridgeContext';
import { useImageQueue } from '../../context/ImageQueueContext';
import { tf } from '../../services/i18nFormat';

/**
 * Feeds photos arriving from a paired phone into the app-wide image reading queue, whatever tab is open
 * (the old flow only opened them from the Booking tab, one at a time). Renders nothing.
 *
 * `takeNext()` empties the phone buffer synchronously (and acks it), so an effect that runs twice for the
 * same render (StrictMode) finds nothing the second time and never enqueues a photo twice. Photos stay
 * in the phone buffer until a collection is selected and the queue has room, so none are lost.
 */
export const PhoneToImageQueue = (): null => {
  const mobile = useMobileBridge();
  const queue = useImageQueue();
  const { t, activeCollection } = useApp();
  const { addToast } = useToastActions();

  useEffect(() => {
    if (mobile.queue.length === 0 || !activeCollection || queue.room <= 0) return;
    // Only take what fits: takeNext() acks a photo, and one that then can't be queued would be lost
    const files: File[] = [];
    while (files.length < queue.room) {
      const file = mobile.takeNext();
      if (!file) break;
      files.push(file);
    }
    if (files.length === 0) return;
    const res = queue.enqueue(files, 'phone');
    if (res.added > 0) addToast(tf(t.booking.imageQueue.phoneReceived, { count: res.added }), 'info');
  }, [mobile, queue.enqueue, queue.room, activeCollection, addToast, t]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
};

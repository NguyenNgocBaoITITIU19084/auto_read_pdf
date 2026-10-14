import React, { useMemo } from 'react';
import { TrashApi, TrashColumn, TrashModal, TRASH_KEEP_DAYS } from '../common/TrashModal';
import { useApp } from '../../context/AppContext';
import {
  deleteTrashedBookingsApi, getBookingTrash, getBookingTrashIds, restoreBookingsApi, TrashedBooking,
} from '../../services/api';

export { formatTrashTime } from '../common/TrashModal';
export const BOOKING_TRASH_KEEP_DAYS = TRASH_KEEP_DAYS;

const bookingTrashApi: TrashApi<TrashedBooking> = {
  list: (collectionId, limit, offset) => getBookingTrash(collectionId, limit, offset),
  ids: (collectionId) => getBookingTrashIds(collectionId),
  restore: async (ids) => ({ restored: await restoreBookingsApi(ids) }),
  deleteNow: (ids) => deleteTrashedBookingsApi(ids),
};

export interface BookingTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: number | null;
  /** Called after bookings were restored or deleted for good (reload the table / trash badge here). */
  onChanged?: () => void;
}

export const BookingTrashModal: React.FC<BookingTrashModalProps> = (props) => {
  const { t } = useApp();
  const col = t.booking.columns;
  const columns = useMemo<TrashColumn<TrashedBooking>[]>(() => [
    { key: 'no', label: col['Booking No'], render: (b) => b['Booking No'] || '—', className: 'font-semibold whitespace-nowrap' },
    { key: 'carrier', label: col.Carrier, render: (b) => b.Carrier || '', className: 'whitespace-nowrap' },
    { key: 'vessel', label: col.Vessel, render: (b) => b.Vessel || '' },
    { key: 'pod', label: col['Port of Discharging'], render: (b) => b['Port of Discharging'] || '' },
  ], [col]);
  return <TrashModal {...props} api={bookingTrashApi} texts={t.booking.trash} columns={columns} />;
};

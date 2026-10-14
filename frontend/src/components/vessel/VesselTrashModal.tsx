import React, { useMemo } from 'react';
import { TrashColumn, TrashModal } from '../common/TrashModal';
import { useApp } from '../../context/AppContext';
import { TrashedVessel, vesselTrashApi } from '../../services/api';
import { formatEportDate } from '../../utils/vessel';

export interface VesselTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: number | null;
  /** Called after schedules were restored or deleted for good (reload the table / trash badge here). */
  onChanged?: () => void;
}

export const VesselTrashModal: React.FC<VesselTrashModalProps> = (props) => {
  const { t } = useApp();
  const col = t.vessel.columns;
  const columns = useMemo<TrashColumn<TrashedVessel>[]>(() => [
    { key: 'vessel', label: col.vessel_name, render: (v) => v.vessel_name || '—', className: 'font-semibold' },
    { key: 'voyage', label: col.in_out_voyage, render: (v) => v.in_out_voyage || '', className: 'whitespace-nowrap' },
    { key: 'site', label: col.site_id, render: (v) => v.site_id || '', className: 'whitespace-nowrap' },
    { key: 'closing', label: col.closing_time, render: (v) => formatEportDate(v.closing_time), className: 'whitespace-nowrap' },
  ], [col]);
  return <TrashModal {...props} api={vesselTrashApi} texts={t.vessel.trash} columns={columns} />;
};

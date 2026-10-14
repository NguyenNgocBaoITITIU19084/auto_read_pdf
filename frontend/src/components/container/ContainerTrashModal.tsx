import React, { useMemo } from 'react';
import { TrashColumn, TrashModal } from '../common/TrashModal';
import { useApp } from '../../context/AppContext';
import { containerTrashApi, TrashedContainer } from '../../services/api';
import { formatEportDate } from '../../utils/vessel';

export interface ContainerTrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  collectionId: number | null;
  /** Called after containers were restored or deleted for good (reload the table / trash badge here). */
  onChanged?: () => void;
}

export const ContainerTrashModal: React.FC<ContainerTrashModalProps> = (props) => {
  const { t } = useApp();
  const col = t.container.columns;
  const columns = useMemo<TrashColumn<TrashedContainer>[]>(() => [
    { key: 'no', label: col.containerno, render: (c) => c.containerno || '—', className: 'font-semibold whitespace-nowrap' },
    { key: 'event', label: col.event_type, render: (c) => c.event_type || '', className: 'whitespace-nowrap' },
    { key: 'time', label: col.event_time, render: (c) => formatEportDate(c.event_time), className: 'whitespace-nowrap' },
    { key: 'site', label: col.site_id, render: (c) => c.site_id || '', className: 'whitespace-nowrap' },
    { key: 'line', label: col.line_oper, render: (c) => c.line_oper || '', className: 'whitespace-nowrap' },
  ], [col]);
  return <TrashModal {...props} api={containerTrashApi} texts={t.container.trash} columns={columns} />;
};

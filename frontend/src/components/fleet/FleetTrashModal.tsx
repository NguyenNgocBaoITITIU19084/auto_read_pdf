import React, { useMemo } from 'react';
import { TrashColumn, TrashModal } from '../common/TrashModal';
import { useApp } from '../../context/AppContext';
import { fleetDriverTrashApi, fleetVehicleTrashApi } from '../../services/api';
import type { FleetTrashedDriver, FleetTrashedVehicle } from '../../types';
import { FleetAvatar } from './FleetPhoto';

interface Props {
  kind: 'vehicle' | 'driver';
  isOpen: boolean;
  onClose: () => void;
  /** after a restore / delete for good: reload the tables and the trash badge */
  onChanged?: () => void;
}

/** Deleted trucks or drivers, through the app's shared trash dialog. Fleet data has no collection: the dialog's
 *  collection id is a placeholder the fleet trash API ignores. */
export const FleetTrashModal: React.FC<Props> = ({ kind, ...props }) => {
  const { t } = useApp();
  const f = t.fleet;
  const vehicleColumns = useMemo<TrashColumn<FleetTrashedVehicle>[]>(() => [
    { key: 'plate', label: f.list.vehicle, className: 'font-semibold', render: (v) => (
      <span className="flex items-center gap-2">
        <FleetAvatar photo={v.photo} kind="vehicle" name={v.plate} size="wideSm" />{v.plate}
      </span>
    ) },
    { key: 'trailer', label: f.vehicleForm.trailer, className: 'whitespace-nowrap', render: (v) => v.trailer_plate || f.none },
    { key: 'type', label: f.vehicleForm.type, render: (v) => v.vehicle_type || f.none },
  ], [f]);
  const driverColumns = useMemo<TrashColumn<FleetTrashedDriver>[]>(() => [
    { key: 'name', label: f.list.driver, className: 'font-semibold', render: (d) => (
      <span className="flex items-center gap-2">
        <FleetAvatar photo={d.photo} kind="driver" name={d.name} size="xs" />{d.name}
      </span>
    ) },
    { key: 'phone', label: f.driverForm.phone, className: 'whitespace-nowrap', render: (d) => d.phone || f.none },
    { key: 'license', label: f.list.license, className: 'whitespace-nowrap',
      render: (d) => [d.license_class, d.license_no].filter(Boolean).join(' · ') || f.none },
  ], [f]);
  return kind === 'vehicle'
    ? <TrashModal {...props} collectionId={0} api={fleetVehicleTrashApi} texts={f.trash.vehicle} columns={vehicleColumns} />
    : <TrashModal {...props} collectionId={0} api={fleetDriverTrashApi} texts={f.trash.driver} columns={driverColumns} />;
};

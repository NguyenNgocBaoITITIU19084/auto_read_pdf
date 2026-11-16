import React, { useMemo } from 'react';
import { TrashColumn, TrashModal } from '../common/TrashModal';
import { useApp } from '../../context/AppContext';
import { fleetDriverTrashApi, fleetTrailerTrashApi, fleetTruckTrashApi, fleetVehicleTrashApi } from '../../services/api';
import type { FleetTrashedDriver, FleetTrashedTrailer, FleetTrashedVehicle } from '../../types';
import { FleetAvatar } from './FleetPhoto';

interface Props {
  /** vehicle: the tractors; truck: the trucks */
  kind: 'vehicle' | 'truck' | 'driver' | 'trailer';
  isOpen: boolean;
  onClose: () => void;
  /** after a restore / delete for good: reload the tables and the trash badge */
  onChanged?: () => void;
}

/** Deleted trucks, drivers or trailers, through the app's shared trash dialog. Fleet data has no collection: the dialog's
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
  const truckColumns = useMemo<TrashColumn<FleetTrashedVehicle>[]>(() => [
    vehicleColumns[0],
    { key: 'type', label: f.vehicleForm.type, render: (v) => v.vehicle_type || f.none },
    { key: 'body', label: f.truckForm.body, className: 'whitespace-nowrap',
      render: (v) => [v.body_type, v.payload].filter(Boolean).join(' · ') || f.none },
  ], [f, vehicleColumns]);
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
  const trailerColumns = useMemo<TrashColumn<FleetTrashedTrailer>[]>(() => [
    { key: 'plate', label: f.trailer.cols.plate, className: 'font-semibold', render: (r) => (
      <span className="flex items-center gap-2">
        <FleetAvatar photo={r.photo} kind="trailer" name={r.plate} size="wideSm" />{r.plate}
      </span>
    ) },
    { key: 'type', label: f.trailer.cols.type, render: (r) => r.trailer_type || f.none },
    { key: 'chassis', label: f.trailer.cols.chassis, className: 'whitespace-nowrap', render: (r) => r.chassis_no || f.none },
  ], [f]);
  if (kind === 'trailer') {
    return <TrashModal {...props} collectionId={0} api={fleetTrailerTrashApi} texts={f.trash.trailer} columns={trailerColumns} />;
  }
  if (kind === 'truck') {
    return <TrashModal {...props} collectionId={0} api={fleetTruckTrashApi} texts={f.trash.truck} columns={truckColumns} />;
  }
  return kind === 'vehicle'
    ? <TrashModal {...props} collectionId={0} api={fleetVehicleTrashApi} texts={f.trash.vehicle} columns={vehicleColumns} />
    : <TrashModal {...props} collectionId={0} api={fleetDriverTrashApi} texts={f.trash.driver} columns={driverColumns} />;
};

// Типы поставки (G29): справочник «Типы поставки» с правилом деления доставки — по объёму (CBM) или по весу.
// Заранее заведённые типы имеют постоянные id: по ним прежний тип поставки (`mode`) переносится в typeId
// и при привязке таблицы, и при импорте, и в демо-наборе.

import type { Dataset, Shipment, ShipmentBasis, ShipmentMode, ShipmentType } from './model';

export const DEFAULT_SHIPMENT_TYPES: readonly ShipmentType[] = [
  { id: 'stp_sea', name: 'Море, контейнер', basis: 'cbm' },
  { id: 'stp_road', name: 'Авто, контейнер', basis: 'cbm' },
  { id: 'stp_rail', name: 'Ж/д, контейнер', basis: 'cbm' },
  { id: 'stp_air', name: 'Авиа', basis: 'weight' },
  { id: 'stp_groupage', name: 'Авто, сборный груз', basis: 'weight' },
];

export const BASIS_LABEL: Record<ShipmentBasis, string> = { cbm: 'по объёму (CBM)', weight: 'по весу' };
export const BASIS_OPTIONS: { value: ShipmentBasis; label: string }[] = [
  { value: 'cbm', label: BASIS_LABEL.cbm }, { value: 'weight', label: BASIS_LABEL.weight },
];

/** Прежний тип поставки → заранее заведённый тип. */
export const TYPE_ID_BY_MODE: Record<ShipmentMode, string> = {
  sea_container: 'stp_sea', road_container: 'stp_road', air: 'stp_air', other: 'stp_groupage',
};

/** Прежний тип для записи `mode` новой поставки: у заранее заведённых — свой, у прочих — «другое». */
export function modeForType(typeId: string | undefined): ShipmentMode {
  const hit = (Object.keys(TYPE_ID_BY_MODE) as ShipmentMode[]).find((m) => TYPE_ID_BY_MODE[m] === typeId);
  return hit ?? 'other';
}

/** Типы для выбора: из справочника; справочник пуст (старый демо-набор) — заранее заведённые. */
export function shipmentTypesOf(ds: Pick<Dataset, 'shipmentTypes'>): ShipmentType[] {
  const own = ds.shipmentTypes ?? [];
  return own.length > 0 ? own : DEFAULT_SHIPMENT_TYPES.map((t) => ({ ...t }));
}

/** Тип поставки: из справочника, иначе заранее заведённый с тем же id; нет — undefined. */
export function shipmentTypeOf(ds: Pick<Dataset, 'shipmentTypes'>, s: Pick<Shipment, 'typeId'>): ShipmentType | undefined {
  if (!s.typeId) return undefined;
  return (ds.shipmentTypes ?? []).find((t) => t.id === s.typeId) ?? DEFAULT_SHIPMENT_TYPES.find((t) => t.id === s.typeId);
}

/** Как делить доставку поставки: по типу; без типа — как раньше по `mode` (контейнер море/авто — CBM, остальное — вес). */
export function deliveryBasis(ds: Pick<Dataset, 'shipmentTypes'>, s: Pick<Shipment, 'typeId' | 'mode'>): ShipmentBasis {
  const t = shipmentTypeOf(ds, s);
  // правило, вписанное в лист руками («CBM», «объём»), — тоже по объёму; прочее — по весу
  if (t) return /^(cbm|об[ъь]?[её]м)/i.test(String(t.basis ?? '').trim()) ? 'cbm' : 'weight';
  return s.mode === 'sea_container' || s.mode === 'road_container' ? 'cbm' : 'weight';
}

/** typeId поставкам без типа — по прежнему `mode`, если такой тип есть в справочнике. */
export function planShipmentTypeIds(ds: Pick<Dataset, 'shipments' | 'shipmentTypes'>): { id: string; typeId: string }[] {
  const have = new Set((ds.shipmentTypes ?? []).map((t) => t.id));
  return ds.shipments
    .filter((s) => !s.typeId?.trim())
    .map((s) => ({ id: s.id, typeId: TYPE_ID_BY_MODE[s.mode] ?? TYPE_ID_BY_MODE.other }))
    .filter((p) => have.has(p.typeId));
}

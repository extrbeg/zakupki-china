// Выбор типа поставки (G29) — поле с поиском при вводе и «+ Добавить…»: название и правило деления доставки (по объёму / по весу).
// Новый тип записывается в «Типы поставки» и сразу выбирается; название, уже имеющееся в справочнике, выбирается без записи.

import { useRef, useState } from 'react';
import { newId } from '../../domain/ids';
import type { ShipmentBasis } from '../../domain/model';
import { BASIS_LABEL, BASIS_OPTIONS, shipmentTypesOf } from '../../domain/shipmentTypes';
import { useData } from '../DataContext';
import { F } from '../../domain/labels';
import { AddableSelect, ADD_LIST_VALUE_LABEL } from '../components';
import { normalizeName } from './cityLookup';
import { storeDefaultTypes, validateShipmentTypeName } from './shipmentTypes';

export const SHIPMENT_TYPE_SAVE_ERROR = 'Не удалось сохранить тип поставки';

export interface ShipmentTypeFieldProps {
  value: string | undefined;
  onChange: (typeId: string | undefined) => void;
  error?: string;
  disabled?: boolean;
}

export function ShipmentTypeField({ value, onChange, error, disabled }: ShipmentTypeFieldProps) {
  const data = useData();
  const latest = useRef(data);
  latest.current = data;
  const types = shipmentTypesOf(data.ds);
  const [basis, setBasis] = useState<ShipmentBasis>('cbm');
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const add = async (name: string) => {
    const { ds, save } = latest.current;
    const all = shipmentTypesOf(ds);
    setAddError(undefined);
    const same = all.find((t) => normalizeName(t.name) === normalizeName(name));
    if (same) { onChange(same.id); return; }
    const err = validateShipmentTypeName(all, name);
    if (err) { setAddError(err); return; }
    const record = { id: newId('stp'), name: name.trim(), basis };
    setBasis('cbm');
    try {
      await storeDefaultTypes(ds, save);
      await save('shipmentTypes', record);
      onChange(record.id);
    } catch {
      setAddError(SHIPMENT_TYPE_SAVE_ERROR);
    }
  };

  const chosen = types.find((t) => t.id === value);
  const options = types.map((t) => ({ value: t.id, label: t.name, hint: BASIS_LABEL[t.basis] }));
  return (
    <AddableSelect
      label={F.shipmentType} search value={value} options={options} disabled={disabled} placeholder="— выберите —"
      error={error} addError={addError} hint={chosen ? `Доставка делится ${BASIS_LABEL[chosen.basis]}` : undefined}
      onChange={(v) => { setAddError(undefined); onChange(v); }} onAdd={(n) => void add(n)}
      addLabel={ADD_LIST_VALUE_LABEL} inputLabel="Новый тип поставки"
      addExtra={(
        <select className="input" aria-label={F.basis} value={basis} onChange={(e) => setBasis(e.target.value as ShipmentBasis)}>
          {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    />
  );
}

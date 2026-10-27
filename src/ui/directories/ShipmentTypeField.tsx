// Выбор типа поставки (G29) с «+ Добавить…»: название и правило деления доставки (по объёму / по весу).
// Новый тип записывается в «Типы поставки» и сразу выбирается; название, уже имеющееся в справочнике, выбирается без записи.

import { useEffect, useRef, useState } from 'react';
import { newId } from '../../domain/ids';
import type { ShipmentBasis } from '../../domain/model';
import { BASIS_LABEL, BASIS_OPTIONS, shipmentTypesOf } from '../../domain/shipmentTypes';
import { useData } from '../DataContext';
import { ADD_LIST_VALUE_LABEL, ADD_OPTION_VALUE, Field } from '../components';
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
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<ShipmentBasis>('cbm');
  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const close = () => { setAdding(false); setName(''); setBasis('cbm'); setNameError(''); };
  const submit = async () => {
    const { ds, save } = latest.current;
    const all = shipmentTypesOf(ds);
    const same = all.find((t) => normalizeName(t.name) === normalizeName(name));
    if (same) { close(); onChange(same.id); return; }
    const err = validateShipmentTypeName(all, name);
    if (err) { setNameError(err); return; }
    const record = { id: newId('stp'), name: name.trim(), basis };
    close();
    setSaveError(undefined);
    try {
      await storeDefaultTypes(ds, save);
      await save('shipmentTypes', record);
      onChange(record.id);
    } catch {
      setSaveError(SHIPMENT_TYPE_SAVE_ERROR);
    }
  };

  const chosen = types.find((t) => t.id === value);
  const known = !value || Boolean(chosen);
  return (
    <Field label="Тип поставки" error={error ?? saveError} hint={chosen ? `Доставка делится ${BASIS_LABEL[chosen.basis]}` : undefined}>
      {({ id, describedBy, invalid }) => (
        <>
          <select
            id={id} className="input" value={value ?? ''} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === ADD_OPTION_VALUE) { setAdding(true); return; }
              onChange(v === '' ? undefined : v);
            }}
          >
            {!value ? <option value="">— выберите —</option> : null}
            {!known ? <option value={value}>{value}</option> : null}
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            {disabled ? null : <option value={ADD_OPTION_VALUE}>{ADD_LIST_VALUE_LABEL}</option>}
          </select>
          {adding ? (
            <div className="select-add">
              <input
                ref={inputRef} className="input select-add__input" type="text" value={name}
                aria-label="Новый тип поставки" aria-invalid={nameError ? true : undefined}
                onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void submit(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
                }}
              />
              <select className="input" aria-label="Делить доставку" value={basis} onChange={(e) => setBasis(e.target.value as ShipmentBasis)}>
                {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button type="button" className="btn btn--small" onClick={() => void submit()}>Добавить</button>
              <button type="button" className="btn btn--small" onClick={close}>Отмена</button>
              {nameError ? <div className="field__error select-add__error">{nameError}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </Field>
  );
}

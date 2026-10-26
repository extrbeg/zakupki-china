// Выбор поставщика, платёжного агента или перевозчика с пунктом «+ Новый…» (история 86).
// Запись справочника создаётся только с названием и сразу выбирается; остальные поля заполняются потом в справочнике.
// Дубль по названию (без учёта регистра и пробелов) не создаётся — выбирается существующая запись.

import { useRef, useState } from 'react';
import { newId } from '../../domain/ids';
import type { Carrier, PaymentAgent, Supplier } from '../../domain/model';
import { useData } from '../DataContext';
import { normalizeName } from '../directories/cityLookup';
import { AddableSelect } from './AddableSelect';

export type DirectoryEntity = 'suppliers' | 'agents' | 'carriers';

const ID_PREFIX: Record<DirectoryEntity, string> = { suppliers: 'sup', agents: 'agt', carriers: 'car' };
export const NEW_DIRECTORY_LABEL: Record<DirectoryEntity, string> = {
  suppliers: '+ Новый поставщик…', agents: '+ Новый платёжный агент…', carriers: '+ Новый перевозчик…',
};
const INPUT_LABEL: Record<DirectoryEntity, string> = {
  suppliers: 'Название нового поставщика', agents: 'Название нового платёжного агента', carriers: 'Название нового перевозчика',
};
const SAVE_ERROR: Record<DirectoryEntity, string> = {
  suppliers: 'Не удалось сохранить нового поставщика', agents: 'Не удалось сохранить нового агента', carriers: 'Не удалось сохранить нового перевозчика',
};

interface Named { id: string; name: string }

export interface DirectorySelectFieldProps {
  entity: DirectoryEntity;
  label: string;
  /** id выбранной записи. */
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DirectorySelectField({ entity, value, onChange, ...rest }: DirectorySelectFieldProps) {
  const data = useData();
  const latest = useRef(data);
  latest.current = data;
  const valueRef = useRef(value);
  valueRef.current = value;
  /** Записи, создание которых ещё идёт: уже выбраны и подписаны названием. */
  const [pending, setPending] = useState<Named[]>([]);
  const pendingRef = useRef<Named[]>([]);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const records = data.ds[entity] as Named[];
  const all = [...records, ...pending.filter((p) => !records.some((r) => r.id === p.id))];
  const options = [...all].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((r) => ({ value: r.id, label: r.name }));

  const add = (name: string) => {
    const key = normalizeName(name);
    const { ds, save } = latest.current;
    const existing = [...(ds[entity] as Named[]), ...pendingRef.current].find((r) => normalizeName(r.name) === key);
    setAddError(undefined);
    if (existing) { onChange(existing.id); return; }
    const rec: Named = { id: newId(ID_PREFIX[entity]), name };
    pendingRef.current = [...pendingRef.current, rec];
    setPending(pendingRef.current);
    onChange(rec.id);
    const done = () => {
      pendingRef.current = pendingRef.current.filter((p) => p.id !== rec.id);
      setPending(pendingRef.current);
    };
    const write = entity === 'suppliers'
      ? save('suppliers', { ...rec, createdAt: new Date().toISOString() } as Supplier)
      : entity === 'agents' ? save('agents', rec as PaymentAgent) : save('carriers', rec as Carrier);
    write.then(done, () => {
      done();
      setAddError(SAVE_ERROR[entity]);
      if (valueRef.current === rec.id) onChange(undefined);   // записи нет — выбор снимается
    });
  };

  return (
    <AddableSelect
      {...rest} value={value} options={options} addError={addError}
      addLabel={NEW_DIRECTORY_LABEL[entity]} inputLabel={INPUT_LABEL[entity]}
      onChange={(v) => { setAddError(undefined); onChange(v); }} onAdd={add}
    />
  );
}

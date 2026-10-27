// Несколько значений из «Списков» (специализации поставщика): выбранные — плашками с «×», ниже — выпадающий список
// оставшихся с «+ Добавить…» (новое значение записывается в список, как в ListSelectField).

import type { ListKey } from '../../domain/model';
import { normalizeName } from '../directories/cityLookup';
import { listOptions } from '../directories/records';
import { useData } from '../DataContext';
import { ListSelectField } from './ListSelectField';
import './MultiListSelectField.css';

export interface MultiListSelectFieldProps {
  list: ListKey;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  hint?: string;
  disabled?: boolean;
}

export function MultiListSelectField({ list, label, values, onChange, hint, disabled }: MultiListSelectFieldProps) {
  const { ds } = useData();
  const chosen = new Set(values.map(normalizeName));
  const rest = listOptions(ds, list).filter((o) => !chosen.has(normalizeName(o.value)));
  const add = (v: string | undefined) => { if (v && !chosen.has(normalizeName(v))) onChange([...values, v]); };

  return (
    <div className="multi-select">
      <ListSelectField
        list={list} label={label} value={undefined} options={rest} onChange={add} disabled={disabled}
        placeholder={values.length ? 'Добавить ещё…' : 'Выберите…'} hint={hint ?? 'Можно выбрать несколько'}
      />
      {values.length ? (
        <ul className="multi-select__chips" aria-label={`Выбрано: ${label}`}>
          {values.map((v) => (
            <li key={v} className="multi-select__chip">
              <span>{v}</span>
              <button
                type="button" className="multi-select__remove" aria-label={`Убрать «${v}»`} disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >×</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

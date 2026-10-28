// Поле выбора из «Списков» с поиском при вводе и пунктом «+ Добавить…» (история 85; правило полей со списком — AGENTS.md).
// Новое значение сразу выбирается (onChange), запись в список (`ListItem`, в конец) идёт следом — форма не ждёт её
// и ничего не сбрасывает. Значение, уже имеющееся среди вариантов без учёта регистра и пробелов, выбирается без записи.

import { useRef, useState } from 'react';
import { newId } from '../../domain/ids';
import type { ListKey } from '../../domain/model';
import { useData } from '../DataContext';
import { normalizeName } from '../directories/cityLookup';
import { nextOrder } from '../directories/listOps';
import { listOptions } from '../directories/records';
import { AddableSelect } from './AddableSelect';
import type { SelectOption } from './SelectField';

export const ADD_LIST_VALUE_LABEL = '+ Добавить…';
export const LIST_SAVE_ERROR = 'Не удалось сохранить значение в список — оно выбрано, но в «Списках» его нет';

export interface ListSelectFieldProps {
  list: ListKey;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Варианты вместо `listOptions(ds, list)` (например, типы затрат вместе со стандартными). */
  options?: SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ListSelectField({ list, options, onChange, ...rest }: ListSelectFieldProps) {
  const data = useData();
  const latest = useRef(data);
  latest.current = data;
  /** Значения, запись которых ещё идёт: видны в списке и участвуют в проверке дублей. */
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const [addError, setAddError] = useState<string | undefined>(undefined);

  const base = options ?? listOptions(data.ds, list);
  const shown = [...base, ...pending.filter((p) => !base.some((o) => o.value === p)).map((p) => ({ value: p, label: p }))];

  const add = (name: string) => {
    const key = normalizeName(name);
    const { ds, save } = latest.current;
    const items = ds.lists.filter((l) => l.list === list);
    const candidates = [...(options ?? []).map((o) => o.value), ...items.map((i) => i.value), ...pendingRef.current];
    const existing = candidates.find((v) => normalizeName(v) === key);
    setAddError(undefined);
    if (existing !== undefined) { onChange(existing); return; }
    const order = nextOrder(items) + pendingRef.current.length;
    pendingRef.current = [...pendingRef.current, name];
    setPending(pendingRef.current);
    onChange(name);
    const done = () => {
      pendingRef.current = pendingRef.current.filter((p) => p !== name);
      setPending(pendingRef.current);
    };
    save('lists', { id: newId('lst'), list, value: name, order }).then(done, () => { done(); setAddError(LIST_SAVE_ERROR); });
  };

  return (
    <AddableSelect
      {...rest} search options={shown} addError={addError} addLabel={ADD_LIST_VALUE_LABEL} inputLabel={`Новое значение: ${rest.label}`}
      onChange={(v) => { setAddError(undefined); onChange(v); }} onAdd={add}
    />
  );
}

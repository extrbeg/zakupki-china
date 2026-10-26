// Мелкие помощники форм справочников.

import type { Dataset, ListKey } from '../../domain/model';
import type { SelectOption } from '../components';
import { compareRu } from './cityLookup';

/** Обрезает строки и убирает пустые поля: в лист попадают только заполненные значения. */
export function cleanRecord<T extends object>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t !== '') out[k] = t;
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out as T;
}

export const REQUIRED_NAME_ERROR = 'Введите название';

export function validateName(name: string | undefined): Record<string, string> {
  return (name ?? '').trim() === '' ? { name: REQUIRED_NAME_ERROR } : {};
}

/** Значения списка по порядку. */
export function listValues(ds: Pick<Dataset, 'lists'>, key: ListKey): string[] {
  return ds.lists
    .filter((l) => l.list === key)
    .sort((a, b) => a.order - b.order || compareRu(a.value, b.value))
    .map((l) => l.value);
}

export function listOptions(ds: Pick<Dataset, 'lists'>, key: ListKey): SelectOption[] {
  return listValues(ds, key).map((v) => ({ value: v, label: v }));
}

// Мелкие помощники форм справочников.

import { DEFAULT_UNITS } from '../../domain/labels';
import type { Dataset, ListKey } from '../../domain/model';
import type { SelectOption } from '../components';
import { compareRu, normalizeName } from './cityLookup';

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

/** Значения списка по порядку. Пустой список единиц измерения (таблица до него) — заранее заведённые единицы. */
export function listValues(ds: Pick<Dataset, 'lists'>, key: ListKey): string[] {
  const own = ds.lists
    .filter((l) => l.list === key)
    .sort((a, b) => a.order - b.order || compareRu(a.value, b.value))
    .map((l) => l.value);
  return own.length === 0 && key === 'unit' ? [...DEFAULT_UNITS] : own;
}

export function listOptions(ds: Pick<Dataset, 'lists'>, key: ListKey): SelectOption[] {
  return listValues(ds, key).map((v) => ({ value: v, label: v }));
}

/** Прежние значения поля по записям — для подсказок при вводе: без пустых и повторов (без учёта регистра), по алфавиту. */
export function pastValues<T extends object>(records: readonly T[], key: keyof T): string[] {
  const seen = new Map<string, string>();
  for (const r of records) {
    const v = r[key];
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const t = String(v).trim();
    if (t && !seen.has(normalizeName(t))) seen.set(normalizeName(t), t);
  }
  return [...seen.values()].sort(compareRu);
}

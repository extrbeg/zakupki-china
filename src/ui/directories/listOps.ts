// Операции над значениями списка: порядок и проверка названия. Чистые функции.

import type { ListItem } from '../../domain/model';
import { compareRu, normalizeName } from './cityLookup';

export const sortItems = (items: ListItem[]): ListItem[] =>
  [...items].sort((a, b) => a.order - b.order || compareRu(a.value, b.value));

/** Порядок нового значения — в конец. */
export const nextOrder = (items: ListItem[]): number => items.reduce((m, i) => Math.max(m, i.order), 0) + 1;

/** Меняет значение местами с соседом и возвращает только те записи, у которых изменился порядок (нумерация 1..n). */
export function moveItem(items: ListItem[], id: string, direction: -1 | 1): ListItem[] {
  const sorted = sortItems(items);
  const from = sorted.findIndex((i) => i.id === id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sorted.length) return [];
  [sorted[from], sorted[to]] = [sorted[to], sorted[from]];
  const original = new Map(items.map((i) => [i.id, i.order]));
  return sorted.map((item, idx) => ({ ...item, order: idx + 1 })).filter((item) => original.get(item.id) !== item.order);
}

/** Ошибка названия значения (пусто или дубль в списке); пустая строка — всё верно. */
export function validateListValue(items: ListItem[], value: string, exceptId?: string): string {
  if (value.trim() === '') return 'Введите название';
  const key = normalizeName(value);
  if (items.some((i) => i.id !== exceptId && normalizeName(i.value) === key)) return 'Такое значение уже есть';
  return '';
}

// Форматы дат для текстов (предупреждения движка, проблемы импорта, подписи интерфейса) — одна реализация.

import type { ISODate } from './model';

/** `2026-10-24` → `24.10.2026`; не дата — как есть, пусто — пустая строка. */
export function ruDate(d: ISODate | undefined | null): string {
  if (!d) return '';
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d;
}

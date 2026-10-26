// Таблица истории курсов: строка на дату, ячейка на валюту; ручной курс на дату важнее автоматического.

import type { ISODate, Rate } from '../../../domain/model';
import { FOREIGN_CURRENCIES } from '../../format';

/** Дней от a до b (обе ISO-даты). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

type Foreign = Rate['currency'];

export interface RateCell { effective: Rate | null; manual: Rate | null; vtb: Rate | null }
export interface RateRow { date: ISODate; cells: Record<Foreign, RateCell> }

const emptyCell = (): RateCell => ({ effective: null, manual: null, vtb: null });

/** Строки по датам, новые сверху. При нескольких строках одного источника на дату берётся последняя в листе. */
export function buildRateRows(rates: Rate[]): RateRow[] {
  const byDate = new Map<ISODate, RateRow>();
  for (const r of rates) {
    if (!r.date || !FOREIGN_CURRENCIES.includes(r.currency)) continue;
    let row = byDate.get(r.date);
    if (!row) {
      row = { date: r.date, cells: { USD: emptyCell(), EUR: emptyCell(), CNY: emptyCell() } };
      byDate.set(r.date, row);
    }
    const cell = row.cells[r.currency];
    if (r.source === 'manual') cell.manual = r;
    else cell.vtb = r;
    cell.effective = cell.manual ?? cell.vtb;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** Дата последней строки ВТБ или null, если автокурсов нет. */
export function lastAutoDate(rates: Rate[]): ISODate | null {
  let last: ISODate | null = null;
  for (const r of rates) if (r.source === 'vtb' && r.date && (!last || r.date > last)) last = r.date;
  return last;
}

/** Автокурсы устарели: последней строке ВТБ больше 2 дней. */
export const AUTO_RATES_MAX_AGE_DAYS = 2;
export function autoRatesStale(rates: Rate[], today: ISODate): { stale: boolean; last: ISODate | null } {
  const last = lastAutoDate(rates);
  return { stale: last !== null && daysBetween(last, today) > AUTO_RATES_MAX_AGE_DAYS, last };
}

/** Ручной курс на эту дату и валюту, если есть. */
export function manualRateOn(rates: Rate[], date: ISODate, currency: Foreign): Rate | undefined {
  for (let i = rates.length - 1; i >= 0; i--) {
    const r = rates[i];
    if (r.source === 'manual' && r.date === date && r.currency === currency) return r;
  }
  return undefined;
}

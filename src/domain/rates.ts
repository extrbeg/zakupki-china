// Выбор курса валюты на дату (spec «Выбор курса на дату»):
// ручной на эту дату → автоматический (ВТБ) на эту дату → последний до даты (exact: false). RUB = 1.

import type { Currency, ISODate, Rate } from './model';

export interface RatePick { rate: number; date: ISODate; source: 'vtb' | 'manual' | 'fixed'; exact: boolean }

const usable = (r: Rate) => typeof r.rate === 'number' && Number.isFinite(r.rate) && r.rate > 0 && typeof r.date === 'string';

/** Из двух курсов одной даты ручной важнее; при равенстве — записанный позже в списке. */
const better = (a: Rate, b: Rate): boolean => (a.source === 'manual' ? 1 : 0) >= (b.source === 'manual' ? 1 : 0);

export function pickRate(rates: Rate[], currency: Currency, date: ISODate): RatePick | null {
  if (currency === 'RUB') return { rate: 1, date, source: 'fixed', exact: true };
  let best: Rate | null = null;
  for (const r of rates) {
    if (r.currency !== currency || !usable(r) || r.date > date) continue;
    if (!best || r.date > best.date || (r.date === best.date && better(r, best))) best = r;
  }
  if (!best) return null;
  return { rate: best.rate, date: best.date, source: best.source, exact: best.date === date };
}

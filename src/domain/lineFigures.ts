// Показатели позиции как в старой таблице «Закупки Китай AREC»:
// S — кол-во, T — цена в валюте, W — курс даты расчёта, AD — коэффициент.
// X = S·T, Y = T·W, Z = Y·S, AB = Y·AD (= Z·AD/S). Без округления.
// AD позиции — действующий: свой AD позиции, иначе AD поставщика в заказе (G05, effectiveCoef).

import type { Dataset, ISODate, Line, Order, SupplierOrder } from './model';
import { pickRate, type RatePick } from './rates';

export interface LineFigures { X: number; Y: number | null; Z: number | null; AB: number | null; calcRate: RatePick | null }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Дата расчёта: поставщика в заказе → заказа → сегодня. */
export function effectiveCalcDate(order: Order, so: SupplierOrder, today: ISODate): ISODate {
  return so.calcDate || order.calcDate || today;
}

/** Курс расчёта W: ручной курс поставщика в заказе, иначе курс его валюты на дату расчёта. */
export function calcRateFor(ds: Dataset, order: Order, so: SupplierOrder, today: ISODate): RatePick | null {
  const date = effectiveCalcDate(order, so, today);
  if (num(so.calcRate) && so.calcRate > 0) return { rate: so.calcRate, date, source: 'manual', exact: true };
  return pickRate(ds.rates, so.currency, date);
}

/** Действующий AD позиции: свой AD позиции (переопределение) → AD поставщика в заказе → нет. */
export function effectiveCoef(line: Pick<Line, 'coef'>, so: Pick<SupplierOrder, 'coef'> | undefined): number | undefined {
  if (num(line.coef)) return line.coef;
  return so && num(so.coef) ? so.coef : undefined;
}

/** Показатели позиции; `so` — её поставщик в заказе, чтобы AB считался по действующему AD (без него — только свой AD позиции). */
export function lineFigures(line: Line, rate: RatePick | null, so?: Pick<SupplierOrder, 'coef'>): LineFigures {
  const qty = num(line.qty) ? line.qty : 0;
  const price = num(line.unitPrice) ? line.unitPrice : 0;
  const X = qty * price;
  if (!rate) return { X, Y: null, Z: null, AB: null, calcRate: null };
  const Y = price * rate.rate;
  const coef = effectiveCoef(line, so);
  return { X, Y, Z: Y * qty, AB: coef !== undefined ? Y * coef : null, calcRate: rate };
}

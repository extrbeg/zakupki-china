// Расчёт по каждой позиции поставщика в заказе и итоги — одна функция строк для таблицы, итогов поставщика и итогов заказа,
// чтобы итоги всегда были суммами тех же величин, что видны в строках (G08). Чистые функции, без React.

import type { CostingResult, LineCost } from '../../../domain/costing';
import { calcRateFor, effectiveCoef, lineFigures } from '../../../domain/lineFigures';
import type { Currency, Dataset, ISODate, Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { deviationPct } from './orderLogic';

export interface LineRow {
  line: Line;
  /** Не «В работу» — предложение: видно, но не в итогах и себестоимости (как в движке). */
  alt: boolean;
  /** Сумма в валюте, X = кол-во × цена. */
  X: number;
  /** Цена ₽/шт и сумма ₽ по курсу даты расчёта; нет курса — null. */
  Y: number | null;
  Z: number | null;
  /** Действующий AD: свой у позиции, иначе поставщика. */
  AD: number | undefined;
  ownAD: boolean;
  /** Прогноз ₽/шт и на кол-во. */
  AB: number | null;
  ABqty: number | null;
  /** Себестоимость ₽/шт и на кол-во, AW = AV / Y; у альтернатив и без затрат — null. */
  AV: number | null;
  AVqty: number | null;
  AW: number | null;
  provisional: boolean;
  /** Отклонение AW от действующего AD, %. */
  dev: number | null;
  shipped: number;
}

export interface RowTotals { X: number; Z: number; forecast: number; cost: number }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Позиции поставщика в заказе по порядку №. */
export function supplierLines(ds: Pick<Dataset, 'lines'>, soId: string): Line[] {
  return ds.lines.filter((l) => l.supplierOrderId === soId).sort((a, b) => a.seq - b.seq);
}

/** «В работу» позиции; по умолчанию — из данных, на карточке заказа — с учётом ещё не записанных кликов. */
export type IsOn = (line: Line) => boolean;
const fromData: IsOn = (l) => !!l.purchased;

/** Строки таблицы позиций поставщика. */
export function buildLineRows(
  ds: Pick<Dataset, 'lines' | 'batches'>, costing: Pick<CostingResult, 'lines'>, so: SupplierOrder, rate: RatePick | null,
  isOn: IsOn = fromData,
): LineRow[] {
  const costs = new Map<string, LineCost>(costing.lines.map((c) => [c.lineId, c]));
  const shipped = new Map<string, number>();
  for (const b of ds.batches) if (num(b.qty)) shipped.set(b.lineId, (shipped.get(b.lineId) ?? 0) + b.qty);
  return supplierLines(ds, so.id).map((line) => {
    const f = lineFigures(line, rate, so);
    const alt = !isOn(line);
    const c = alt ? undefined : costs.get(line.id);
    const qty = num(line.qty) ? line.qty : 0;
    const AD = effectiveCoef(line, so);
    const AV = c?.AV ?? null;
    const AW = c?.AW ?? null;
    return {
      line, alt, X: f.X, Y: f.Y, Z: f.Z, AD, ownAD: num(line.coef),
      AB: f.AB, ABqty: f.AB === null ? null : f.AB * qty,
      AV, AVqty: AV === null ? null : AV * qty, AW,
      provisional: c?.provisional ?? false,
      dev: alt ? null : deviationPct(AW, AD),
      shipped: shipped.get(line.id) ?? 0,
    };
  });
}

/** Итоги по строкам «В работу»: суммы тех же величин, что в строках. */
export function sumLineRows(rows: LineRow[]): RowTotals {
  const t: RowTotals = { X: 0, Z: 0, forecast: 0, cost: 0 };
  for (const r of rows) {
    if (r.alt) continue;
    t.X += r.X;
    if (r.Z !== null) t.Z += r.Z;
    if (r.ABqty !== null) t.forecast += r.ABqty;
    if (r.AVqty !== null) t.cost += r.AVqty;
  }
  return t;
}

export interface OrderRowTotals { sumByCurrency: Partial<Record<Currency, number>>; Z: number; forecast: number; cost: number }

/** Итоги заказа — суммы итогов его поставщиков (а значит, строк). */
export function orderRowTotals(ds: Dataset, costing: Pick<CostingResult, 'lines'>, order: Order, today: ISODate, isOn: IsOn = fromData): OrderRowTotals {
  const out: OrderRowTotals = { sumByCurrency: {}, Z: 0, forecast: 0, cost: 0 };
  for (const so of ds.supplierOrders.filter((s) => s.orderId === order.id)) {
    const t = sumLineRows(buildLineRows(ds, costing, so, calcRateFor(ds, order, so, today), isOn));
    out.sumByCurrency[so.currency] = (out.sumByCurrency[so.currency] ?? 0) + t.X;
    out.Z += t.Z;
    out.forecast += t.forecast;
    out.cost += t.cost;
  }
  return out;
}

/** «позицию / позиции / позиций» для «Добавить N …». */
export function positionsWord(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return 'позицию';
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'позиции';
  return 'позиций';
}

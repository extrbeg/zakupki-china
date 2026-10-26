// Подсказки товара при вводе названия (история 93): «названия от заказчика» всех прошлых позиций — уникальные, свежие первыми.
// Выбор подсказки подставляет данные последней позиции с этим названием; вес и CBM — на единицу, пересчётом на текущее кол-во.
// Свежесть — по дате заказа, в одном заказе (и при равных датах) — позже записанная позиция свежее.

import type { Dataset, Line } from './model';
import { SUGGESTION_LIMIT, filterByQuery, searchKey } from './search';

export interface ProductHint {
  /** Название, как в последней позиции (без крайних пробелов). */
  name: string;
  /** Позиция, из которой взяты данные. */
  lineId: string;
  hsCode?: string;
  dutyRate?: number;
  packaging?: string;
  packageSize?: string;
  supplierName?: string;
  weightPerUnit?: number;
  cbmPerUnit?: number;
}

/** Поля позиции, которые подставляет подсказка. */
export type ProductFill = Pick<Partial<Line>, 'hsCode' | 'dutyRate' | 'packaging' | 'packageSize' | 'supplierName' | 'weight' | 'cbm'>;

const text = (s: string | undefined) => (s ?? '').trim() || undefined;
const perUnit = (total: number | undefined, qty: number) => (typeof total === 'number' && total > 0 && qty > 0 ? total / qty : undefined);

export function productHints(ds: Pick<Dataset, 'lines' | 'orders'>): ProductHint[] {
  const dateOf = new Map(ds.orders.map((o) => [o.id, o.date]));
  const ordered = ds.lines
    .map((line, index) => ({ line, index, date: dateOf.get(line.orderId) ?? '' }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.index - a.index));
  const seen = new Set<string>();
  const out: ProductHint[] = [];
  for (const { line } of ordered) {
    const name = text(line.customerName);
    if (!name || seen.has(searchKey(name))) continue;
    seen.add(searchKey(name));
    const hint: ProductHint = { name, lineId: line.id };
    if (text(line.hsCode)) hint.hsCode = text(line.hsCode);
    if (typeof line.dutyRate === 'number') hint.dutyRate = line.dutyRate;
    if (text(line.packaging)) hint.packaging = text(line.packaging);
    if (text(line.packageSize)) hint.packageSize = text(line.packageSize);
    if (text(line.supplierName)) hint.supplierName = text(line.supplierName);
    const w = perUnit(line.weight, line.qty);
    if (w !== undefined) hint.weightPerUnit = w;
    const c = perUnit(line.cbm, line.qty);
    if (c !== undefined) hint.cbmPerUnit = c;
    out.push(hint);
  }
  return out;
}

export function findProductHints(hints: ProductHint[], query: string, limit = SUGGESTION_LIMIT): ProductHint[] {
  return filterByQuery(hints, (h) => h.name, query, limit);
}

/** Подсказка с точно таким названием (без учёта регистра и пробелов). */
export function exactProductHint(hints: ProductHint[], name: string): ProductHint | undefined {
  const key = searchKey(name);
  return key ? hints.find((h) => searchKey(h.name) === key) : undefined;
}

/** Убирает хвост двоичной погрешности умножения (0,1 × 3 = 0,30000000000000004); точность — 1e-9. */
const clean = (n: number) => Math.round(n * 1e9) / 1e9;

/** Что подставить в позицию; вес и CBM — только при известном кол-ве. */
export function productFill(hint: ProductHint, qty: number | undefined): ProductFill {
  const out: ProductFill = {};
  if (hint.hsCode !== undefined) out.hsCode = hint.hsCode;
  if (hint.dutyRate !== undefined) out.dutyRate = hint.dutyRate;
  if (hint.packaging !== undefined) out.packaging = hint.packaging;
  if (hint.packageSize !== undefined) out.packageSize = hint.packageSize;
  if (hint.supplierName !== undefined) out.supplierName = hint.supplierName;
  if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
    if (hint.weightPerUnit !== undefined) out.weight = clean(hint.weightPerUnit * qty);
    if (hint.cbmPerUnit !== undefined) out.cbm = clean(hint.cbmPerUnit * qty);
  }
  return out;
}

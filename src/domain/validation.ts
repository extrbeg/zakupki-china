// Проверки ввода. Каждая функция возвращает { поле: русский текст ошибки }; пустой объект — всё верно.

import type { Batch, Dataset, Line, Order } from './model';
import { orderRef, ordersClash } from './numbering';

export type ValidationErrors = Record<string, string>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** Количество для текста: целое как есть, дробное — с запятой. */
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

export function validateLine(line: Partial<Line>): ValidationErrors {
  const e: ValidationErrors = {};
  if (!num(line.qty) || line.qty <= 0) e.qty = 'Количество должно быть больше нуля';
  if (!num(line.unitPrice)) e.unitPrice = 'Укажите цену';
  else if (line.unitPrice < 0) e.unitPrice = 'Цена не может быть отрицательной';
  if (line.coef !== undefined && line.coef !== null && (!num(line.coef) || line.coef <= 0)) e.coef = 'Коэффициент должен быть больше нуля';
  if (line.dutyRate !== undefined && line.dutyRate !== null && (!num(line.dutyRate) || line.dutyRate < 0 || line.dutyRate > 100)) e.dutyRate = 'Пошлина — от 0 до 100 %';
  for (const [k, label] of [['cbm', 'CBM'], ['weight', 'Вес'], ['places', 'Количество мест']] as const) {
    const v = line[k];
    if (v !== undefined && v !== null && (!num(v) || v < 0)) e[k] = `${label} не может быть отрицательным`;
  }
  return e;
}

/** Партия (новая или правка существующей по id): кол-во > 0 и сумма партий позиции ≤ кол-ва позиции. */
export function validateBatchQty(ds: Pick<Dataset, 'lines' | 'batches'>, batch: Batch): ValidationErrors {
  if (!num(batch.qty) || batch.qty <= 0) return { qty: 'Количество должно быть больше нуля' };
  const line = ds.lines.find((l) => l.id === batch.lineId);
  if (!line) return { lineId: 'Позиция не найдена' };
  const others = ds.batches.filter((b) => b.lineId === batch.lineId && b.id !== batch.id).reduce((s, b) => s + (num(b.qty) ? b.qty : 0), 0);
  const total = others + batch.qty;
  if (total > line.qty) return { qty: `В партиях ${qtyText(total)} из ${qtyText(line.qty)} шт` };
  return {};
}

/**
 * Номер заказа уникален (G33): тот же код; тот же NNN в том же году (год кода, у старого заказа — даты);
 * два старых заказа без кода — тот же номер.
 */
export function validateOrderNumberUnique(ds: Pick<Dataset, 'orders'>, order: Pick<Order, 'id' | 'number'> & Partial<Pick<Order, 'code' | 'date'>>): ValidationErrors {
  if (!num(order.number) || order.number <= 0 || !Number.isInteger(order.number)) return { number: 'Номер заказа — целое число больше нуля' };
  const candidate = { number: order.number, code: order.code, date: order.date ?? '' };
  const taken = ds.orders.find((o) => o.id !== order.id && ordersClash(o, candidate));
  if (taken) return { number: `Заказ ${orderRef(taken)} уже есть` };
  return {};
}

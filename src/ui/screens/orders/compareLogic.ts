// «Сравнение цен» (истории 78–80): товары заказа строками, поставщики колонками. Товар — позиции с одним «названием
// от заказчика» без учёта регистра и крайних пробелов; позиция без названия — своя строка. В ячейке — предложения
// поставщика по товару (обычно одно; две позиции с одним названием — обе). Прогноз ₽/шт — по действующему AD.
// Итоги: по каждому поставщику — по выбранным («В работу») и по всем предложениям; заказа — только по выбранным,
// теми же формулами, что строки таблицы поставщика и движок. Чистые функции, без React.

import { calcRateFor, lineFigures } from '../../../domain/lineFigures';
import type { Currency, Dataset, ISODate, Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { EMPTY } from '../../format';
import { supplierLines } from './linesLogic';
import { supplierOrderCode } from './orderLogic';

export interface Offer {
  line: Line;
  /** Сумма в валюте; цена ₽/шт и сумма ₽ по курсу даты расчёта (нет курса — null). */
  X: number; Y: number | null; Z: number | null;
  /** Прогноз ₽/шт по действующему AD и на кол-во; нет AD или курса — null. */
  AB: number | null; ABqty: number | null;
  selected: boolean;
  /** Минимальный прогноз ₽/шт среди предложений товара (подсвечивается, если предложений с прогнозом хотя бы два). */
  best: boolean;
}

export interface CompareColumn { so: SupplierOrder; code: string; supplierName?: string; rate: RatePick | null }
export interface CompareRow { key: string; title: string; /** soId → предложения; нет ключа — пустая ячейка. */ cells: Record<string, Offer[]> }
export interface OfferTotals { count: number; X: number; Z: number; forecast: number }
export interface CompareMatrix {
  columns: CompareColumn[];
  rows: CompareRow[];
  totals: Record<string, { selected: OfferTotals; all: OfferTotals }>;
  /** Итог заказа по выбранным. */
  order: { sumByCurrency: Partial<Record<Currency, number>>; Z: number; forecast: number };
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Ключ товара: название без регистра и крайних пробелов; без названия — своя строка на позицию. */
export function productKey(line: Pick<Line, 'id' | 'customerName'>): string {
  const name = (line.customerName ?? '').trim().toLocaleLowerCase('ru');
  return name === '' ? `line:${line.id}` : `name:${name}`;
}

const zero = (): OfferTotals => ({ count: 0, X: 0, Z: 0, forecast: 0 });
const add = (t: OfferTotals, o: Offer) => {
  t.count += 1;
  t.X += o.X;
  if (o.Z !== null) t.Z += o.Z;
  if (o.ABqty !== null) t.forecast += o.ABqty;
};

export function buildCompareMatrix(
  ds: Dataset, order: Order, today: ISODate, isSelected: (line: Line) => boolean = (l) => !!l.purchased,
): CompareMatrix {
  const sos = ds.supplierOrders.filter((s) => s.orderId === order.id).sort((a, b) => a.seq - b.seq);
  const columns: CompareColumn[] = sos.map((so) => ({
    so, code: supplierOrderCode(order, so), supplierName: ds.suppliers.find((s) => s.id === so.supplierId)?.name,
    rate: calcRateFor(ds, order, so, today),
  }));
  const rows = new Map<string, CompareRow>();
  const totals: CompareMatrix['totals'] = {};
  const orderTotals: CompareMatrix['order'] = { sumByCurrency: {}, Z: 0, forecast: 0 };

  for (const col of columns) {
    const t = { selected: zero(), all: zero() };
    totals[col.so.id] = t;
    for (const line of supplierLines(ds, col.so.id)) {
      const f = lineFigures(line, col.rate, col.so);
      const qty = num(line.qty) ? line.qty : 0;
      const offer: Offer = {
        line, X: f.X, Y: f.Y, Z: f.Z, AB: f.AB, ABqty: f.AB === null ? null : f.AB * qty,
        selected: isSelected(line), best: false,
      };
      add(t.all, offer);
      if (offer.selected) {
        add(t.selected, offer);
        orderTotals.sumByCurrency[col.so.currency] = (orderTotals.sumByCurrency[col.so.currency] ?? 0) + offer.X;
        if (offer.Z !== null) orderTotals.Z += offer.Z;
        if (offer.ABqty !== null) orderTotals.forecast += offer.ABqty;
      }
      const key = productKey(line);
      let row = rows.get(key);
      if (!row) {
        const title = line.customerName?.trim() || line.docName?.trim() || line.supplierName?.trim() || `${EMPTY} (позиция ${col.code}-${line.seq})`;
        row = { key, title, cells: {} };
        rows.set(key, row);
      }
      (row.cells[col.so.id] ??= []).push(offer);
    }
  }

  for (const row of rows.values()) {
    const priced = Object.values(row.cells).flat().filter((o) => o.AB !== null);
    if (priced.length < 2) continue;
    const best = Math.min(...priced.map((o) => o.AB as number));
    for (const o of priced) o.best = o.AB === best;
  }
  return { columns, rows: [...rows.values()], totals, order: orderTotals };
}

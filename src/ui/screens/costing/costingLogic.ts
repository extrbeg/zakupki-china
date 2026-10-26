// Чистая логика экрана «Себестоимость»: строки таблицы, отклонение AW от AD, предупреждения выбора, строки отчёта.
// Выбор заказов — только фильтр показа: движок считает всё по всем данным (R18.1).

import { AD_LABEL, AW_LABEL } from '../orders/coefLabels';
import { COST_CATEGORIES, COST_CATEGORY_LABEL, type BatchCost, type CostCategory, type CostWarning, type CostingResult, type LineCost } from '../../../domain/costing';
import type { Dataset, ISODate, Line, Order, Supplier, SupplierOrder } from '../../../domain/model';
import type { ReportRow } from '../../../store/types';

export interface CostingRow {
  line: Line; order: Order; so?: SupplierOrder; supplier?: Supplier; cost: LineCost; batches: BatchCost[];
  /** (AW − AD) / AD · 100: больше нуля — хуже прогноза, меньше — лучше. */
  deviationPct: number | null;
}

export interface SelectionTotals { lines: number; total: number; breakdown: Record<CostCategory, number>; forecastRub: number }

export interface WarningLink { to: string; label: string }
export interface SelectionWarning { warning: CostWarning; links: WarningLink[] }

export function deviationPct(aw: number | null, ad: number | null): number | null {
  if (aw === null || ad === null || !(ad > 0)) return null;
  return ((aw - ad) / ad) * 100;
}

export function lineTitle(line: Line): string {
  return line.customerName || line.docName || line.supplierName || `Позиция ${line.seq}`;
}

/** Строки позиций «В работу» выбранных заказов: по номеру заказа, поставщику в заказе, номеру позиции. */
export function buildRows(ds: Dataset, costing: CostingResult, selected: ReadonlySet<string>): CostingRow[] {
  const orders = new Map(ds.orders.map((o) => [o.id, o]));
  const sos = new Map(ds.supplierOrders.map((s) => [s.id, s]));
  const suppliers = new Map(ds.suppliers.map((s) => [s.id, s]));
  const lines = new Map(ds.lines.map((l) => [l.id, l]));
  const rows: CostingRow[] = [];
  for (const cost of costing.lines) {
    if (!selected.has(cost.orderId)) continue;
    const line = lines.get(cost.lineId);
    const order = orders.get(cost.orderId);
    if (!line || !order) continue;
    const so = sos.get(line.supplierOrderId);
    rows.push({
      line, order, so, supplier: so ? suppliers.get(so.supplierId) : undefined, cost,
      batches: costing.batches.filter((b) => b.lineId === line.id),
      deviationPct: deviationPct(cost.AW, cost.AD),
    });
  }
  return rows.sort((a, b) => a.order.number - b.order.number || (a.so?.seq ?? 0) - (b.so?.seq ?? 0) || a.line.seq - b.line.seq);
}

const zeroBreakdown = (): Record<CostCategory, number> => Object.fromEntries(COST_CATEGORIES.map((k) => [k, 0])) as Record<CostCategory, number>;

export function selectionTotals(costing: CostingResult, rows: CostingRow[], selected: ReadonlySet<string>): SelectionTotals {
  const breakdown = zeroBreakdown();
  let total = 0;
  for (const r of rows) {
    total += r.cost.total;
    for (const k of COST_CATEGORIES) breakdown[k] += r.cost.breakdown[k];
  }
  const forecastRub = costing.orders.filter((o) => selected.has(o.orderId)).reduce((s, o) => s + o.forecastRub, 0);
  return { lines: rows.length, total, breakdown, forecastRub };
}

// ---------- предупреждения ----------

type RefType = CostWarning['refs'][number]['type'];

/** Какие заказы затрагивает объект, на который ссылается предупреждение. */
function orderIdsOf(ds: Dataset, costing: CostingResult, type: RefType, id: string, depth = 0): string[] {
  if (depth > 2) return [];
  switch (type) {
    case 'order': return [id];
    case 'supplierOrder': {
      const so = ds.supplierOrders.find((s) => s.id === id);
      return so ? [so.orderId] : [];
    }
    case 'line': {
      const l = ds.lines.find((x) => x.id === id);
      return l ? [l.orderId] : [];
    }
    case 'batch': {
      const b = costing.batches.find((x) => x.batchId === id);
      return b ? orderIdsOf(ds, costing, 'line', b.lineId, depth + 1) : [];
    }
    case 'shipment': {
      const ids = new Set<string>();
      for (const b of costing.batches) if (b.shipmentId === id) orderIdsOf(ds, costing, 'line', b.lineId, depth + 1).forEach((o) => ids.add(o));
      return [...ids];
    }
    case 'declaration': {
      const d = ds.declarations.find((x) => x.id === id);
      return d ? orderIdsOf(ds, costing, 'shipment', d.shipmentId, depth + 1) : [];
    }
    case 'cost': {
      const c = ds.costs.find((x) => x.id === id);
      return c ? orderIdsOf(ds, costing, c.targetType, c.targetId, depth + 1) : [];
    }
  }
}

function linkFor(ds: Dataset, costing: CostingResult, ref: CostWarning['refs'][number]): WarningLink | null {
  const orderLink = (orderId: string): WarningLink | null => {
    const o = ds.orders.find((x) => x.id === orderId);
    return o ? { to: `/orders/${o.id}`, label: `Заказ № ${o.number}` } : null;
  };
  const shipmentLink = (shipmentId: string): WarningLink | null => {
    const s = ds.shipments.find((x) => x.id === shipmentId);
    return s ? { to: `/shipments/${s.id}`, label: `Поставка ${s.number}` } : null;
  };
  switch (ref.type) {
    case 'order': return orderLink(ref.id);
    case 'supplierOrder': case 'line': return orderIdsOf(ds, costing, ref.type, ref.id).map(orderLink)[0] ?? null;
    case 'shipment': return shipmentLink(ref.id);
    case 'declaration': { const d = ds.declarations.find((x) => x.id === ref.id); return d ? shipmentLink(d.shipmentId) : null; }
    case 'batch': {
      const b = costing.batches.find((x) => x.batchId === ref.id);
      if (!b) return null;
      return (b.shipmentId ? shipmentLink(b.shipmentId) : null) ?? orderIdsOf(ds, costing, 'batch', ref.id).map(orderLink)[0] ?? null;
    }
    case 'cost': return ds.costs.some((c) => c.id === ref.id) ? { to: '/costs', label: 'Затраты' } : null;
  }
}

/** Предупреждения движка, относящиеся к выбранным заказам (без привязки к заказам — общие — тоже). */
export function selectionWarnings(ds: Dataset, costing: CostingResult, selected: ReadonlySet<string>): SelectionWarning[] {
  const out: SelectionWarning[] = [];
  for (const warning of costing.warnings) {
    const touches = warning.refs.length === 0
      || warning.refs.some((r) => orderIdsOf(ds, costing, r.type, r.id).some((o) => selected.has(o)));
    if (!touches) continue;
    const links: WarningLink[] = [];
    for (const r of warning.refs) {
      const l = linkFor(ds, costing, r);
      if (l && !links.some((x) => x.to === l.to && x.label === l.label)) links.push(l);
    }
    out.push({ warning, links });
  }
  return out;
}

// ---------- лист «Себестоимость» ----------

const r2 = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** Строки для `store.writeReport('Себестоимость', rows)`: шапка, таблица позиций, итог. Числа — с 2 знаками. */
export function buildReportRows(ds: Dataset, rows: CostingRow[], selected: ReadonlySet<string>, today: ISODate): ReportRow[] {
  const numbers = ds.orders.filter((o) => selected.has(o.id)).map((o) => o.number).sort((a, b) => a - b).join(', ');
  const header = [
    'Заказ', 'Поставщик', '№', 'Позиция', 'Кол-во', 'Цена в валюте', 'Валюта', 'Y, ₽', 'AB', AD_LABEL,
    'Себестоимость позиции, ₽', 'AV, ₽/шт', AW_LABEL, 'Отклонение, %', 'Статус',
    ...COST_CATEGORIES.map((k) => `${COST_CATEGORY_LABEL[k]}, ₽`),
  ];
  const out: ReportRow[] = [
    ['Себестоимость позиций'],
    ['Дата расчёта', today],
    ['Заказы', numbers],
    [],
    header,
  ];
  const sum = zeroBreakdown();
  let total = 0;
  for (const r of rows) {
    const c = r.cost;
    total += c.total;
    for (const k of COST_CATEGORIES) sum[k] += c.breakdown[k];
    out.push([
      r.order.number, r.supplier?.name ?? '', r.line.seq, lineTitle(r.line), r.line.qty, r2(r.line.unitPrice), r.so?.currency ?? '',
      r2(c.Y), r2(c.AB), r2(c.AD), r2(c.total), r2(c.AV), r2(c.AW), r2(r.deviationPct), c.provisional ? 'предварительно' : 'закрыт',
      ...COST_CATEGORIES.map((k) => r2(c.breakdown[k])),
    ]);
  }
  const totalRow: (string | number | null)[] = header.map(() => null);
  totalRow[0] = 'Итого';
  totalRow[header.indexOf('Себестоимость позиции, ₽')] = r2(total);
  COST_CATEGORIES.forEach((k) => { totalRow[header.indexOf(`${COST_CATEGORY_LABEL[k]}, ₽`)] = r2(sum[k]); });
  out.push([], totalRow);
  return out;
}

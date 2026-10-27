// Доли затрат по заказам (G31): как затрата легла на заказы — по фактическому распределению движка
// (`CostingResult.allocations`: доля каждой затраты в каждой партии). Чистые функции, без округления.
//
// Сумма долей = рубли затраты; чего в ней нет — нераспределённое (пустая база распределения).
// % — от рублей затраты. Затраты поставки — на саму поставку и на её декларации: все делятся на все заказы в поставке.

import type { Cost, Dataset } from './model';
import type { CostingResult } from './costing/types';
import { compareOrders } from './numbering';

export interface CostOrderShare { orderId: string; rub: number; pct: number }
export interface OrderShipmentShare { cost: Cost; shipmentId: string; rub: number; pct: number }

type Refs = Pick<Dataset, 'orders' | 'lines'>;

function costRub(costing: CostingResult, costId: string): number | null {
  const r = costing.costsRub.find((x) => x.costId === costId);
  return r && typeof r.rub === 'number' && Number.isFinite(r.rub) ? r.rub : null;
}

/** Рубли затраты по заказам; партия → позиция → заказ. Порядок — по номеру заказа. */
function sharesFrom(ds: Refs, costing: CostingResult, costId: string, lineOfBatch: Map<string, string>): CostOrderShare[] {
  const rub = costRub(costing, costId);
  if (rub === null || rub === 0) return [];
  const orderOfLine = new Map(ds.lines.map((l) => [l.id, l.orderId]));
  const byOrder = new Map<string, number>();
  for (const a of costing.allocations) {
    if (a.costId !== costId) continue;
    const orderId = orderOfLine.get(lineOfBatch.get(a.batchId) ?? '');
    if (orderId === undefined) continue;
    byOrder.set(orderId, (byOrder.get(orderId) ?? 0) + a.rub);
  }
  const orders = new Map(ds.orders.map((o) => [o.id, o]));
  return [...byOrder]
    .map(([orderId, part]) => ({ orderId, rub: part, pct: (part / rub) * 100 }))
    .sort((a, b) => {
      const oa = orders.get(a.orderId);
      const ob = orders.get(b.orderId);
      return oa && ob ? compareOrders(oa, ob) : (oa ? 0 : 1) - (ob ? 0 : 1);
    });
}

const batchLines = (costing: CostingResult) => new Map(costing.batches.map((b) => [b.batchId, b.lineId]));

/** Как затрата `costId` легла на заказы: ₽ и % от рублей затраты. Нет рублей или затраты — пусто. */
export function costSharesByOrder(ds: Dataset, costing: CostingResult, costId: string): CostOrderShare[] {
  return sharesFrom(ds, costing, costId, batchLines(costing));
}

/** Часть затраты, не легшая ни на один заказ (пустая база распределения); нет рублей — 0. */
export function costUnallocatedRub(ds: Dataset, costing: CostingResult, costId: string): number {
  const rub = costRub(costing, costId);
  if (rub === null) return 0;
  return rub - costSharesByOrder(ds, costing, costId).reduce((s, x) => s + x.rub, 0);
}

/** Затраты поставки: на саму поставку и на её декларации, в порядке листа. */
export function shipmentCostsOf(ds: Pick<Dataset, 'costs' | 'declarations'>, shipmentId: string): Cost[] {
  const declIds = new Set(ds.declarations.filter((d) => d.shipmentId === shipmentId).map((d) => d.id));
  return ds.costs.filter((c) => (c.targetType === 'shipment' && c.targetId === shipmentId) || (c.targetType === 'declaration' && declIds.has(c.targetId)));
}

/** Поставка затраты: сама поставка или поставка декларации; иначе undefined. */
export function shipmentOfCost(ds: Pick<Dataset, 'declarations'>, c: Pick<Cost, 'targetType' | 'targetId'>): string | undefined {
  if (c.targetType === 'shipment') return c.targetId;
  if (c.targetType === 'declaration') return ds.declarations.find((d) => d.id === c.targetId)?.shipmentId;
  return undefined;
}

/** Доли затрат поставок (и их деклараций), легшие на заказ: по строке на затрату с ненулевой долей, в порядке листа. */
export function orderShipmentShares(ds: Dataset, costing: CostingResult, orderId: string): OrderShipmentShare[] {
  const lines = batchLines(costing);
  const out: OrderShipmentShare[] = [];
  for (const c of ds.costs) {
    const shipmentId = shipmentOfCost(ds, c);
    if (shipmentId === undefined) continue;
    const share = sharesFrom(ds, costing, c.id, lines).find((s) => s.orderId === orderId);
    if (share && share.rub !== 0) out.push({ cost: c, shipmentId, rub: share.rub, pct: share.pct });
  }
  return out;
}

/**
 * Затраты поставок (и их деклараций) без рублей (нет курса), в базу которых входят партии заказа:
 * долю посчитать нельзя, но затрата касается заказа. Поставка — партии заказа в ней; декларация — партии заказа в декларации.
 */
export function orderShipmentCostsWithoutRub(ds: Dataset, costing: CostingResult, orderId: string): { cost: Cost; shipmentId: string }[] {
  const lineIds = new Set(ds.lines.filter((l) => l.orderId === orderId).map((l) => l.id));
  const own = ds.batches.filter((b) => lineIds.has(b.lineId));
  const out: { cost: Cost; shipmentId: string }[] = [];
  for (const c of ds.costs) {
    const shipmentId = shipmentOfCost(ds, c);
    if (shipmentId === undefined || costRub(costing, c.id) !== null) continue;
    const touches = c.targetType === 'declaration' ? own.some((b) => b.declarationId === c.targetId) : own.some((b) => b.shipmentId === shipmentId);
    if (touches) out.push({ cost: c, shipmentId });
  }
  return out;
}

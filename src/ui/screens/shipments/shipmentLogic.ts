// Чистая логика экранов поставок: подписи, остатки позиций, раскладка по декларациям, запреты на удаление.

import { newId } from '../../../domain/ids';
import type { Batch, Cost, Dataset, Declaration, Line, Order, Shipment } from '../../../domain/model';
import { compareOrders, orderLabel, orderRef } from '../../../domain/numbering';
import { formatMoney, formatQty, unitOf } from '../../format';

export const DEFAULT_VAT = 22;

/** Ставка НДС для новой поставки: из настроек, иначе 22. */
export function defaultVatRate(ds: Pick<Dataset, 'settings'>): number {
  const text = String(ds.settings?.vatRateDefault ?? '').trim().replace(',', '.');
  const n = Number(text);
  return text !== '' && Number.isFinite(n) ? n : DEFAULT_VAT;
}

const round = (n: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** Сколько позиции уже уехало в партиях (кроме партии `exceptBatchId`). */
export function shippedQty(ds: Pick<Dataset, 'batches'>, lineId: string, exceptBatchId?: string): number {
  return ds.batches.filter((b) => b.lineId === lineId && b.id !== exceptBatchId).reduce((s, b) => s + (Number.isFinite(b.qty) ? b.qty : 0), 0);
}

export interface LineChoice {
  line: Line;
  orderNumber: number | undefined;
  /** Номер заказа для показа: код З-ГГГГ-NNN, у старого — прежний номер. */
  orderLabel: string;
  supplierName: string;
  title: string;
  remaining: number;
  /** Строка для поиска и подпись варианта. */
  label: string;
}

/** Позиции «В работу» любых заказов и поставщиков с остатком; для поиска — `label` в нижнем регистре в `search`. */
export function lineChoices(ds: Dataset): (LineChoice & { search: string })[] {
  const orders = new Map(ds.orders.map((o) => [o.id, o]));
  const sos = new Map(ds.supplierOrders.map((s) => [s.id, s]));
  const suppliers = new Map(ds.suppliers.map((s) => [s.id, s]));
  const out: (LineChoice & { search: string; order: Order | undefined })[] = [];
  for (const line of ds.lines) {
    if (!line.purchased) continue;
    const remaining = line.qty - shippedQty(ds, line.id);
    if (remaining <= 0) continue;
    const order = orders.get(line.orderId);
    const orderNumber = order?.number;
    const shown = order ? orderRef(order) : '№ ?';
    const label0 = order ? orderLabel(order) : '';
    const supplierName = suppliers.get(sos.get(line.supplierOrderId)?.supplierId ?? '')?.name ?? line.supplierName ?? '';
    const title = line.customerName || line.docName || line.supplierName || `позиция ${line.seq}`;
    const label = `Заказ ${shown} · ${supplierName || 'без поставщика'} · ${line.seq}. ${title} — остаток ${formatQty(remaining)} из ${formatQty(line.qty)} ${unitOf(line)}`;
    const search = [`заказ ${orderNumber ?? ''}`, `№ ${orderNumber ?? ''}`, order?.code, supplierName, line.customerName, line.docName, line.supplierName, line.techParams].filter(Boolean).join(' ').toLowerCase();
    out.push({ line, orderNumber, orderLabel: label0, supplierName, title, remaining, label, search, order });
  }
  return out
    .sort((a, b) => (a.order && b.order ? compareOrders(a.order, b.order) : (a.orderNumber ?? 0) - (b.orderNumber ?? 0)) || a.line.seq - b.line.seq)
    .map(({ order: _o, ...rest }) => rest);
}

export type Defaults = { cbm?: number; weight?: number; places?: number };

/** CBM, вес и места партии по умолчанию — доля позиции пропорционально количеству. */
export function proportionalDefaults(line: Line | undefined, qty: number | undefined): Defaults {
  if (!line || !qty || !(line.qty > 0)) return {};
  const k = qty / line.qty;
  const out: Defaults = {};
  if (line.cbm !== undefined && line.cbm > 0) out.cbm = round(line.cbm * k, 4);
  if (line.weight !== undefined && line.weight > 0) out.weight = round(line.weight * k, 3);
  if (line.places !== undefined && line.places > 0) out.places = Math.max(1, Math.round(line.places * k));
  return out;
}

/** Поставщик партии — через позицию и «поставщика в заказе». */
export function batchSupplierId(ds: Pick<Dataset, 'lines' | 'supplierOrders'>, batch: Batch): string | undefined {
  const line = ds.lines.find((l) => l.id === batch.lineId);
  return ds.supplierOrders.find((so) => so.id === line?.supplierOrderId)?.supplierId;
}

export interface DeclarationPlan {
  newDeclarations: Declaration[];
  /** Партии с проставленной декларацией (только те, у которых её не было). */
  updatedBatches: Batch[];
}

/**
 * «По декларации на поставщика»: партии поставки без декларации раскладываются по поставщикам.
 * Уже назначенные не трогаются. Для поставщика берётся декларация, где уже лежат его партии;
 * иначе — пустая декларация поставки (по порядку); иначе создаётся новая с пометкой поставщика в комментарии.
 */
export function planDeclarationsBySupplier(ds: Dataset, shipmentId: string): DeclarationPlan {
  const batches = ds.batches.filter((b) => b.shipmentId === shipmentId);
  const decls = ds.declarations.filter((d) => d.shipmentId === shipmentId);
  const declOfSupplier = new Map<string, string>();
  for (const b of batches) {
    const sup = batchSupplierId(ds, b);
    if (b.declarationId && sup && decls.some((d) => d.id === b.declarationId) && !declOfSupplier.has(sup)) declOfSupplier.set(sup, b.declarationId);
  }
  const used = new Set(declOfSupplier.values());
  const emptyDecls = decls.filter((d) => !batches.some((b) => b.declarationId === d.id) && !used.has(d.id));
  const supplierName = (id: string) => ds.suppliers.find((s) => s.id === id)?.name;

  const newDeclarations: Declaration[] = [];
  const updatedBatches: Batch[] = [];
  for (const b of batches) {
    if (b.declarationId && decls.some((d) => d.id === b.declarationId)) continue;
    const sup = batchSupplierId(ds, b) ?? '';
    let declId = declOfSupplier.get(sup);
    if (!declId) {
      const empty = emptyDecls.shift();
      if (empty) declId = empty.id;
      else {
        const name = supplierName(sup);
        const d: Declaration = { id: newId('dec'), shipmentId, ...(name ? { comment: `Поставщик: ${name}` } : {}) };
        newDeclarations.push(d);
        declId = d.id;
      }
      declOfSupplier.set(sup, declId);
    }
    updatedBatches.push({ ...b, declarationId: declId });
  }
  return { newDeclarations, updatedBatches };
}

const costLabel = (c: Cost) => `«${c.costType}»${c.amount !== undefined ? ` ${formatMoney(c.amount)} ${c.currency}` : ''}`;

/** Причина, по которой поставку нельзя удалить (затраты на неё и на её декларации); null — можно. */
export function shipmentDeleteBlock(ds: Pick<Dataset, 'costs' | 'declarations'>, shipmentId: string): string | null {
  const declIds = new Set(ds.declarations.filter((d) => d.shipmentId === shipmentId).map((d) => d.id));
  const costs = ds.costs.filter((c) => (c.targetType === 'shipment' && c.targetId === shipmentId) || (c.targetType === 'declaration' && declIds.has(c.targetId)));
  return costs.length > 0 ? `Поставку нельзя удалить: на неё внесены затраты (${costs.length}) — ${costs.map(costLabel).join(', ')}` : null;
}

export function declarationDeleteBlock(ds: Pick<Dataset, 'costs'>, declarationId: string): string | null {
  const costs = ds.costs.filter((c) => c.targetType === 'declaration' && c.targetId === declarationId);
  return costs.length > 0 ? `Декларацию нельзя удалить: на неё внесены затраты (${costs.length}) — ${costs.map(costLabel).join(', ')}` : null;
}

export function shipmentNumberTaken(ds: Pick<Dataset, 'shipments'>, s: Pick<Shipment, 'id' | 'number'>): boolean {
  const n = s.number.trim().toLowerCase();
  return ds.shipments.some((x) => x.id !== s.id && x.number.trim().toLowerCase() === n);
}

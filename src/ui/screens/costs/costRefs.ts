// Подписи и связи затраты: привязка (заказ, поставщик в заказе, поставка, декларация, позиция), получатель,
// типы затрат, принадлежность заказу и поставке — для журнала, фильтров и формы.

import type { Cost, CostTargetType, Dataset, PayeeType } from '../../../domain/model';
import { COST_TYPES } from '../../../domain/costing';
import type { SelectOption } from '../../components';

export const TARGET_TYPES: CostTargetType[] = ['order', 'supplierOrder', 'line', 'shipment', 'declaration'];
export const TARGET_TYPE_LABEL: Record<CostTargetType, string> = {
  order: 'Заказ', supplierOrder: 'Поставщик в заказе', line: 'Позиция', shipment: 'Поставка', declaration: 'Декларация',
};

export const PAYEE_TYPES: PayeeType[] = ['supplier', 'agent', 'carrier', 'text'];
export const PAYEE_TYPE_LABEL: Record<PayeeType, string> = {
  supplier: 'Поставщик', agent: 'Платёжный агент', carrier: 'Перевозчик', text: 'Другое (текстом)',
};

const byId = <T extends { id: string }>(list: T[], id: string | undefined): T | undefined => (id ? list.find((x) => x.id === id) : undefined);

function orderTitle(ds: Dataset, orderId: string): string {
  const o = byId(ds.orders, orderId);
  return o ? `Заказ № ${o.number}` : 'Заказ ?';
}

function supplierOrderTitle(ds: Dataset, soId: string): string {
  const so = byId(ds.supplierOrders, soId);
  if (!so) return 'Поставщик в заказе ?';
  const sup = byId(ds.suppliers, so.supplierId);
  return `${orderTitle(ds, so.orderId)} · поставщик ${so.seq}${sup ? ` — ${sup.name}` : ''}`;
}

/** Подпись объекта привязки: «Заказ № 12 · поставщик 1 — Alpha Valve». */
export function targetLabel(ds: Dataset, type: CostTargetType, id: string): string {
  switch (type) {
    case 'order': {
      const o = byId(ds.orders, id);
      return o ? `Заказ № ${o.number}${o.title ? ` — ${o.title}` : ''}` : 'Заказ ?';
    }
    case 'supplierOrder':
      return supplierOrderTitle(ds, id);
    case 'line': {
      const l = byId(ds.lines, id);
      if (!l) return 'Позиция ?';
      const name = l.customerName || l.docName || l.supplierName;
      return `${supplierOrderTitle(ds, l.supplierOrderId)} · поз. ${l.seq}${name ? ` — ${name}` : ''}`;
    }
    case 'shipment': {
      const s = byId(ds.shipments, id);
      return s ? `Поставка ${s.number}` : 'Поставка ?';
    }
    case 'declaration': {
      const d = byId(ds.declarations, id);
      if (!d) return 'Декларация ?';
      const s = byId(ds.shipments, d.shipmentId);
      return `ДТ ${d.number || 'без номера'}${s ? ` · поставка ${s.number}` : ''}`;
    }
  }
}

const orderNumber = (ds: Dataset, orderId: string) => byId(ds.orders, orderId)?.number ?? Number.MAX_SAFE_INTEGER;

/** Варианты объекта привязки выбранного вида, по номеру заказа / поставки. */
export function targetOptions(ds: Dataset, type: CostTargetType): SelectOption[] {
  const opt = (id: string) => ({ value: id, label: targetLabel(ds, type, id) });
  switch (type) {
    case 'order':
      return [...ds.orders].sort((a, b) => b.number - a.number).map((o) => opt(o.id));
    case 'supplierOrder':
      return [...ds.supplierOrders]
        .sort((a, b) => orderNumber(ds, b.orderId) - orderNumber(ds, a.orderId) || a.seq - b.seq)
        .map((so) => opt(so.id));
    case 'line': {
      const soSeq = (id: string) => byId(ds.supplierOrders, id)?.seq ?? 0;
      return [...ds.lines]
        .sort((a, b) => orderNumber(ds, b.orderId) - orderNumber(ds, a.orderId) || soSeq(a.supplierOrderId) - soSeq(b.supplierOrderId) || a.seq - b.seq)
        .map((l) => opt(l.id));
    }
    case 'shipment':
      return [...ds.shipments].sort((a, b) => b.number.localeCompare(a.number, 'ru', { numeric: true })).map((s) => opt(s.id));
    case 'declaration':
      return ds.declarations.map((d) => opt(d.id)).sort((a, b) => a.label.localeCompare(b.label, 'ru', { numeric: true }));
  }
}

/** Получатель платежа для журнала. */
export function payeeLabel(ds: Dataset, c: Pick<Cost, 'payeeType' | 'payeeId' | 'payeeText'>): string {
  switch (c.payeeType) {
    case 'supplier': return byId(ds.suppliers, c.payeeId)?.name ?? '';
    case 'agent': return byId(ds.agents, c.payeeId)?.name ?? '';
    case 'carrier': return byId(ds.carriers, c.payeeId)?.name ?? '';
    case 'text': return c.payeeText ?? '';
    default: return c.payeeText ?? '';
  }
}

export function payeeOptions(ds: Dataset, type: PayeeType): SelectOption[] {
  const list = type === 'supplier' ? ds.suppliers : type === 'agent' ? ds.agents : type === 'carrier' ? ds.carriers : [];
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((x) => ({ value: x.id, label: x.name }));
}

/** Типы затрат: список «Тип затрат» (по порядку), затем стандартные, которых в нём нет. */
export function costTypeOptions(ds: Dataset): SelectOption[] {
  const own = ds.lists.filter((i) => i.list === 'costType' && i.value.trim()).sort((a, b) => a.order - b.order).map((i) => i.value.trim());
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const v of [...own, ...COST_TYPES.map((t) => t.value)]) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ value: v, label: v });
  }
  return out;
}

/** Заказ, к которому затрата относится напрямую (заказ, поставщик в заказе, позиция); для поставки и декларации — нет. */
export function costOrderId(ds: Dataset, c: Pick<Cost, 'targetType' | 'targetId'>): string | undefined {
  switch (c.targetType) {
    case 'order': return c.targetId;
    case 'supplierOrder': return byId(ds.supplierOrders, c.targetId)?.orderId;
    case 'line': return byId(ds.lines, c.targetId)?.orderId;
    default: return undefined;
  }
}

/** Поставка затраты: сама поставка или поставка декларации. */
export function costShipmentId(ds: Dataset, c: Pick<Cost, 'targetType' | 'targetId'>): string | undefined {
  if (c.targetType === 'shipment') return c.targetId;
  if (c.targetType === 'declaration') return byId(ds.declarations, c.targetId)?.shipmentId;
  return undefined;
}

/** Поставщик в заказе, к которому относится привязка (для валюты по умолчанию и курса расчёта). */
export function targetSupplierOrderId(ds: Dataset, type: CostTargetType, id: string): string | undefined {
  if (type === 'supplierOrder') return id;
  if (type === 'line') return byId(ds.lines, id)?.supplierOrderId;
  return undefined;
}

// Где используется запись справочника — чтобы не удалить то, на что ссылаются другие листы.

import type { Dataset } from '../../domain/model';
import { compareRu } from './cityLookup';

/** Номера заказов, в которых есть поставщик, по возрастанию. */
export function supplierOrderNumbers(ds: Pick<Dataset, 'orders' | 'supplierOrders'>, supplierId: string): number[] {
  const orderIds = new Set(ds.supplierOrders.filter((so) => so.supplierId === supplierId).map((so) => so.orderId));
  const numbers = ds.orders.filter((o) => orderIds.has(o.id)).map((o) => o.number);
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** Причина, по которой поставщика нельзя удалить; null — можно. */
export function supplierDeleteBlock(ds: Pick<Dataset, 'orders' | 'supplierOrders'>, supplierId: string): string | null {
  const numbers = supplierOrderNumbers(ds, supplierId);
  return numbers.length > 0 ? `Поставщик используется в заказах: ${numbers.join(', ')}` : null;
}

export function carrierDeleteBlock(ds: Pick<Dataset, 'shipments'>, carrierId: string): string | null {
  const numbers = ds.shipments.filter((s) => s.carrierId === carrierId).map((s) => s.number).sort(compareRu);
  return numbers.length > 0 ? `Перевозчик используется в поставках: ${numbers.join(', ')}` : null;
}

export function agentDeleteBlock(ds: Pick<Dataset, 'costs'>, agentId: string): string | null {
  const count = ds.costs.filter((c) => c.payeeType === 'agent' && c.payeeId === agentId).length;
  return count > 0 ? `Агент используется в затратах: ${count}` : null;
}

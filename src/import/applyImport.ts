// Запись плана импорта в подключённую таблицу. В непустую таблицу — только добавление без повторов:
// списки, города, курсы, поставщики, агенты и перевозчики, которые уже есть, не дублируются;
// заказ с уже занятым номером пропускается целиком (с поставщиками, позициями, поставками и затратами).

import type { Dataset, EntityName } from '../domain/model';
import type { Store } from '../store/types';
import { nameKey, norm } from './cells';
import type { ImportData, ImportPlan, ImportProblem } from './types';

export interface ImportResult { inserted: Record<string, number>; skipped: ImportProblem[] }

/** Сущности, по которым таблица считается непустой (списки по умолчанию и курсы скрипта — не в счёт). */
const USER_ENTITIES: EntityName[] = ['orders', 'supplierOrders', 'lines', 'suppliers', 'agents', 'carriers', 'shipments', 'batches', 'declarations', 'costs'];

/** Есть ли в таблице данные пользователя — тогда импорт только с явным «добавить». */
export function hasUserData(ds: Dataset): boolean {
  return USER_ENTITIES.some((e) => (ds[e]?.length ?? 0) > 0);
}

/** Порядок записи: справочники раньше ссылающихся на них записей. */
const WRITE_ORDER: (keyof ImportData)[] = ['lists', 'cities', 'rates', 'suppliers', 'agents', 'carriers', 'orders', 'supplierOrders', 'lines', 'shipments', 'batches', 'declarations', 'costs'];

/** Чистая часть: план за вычетом того, что уже есть в таблице. */
export function mergeWithExisting(plan: ImportPlan, existing: Dataset): { data: ImportData; skipped: ImportProblem[] } {
  const d = plan.data;
  const skipped: ImportProblem[] = [];
  const out: ImportData = {};

  // Списки: без повторов значения внутри списка; новые — в конец списка.
  const lastOrder = new Map<string, number>();
  const haveList = new Set<string>();
  for (const l of existing.lists) {
    haveList.add(`${l.list}|${norm(l.value)}`);
    lastOrder.set(l.list, Math.max(lastOrder.get(l.list) ?? 0, l.order));
  }
  out.lists = (d.lists ?? []).filter((l) => !haveList.has(`${l.list}|${norm(l.value)}`)).map((l) => {
    const order = (lastOrder.get(l.list) ?? 0) + 1;
    lastOrder.set(l.list, order);
    return { ...l, order };
  });

  const haveCity = new Set(existing.cities.map((c) => norm(c.city)));
  out.cities = (d.cities ?? []).filter((c) => !haveCity.has(norm(c.city)));

  const haveRate = new Set(existing.rates.map((r) => `${r.date}|${r.currency}|${r.source}`));
  out.rates = (d.rates ?? []).filter((r) => !haveRate.has(`${r.date}|${r.currency}|${r.source}`));

  // Поставщики с тем же именем — берётся существующий, ссылки перенаправляются.
  const supplierByKey = new Map(existing.suppliers.map((s) => [nameKey(s.name), s.id]));
  const supplierId = new Map<string, string>();
  out.suppliers = (d.suppliers ?? []).filter((s) => {
    const have = supplierByKey.get(nameKey(s.name));
    if (have) { supplierId.set(s.id, have); return false; }
    return true;
  });
  const agentKeys = new Set(existing.agents.map((a) => nameKey(a.name)));
  out.agents = (d.agents ?? []).filter((a) => !agentKeys.has(nameKey(a.name)));
  const carrierKeys = new Set(existing.carriers.map((c) => nameKey(c.name)));
  out.carriers = (d.carriers ?? []).filter((c) => !carrierKeys.has(nameKey(c.name)));

  // Заказы с занятым номером — пропускаются со всем, что к ним относится.
  const numbers = new Set(existing.orders.map((o) => o.number));
  const skippedOrders = new Set<string>();
  out.orders = (d.orders ?? []).filter((o) => {
    if (!numbers.has(o.number)) return true;
    skippedOrders.add(o.id);
    const src = plan.origins?.[o.id];
    skipped.push({ sheet: src?.sheet ?? 'Заказы', row: src?.row ?? 0, message: `Заказ № ${o.number} уже есть в таблице — пропущен вместе с позициями и затратами` });
    return false;
  });
  out.supplierOrders = (d.supplierOrders ?? []).filter((so) => !skippedOrders.has(so.orderId))
    .map((so) => (supplierId.has(so.supplierId) ? { ...so, supplierId: supplierId.get(so.supplierId)! } : so));
  const skippedLines = new Set((d.lines ?? []).filter((l) => skippedOrders.has(l.orderId)).map((l) => l.id));
  out.lines = (d.lines ?? []).filter((l) => !skippedLines.has(l.id));
  out.batches = (d.batches ?? []).filter((b) => !skippedLines.has(b.lineId));
  const keptShipments = new Set(out.batches.map((b) => b.shipmentId));
  const shipmentsWithBatches = new Set((d.batches ?? []).map((b) => b.shipmentId));
  out.shipments = (d.shipments ?? []).filter((s) => keptShipments.has(s.id) || !shipmentsWithBatches.has(s.id));
  const keptShipmentIds = new Set(out.shipments.map((s) => s.id));
  out.declarations = (d.declarations ?? []).filter((x) => keptShipmentIds.has(x.shipmentId));
  out.costs = (d.costs ?? []).filter((c) => !(c.targetType === 'order' && skippedOrders.has(c.targetId)));

  const data = Object.fromEntries(WRITE_ORDER.filter((k) => d[k] !== undefined).map((k) => [k, out[k]])) as ImportData;
  return { data, skipped };
}

/** Перечитать таблицу, отбросить уже существующее и записать остальное пачками по сущностям. */
export async function applyImport(plan: ImportPlan, store: Store): Promise<ImportResult> {
  const existing = await store.load();
  const { data, skipped } = mergeWithExisting(plan, existing);
  const inserted: Record<string, number> = {};
  for (const key of WRITE_ORDER) {
    const records = data[key];
    if (!records) continue;
    if (records.length > 0) await store.bulkInsert(key, records as never);
    inserted[key] = records.length;
  }
  return { inserted, skipped };
}

// Чистая логика экранов заказов: поиск, нумерация, ссылки Битрикс, запреты удаления. Форматы — src/ui/format.ts.

import type { CoefSuggestion } from '../../../domain/costing';
import type { Dataset, ISODate, Order, SupplierOrder } from '../../../domain/model';
import { formatNumber } from '../../format';
import { formatOrderCode, orderLabel, ORDER_LETTER, parseOrderCode, yearOf } from '../../../domain/numbering';

// ---------- номера и коды ----------

/** Следующий свободный номер заказа. */
export function nextOrderNumber(orders: Pick<Order, 'number'>[]): number {
  return orders.reduce((m, o) => (Number.isFinite(o.number) ? Math.max(m, o.number) : m), 0) + 1;
}

/** Код поставщика в заказе: «З-2026-041-1», у старого заказа — «15-1». */
export const supplierOrderCode = (order: Pick<Order, 'number' | 'code'>, so: Pick<SupplierOrder, 'seq'>): string => `${orderLabel(order)}-${so.seq}`;

export const ORDER_NUMBER_FORMAT_ERROR = 'Номер заказа — З-ГГГГ-NNN или целое число';

/**
 * Номер из поля «Номер заказа» (G33): `З-ГГГГ-NNN` — код и NNN; целое число — у нового заказа и заказа с кодом NNN номера
 * года даты заказа, у старого заказа без кода — прежний номер без кода. Иначе — текст ошибки.
 */
export function readOrderNumber(text: string, date: ISODate | undefined, legacy: boolean): { number: number; code?: string } | { error: string } {
  const t = text.trim();
  const parsed = parseOrderCode(t);
  if (parsed) return parsed.number > 0 ? { number: parsed.number, code: `${ORDER_LETTER}-${parsed.year}-${parsed.part}` } : { error: ORDER_NUMBER_FORMAT_ERROR };
  if (!/^\d+$/.test(t) || Number(t) <= 0) return { error: t === '' ? 'Введите номер заказа' : ORDER_NUMBER_FORMAT_ERROR };
  const n = Number(t);
  if (legacy) return { number: n };
  const year = yearOf(date);
  return year === undefined ? { error: 'Укажите дату заказа' } : { number: n, code: formatOrderCode(year, n) };
}

// ---------- поиск ----------

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е');

/** Заказы, подходящие под запрос: по номеру (и коду З-ГГГГ-NNN), заказчику, названию и ID задачи Битрикс (заказа или его поставщиков). */
export function filterOrders(ds: Pick<Dataset, 'orders' | 'supplierOrders'>, query: string): Order[] {
  const q = norm(query.replace(/^\s*№\s*/, ''));
  if (q === '') return ds.orders;
  return ds.orders.filter((o) => {
    if (String(o.number).startsWith(q)) return true;
    // по коду: с начала («з-2026») или по части с дефисом («2026-041»)
    const code = norm(o.code);
    if (code !== '' && (code.startsWith(q) || (q.includes('-') && code.includes(q)))) return true;
    if (norm(o.customer).includes(q) || norm(o.title).includes(q)) return true;
    if (norm(o.bitrixTaskId).includes(q)) return true;
    return ds.supplierOrders.some((so) => so.orderId === o.id && norm(so.bitrixTaskId).includes(q));
  });
}

// ---------- Битрикс24 ----------

/** Ссылка на задачу: `<портал>/company/personal/user/0/tasks/task/view/<ID>/`; без адреса портала или ID — null. */
export function bitrixTaskUrl(portal: string | undefined, taskId: string | undefined): string | null {
  const id = (taskId ?? '').trim();
  let base = (portal ?? '').trim().replace(/\/+$/, '');
  if (id === '' || base === '') return null;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  return `${base}/company/personal/user/0/tasks/task/view/${encodeURIComponent(id)}/`;
}

// ---------- даты ----------

/** Дата + N дней (целое), ISO. */
export function addDaysISO(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Плановая готовность = дата запуска + срок изготовления; без одного из двух — undefined. */
export function plannedReadyDate(so: Pick<SupplierOrder, 'launchDate' | 'productionDays'>): ISODate | undefined {
  if (!so.launchDate || typeof so.productionDays !== 'number' || !Number.isFinite(so.productionDays)) return undefined;
  return addDaysISO(so.launchDate, Math.round(so.productionDays));
}


/** Обрезает строки и убирает пустые поля: в лист попадают только заполненные значения. */
export function compact<T extends object>(record: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t !== '') out[k] = t;
    } else if (v !== undefined && v !== null) out[k] = v;
  }
  return out as T;
}

/** Отклонение AW от AD в процентах: (AW / AD − 1)·100; нет данных — null. Меньше нуля — фактическая цена ниже прогноза (лучше). */
export function deviationPct(aw: number | null | undefined, ad: number | null | undefined): number | null {
  if (aw === null || aw === undefined || ad === null || ad === undefined || !Number.isFinite(aw) || !Number.isFinite(ad) || ad <= 0) return null;
  return (aw / ad - 1) * 100;
}

// ---------- подсказка AD ----------

// Формат процента — из общего модуля (реэкспорт для прежних импортов).
export { formatPct } from '../../format';

const pointsWord = (n: number): string => (n % 10 === 1 && n % 100 !== 11 ? 'закрытой позиции' : 'закрытым позициям');

const BASIS_TEXT: Record<CoefSuggestion['basis'], string> = {
  'supplier+mode': 'этого поставщика и типа поставки',
  mode: 'этого типа поставки',
  all: 'всех поставщиков',
  none: '',
};

/** Текст подсказки: «подсказка 1,58 (по 5 закрытым позициям)» или «мало данных для подсказки». */
export function suggestionText(s: CoefSuggestion): string {
  if (s.value === null) return 'мало данных для подсказки';
  return `подсказка ${formatNumber(s.value, 2)} (по ${s.points} ${pointsWord(s.points)})`;
}
export const suggestionBasis = (s: CoefSuggestion): string => (s.value === null ? '' : BASIS_TEXT[s.basis]);

// ---------- отгружено ----------

export function shippedQty(ds: Pick<Dataset, 'batches'>, lineId: string): number {
  return ds.batches.filter((b) => b.lineId === lineId).reduce((s, b) => s + (Number.isFinite(b.qty) ? b.qty : 0), 0);
}

// ---------- запрет удаления ----------

type Usage = Pick<Dataset, 'batches' | 'shipments' | 'costs' | 'lines'>;

function describe(ds: Usage, lineIds: string[], costTargets: Set<string>): string | null {
  const ids = new Set(lineIds);
  const batches = ds.batches.filter((b) => ids.has(b.lineId));
  const parts: string[] = [];
  if (batches.length > 0) {
    const shipments = [...new Set(batches.map((b) => ds.shipments.find((s) => s.id === b.shipmentId)?.number).filter((n): n is string => Boolean(n)))];
    parts.push(shipments.length > 0 ? `партии в поставках ${shipments.join(', ')}` : `партии: ${batches.length}`);
  }
  const costs = ds.costs.filter((c) => costTargets.has(`${c.targetType}:${c.targetId}`));
  if (costs.length > 0) {
    const types = [...new Set(costs.map((c) => c.costType))];
    parts.push(`затраты: ${costs.length} (${types.join(', ')})`);
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

export function lineDeleteBlock(ds: Usage, lineId: string): string | null {
  const d = describe(ds, [lineId], new Set([`line:${lineId}`]));
  return d ? `Нельзя удалить позицию — ${d}` : null;
}

export function supplierOrderDeleteBlock(ds: Usage, soId: string): string | null {
  const lineIds = ds.lines.filter((l) => l.supplierOrderId === soId).map((l) => l.id);
  const targets = new Set([`supplierOrder:${soId}`, ...lineIds.map((id) => `line:${id}`)]);
  const d = describe(ds, lineIds, targets);
  return d ? `Нельзя удалить поставщика из заказа — ${d}` : null;
}

export function orderDeleteBlock(ds: Usage & Pick<Dataset, 'supplierOrders'>, orderId: string): string | null {
  const sos = ds.supplierOrders.filter((so) => so.orderId === orderId);
  if (sos.length > 0) return `Нельзя удалить заказ — сначала удалите поставщиков в заказе (${sos.length})`;
  const costs = ds.costs.filter((c) => c.targetType === 'order' && c.targetId === orderId);
  if (costs.length > 0) return `Нельзя удалить заказ — затраты: ${costs.length} (${[...new Set(costs.map((c) => c.costType))].join(', ')})`;
  return null;
}

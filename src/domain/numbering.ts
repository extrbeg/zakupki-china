// Номера заказов, поставок и затрат (G28, G33). Чистые функции.
//
// Заказ — `З-ГГГГ-NNN`: год — по дате заказа, NNN — следующий после наибольшего номера заказов этого года (включая старые без кода).
//   number заказа = NNN; старые заказы без кода показываются по прежнему номеру.
// Поставка — `П-ГГГГ-NNN`: год — по дате отправки в РФ, иначе по дате создания; NNN — после наибольшего в этом году.
// Затрата — `Р-ГГГГ-<номер заказа>-NNN` (заказ, поставщик в заказе, позиция; год и номер — заказа)
//   и `Р-ГГГГ-П<NNN поставки>-NNN` (поставка, декларация); NNN — порядковый внутри заказа / поставки.
// Пропуски не заполняются: номер удалённой записи не достаётся новой.

import type { Cost, Dataset, ISODate, Order, Shipment } from './model';

export const ORDER_LETTER = 'З';
export const SHIPMENT_LETTER = 'П';
export const COST_LETTER = 'Р';

const pad3 = (n: number) => String(n).padStart(3, '0');
const key = (s: string | undefined) => (s ?? '').trim().toUpperCase();

/** Год ISO-даты; не дата — undefined. */
export function yearOf(date: ISODate | undefined): number | undefined {
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(date ?? '');
  return m ? Number(m[1]) : undefined;
}

// ---------- заказы ----------

export const formatOrderCode = (year: number, number: number): string => `${ORDER_LETTER}-${year}-${pad3(number)}`;

const ORDER_CODE = /^\s*[Зз]-(\d{4})-(\d+)\s*$/;

/** `З-2026-041` → { year: 2026, number: 41, part: '041' }; другой вид — null. */
export function parseOrderCode(code: string | undefined): { year: number; number: number; part: string } | null {
  const m = ORDER_CODE.exec(code ?? '');
  return m ? { year: Number(m[1]), number: Number(m[2]), part: m[2] } : null;
}

/** Год заказа для нумерации: из кода, у старого заказа — по дате. */
export const orderYear = (o: Pick<Order, 'code' | 'date'>): number | undefined => parseOrderCode(o.code)?.year ?? yearOf(o.date);

/** Номер для показа: код, у старого заказа — прежний номер («32»). */
export const orderLabel = (o: Pick<Order, 'number' | 'code'>): string => o.code?.trim() || String(o.number);

/** Ссылка в тексте: «З-2026-041», у старого — «№ 32» («Заказ № 32»). */
export const orderRef = (o: Pick<Order, 'number' | 'code'>): string => o.code?.trim() || `№ ${o.number}`;

/**
 * Номер старого заказа похож на дату-serial (2000–2099; так его помечает импорт, src/import/cells.ts: looksLikeDateSerial) —
 * это ошибка старой таблицы, а не порядковый номер: в «наибольший номер года» он не идёт.
 */
export const looksLikeDateSerialNumber = (n: number): boolean => n >= 36_526 && n < 73_051;

/** Номер нового заказа на дату: после наибольшего номера заказов года; номера-даты старых заказов без кода не в счёт. */
export function nextOrderCode(orders: Pick<Order, 'number' | 'code' | 'date'>[], date: ISODate): { code: string; number: number } {
  const year = yearOf(date) ?? new Date().getFullYear();
  const counts = (o: Pick<Order, 'number' | 'code' | 'date'>) =>
    orderYear(o) === year && Number.isFinite(o.number) && (Boolean(o.code?.trim()) || !looksLikeDateSerialNumber(o.number));
  const max = orders.reduce((m, o) => (counts(o) ? Math.max(m, o.number) : m), 0);
  return { code: formatOrderCode(year, max + 1), number: max + 1 };
}

/** Совпадают ли номера двух заказов: тот же NNN в том же году; два старых заказа без кода — тот же номер. */
export function ordersClash(a: Pick<Order, 'number' | 'code' | 'date'>, b: Pick<Order, 'number' | 'code' | 'date'>): boolean {
  if (a.code?.trim() && b.code?.trim() && key(a.code) === key(b.code)) return true;
  if (a.number !== b.number) return false;
  if (!a.code?.trim() && !b.code?.trim()) return true;
  return orderYear(a) === orderYear(b);
}

/** Порядок заказов: год, затем номер (по возрастанию). */
export function compareOrders(a: Pick<Order, 'number' | 'code' | 'date'>, b: Pick<Order, 'number' | 'code' | 'date'>): number {
  return (orderYear(a) ?? 0) - (orderYear(b) ?? 0) || a.number - b.number;
}

// ---------- поставки ----------

const SHIPMENT_CODE = /^\s*[Пп]-(\d{4})-(\d+)\s*$/;

/** `П-2026-005` → { year: 2026, number: 5, part: '005' }; другой вид — null. */
export function parseShipmentCode(number: string | undefined): { year: number; number: number; part: string } | null {
  const m = SHIPMENT_CODE.exec(number ?? '');
  return m ? { year: Number(m[1]), number: Number(m[2]), part: m[2] } : null;
}

/** Год номера новой поставки: по дате отправки в РФ, иначе по дате создания (сегодня). */
export function shipmentCodeYear(s: Pick<Shipment, 'sentDate'>, today: ISODate): number {
  return yearOf(s.sentDate) ?? yearOf(today) ?? new Date().getFullYear();
}

/** Номер новой поставки в году: после наибольшего `П-ГГГГ-NNN` этого года; номера другого вида не в счёт. */
export function nextShipmentCode(shipments: Pick<Shipment, 'number'>[], year: number): string {
  const max = shipments.reduce((m, s) => {
    const p = parseShipmentCode(s.number);
    return p && p.year === year ? Math.max(m, p.number) : m;
  }, 0);
  return `${SHIPMENT_LETTER}-${year}-${pad3(max + 1)}`;
}

// ---------- затраты ----------

type CostRefs = Pick<Dataset, 'orders' | 'supplierOrders' | 'lines' | 'shipments' | 'declarations'>;
type CostTarget = Pick<Cost, 'targetType' | 'targetId' | 'entryDate' | 'paymentDate'>;

const byId = <T extends { id: string }>(list: T[], id: string | undefined) => (id ? list.find((x) => x.id === id) : undefined);

/** Начало номера затраты по её привязке: `Р-2026-32-`, `Р-2026-П005-`; привязка не найдена — null. */
export function costCodePrefix(ds: CostRefs, c: CostTarget): string | null {
  let orderId: string | undefined;
  let shipmentId: string | undefined;
  switch (c.targetType) {
    case 'order': orderId = c.targetId; break;
    case 'supplierOrder': orderId = byId(ds.supplierOrders, c.targetId)?.orderId; break;
    case 'line': orderId = byId(ds.lines, c.targetId)?.orderId; break;
    case 'shipment': shipmentId = c.targetId; break;
    case 'declaration': shipmentId = byId(ds.declarations, c.targetId)?.shipmentId; break;
  }
  if (orderId !== undefined) {
    const o = byId(ds.orders, orderId);
    if (!o) return null;
    const code = parseOrderCode(o.code);
    const year = code?.year ?? yearOf(o.date) ?? yearOf(c.paymentDate || c.entryDate);
    return year === undefined ? null : `${COST_LETTER}-${year}-${code ? code.part : String(o.number)}-`;
  }
  const s = byId(ds.shipments, shipmentId);
  if (!s) return null;
  const code = parseShipmentCode(s.number);
  const year = code?.year ?? yearOf(s.sentDate || s.consolidationDate || s.arrivalDate) ?? yearOf(c.paymentDate || c.entryDate);
  return year === undefined ? null : `${COST_LETTER}-${year}-${SHIPMENT_LETTER}${code ? code.part : s.number.trim()}-`;
}

/** Наибольший NNN среди номеров с этим началом. */
function maxSeq(codes: (string | undefined)[], prefix: string): number {
  const p = key(prefix);
  return codes.reduce((m, code) => {
    const k = key(code);
    if (!k.startsWith(p)) return m;
    const rest = k.slice(p.length);
    return /^\d+$/.test(rest) ? Math.max(m, Number(rest)) : m;
  }, 0);
}

/** Номер новой затраты по привязке: после наибольшего внутри заказа / поставки; привязка не найдена — null. */
export function nextCostCode(ds: CostRefs & Pick<Dataset, 'costs'>, c: CostTarget): string | null {
  const prefix = costCodePrefix(ds, c);
  return prefix === null ? null : `${prefix}${pad3(maxSeq(ds.costs.map((x) => x.code), prefix) + 1)}`;
}

/**
 * Номера затратам без номера — один раз, по порядку дат (оплаты, у плановых без неё — заполнения), после уже проставленных.
 * Затраты с номером и без найденной привязки не трогаются.
 */
export function planCostCodes(ds: CostRefs & Pick<Dataset, 'costs'>): { id: string; code: string }[] {
  const pending = ds.costs
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.code?.trim())
    .sort((a, b) => {
      const da = a.c.paymentDate || a.c.entryDate || '';
      const db = b.c.paymentDate || b.c.entryDate || '';
      return da < db ? -1 : da > db ? 1 : (a.c.entryDate || '') < (b.c.entryDate || '') ? -1 : (a.c.entryDate || '') > (b.c.entryDate || '') ? 1 : a.i - b.i;
    });
  const used = ds.costs.map((c) => c.code);
  const out: { id: string; code: string }[] = [];
  for (const { c } of pending) {
    const prefix = costCodePrefix(ds, c);
    if (prefix === null) continue;
    const code = `${prefix}${pad3(maxSeq(used, prefix) + 1)}`;
    used.push(code);
    out.push({ id: c.id, code });
  }
  return out;
}

/** Номер затраты уже занят другой затратой (без учёта регистра и пробелов по краям). */
export function costCodeTaken(costs: Pick<Cost, 'id' | 'code'>[], c: Pick<Cost, 'id' | 'code'>): boolean {
  const k = key(c.code);
  return k !== '' && costs.some((x) => x.id !== c.id && key(x.code) === k);
}

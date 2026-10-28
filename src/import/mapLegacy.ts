// Маппинг старой таблицы в сущности приложения (spec «Решения по реализации» → «Маппинг импорта»).
// Чистая функция: на входе значения листов, на выходе записи, проблемы и счётчики. Колонки ищутся по заголовкам.

import { emptyDataset } from '../domain/model';
import { planCostCodes } from '../domain/numbering';
import { TYPE_ID_BY_MODE } from '../domain/shipmentTypes';
import type { Batch, Carrier, City, Cost, Currency, ISODate, Line, ListItem, ListKey, Order, PaymentAgent, Rate, Shipment, Supplier, SupplierOrder } from '../domain/model';
import { sheetFor } from '../store/schema';
import { newId } from '../domain/ids';
import { bool, columnOf, date, findHeaderRow, hasAny, isBlank, looksLikeDateSerial, nameKey, norm, num, ruDate, text } from './cells';
import type { ImportData, ImportPlan, ImportProblem, LegacyRaw } from './types';
import { CHINA_COUNTRY_ID, chinaProvinceOf } from '../data/geo';

type Row = unknown[];

class Ctx {
  problems: ImportProblem[] = [];
  data: ImportData = {};
  origins: Record<string, { sheet: string; row: number }> = {};
  from(id: string, sheet: string, row: number) { this.origins[id] = { sheet, row }; }
  constructor(readonly raw: LegacyRaw, readonly today: ISODate) {}
  problem(sheet: string, row: number, message: string) { this.problems.push({ sheet, row, message }); }
  /** Значения видимого листа; скрытый или отсутствующий — null. */
  sheet(name: string): Row[] | null {
    const s = this.raw.sheets[name];
    return s && !s.hidden ? s.values : null;
  }
}

/** Пропустить пустые поля, чтобы запись не тащила undefined. */
function compact<T extends object>(rec: T): T {
  return Object.fromEntries(Object.entries(rec).filter(([, v]) => v !== undefined && v !== '')) as T;
}

/** Код валюты: RMB/юань → CNY, рубли → RUB. Незнакомое — undefined. */
export function currencyOf(v: unknown): Currency | undefined {
  const s = String(v ?? '').trim().toUpperCase();
  if (!s) return undefined;
  if (s === 'RMB' || s === 'CNY' || s === 'ЮАНЬ' || s === '¥') return 'CNY';
  if (s === 'USD' || s === '$') return 'USD';
  if (s === 'EUR' || s === '€') return 'EUR';
  if (s === 'RUB' || s === 'РУБ' || s === 'Р' || s === '₽' || s === 'RUR') return 'RUB';
  return undefined;
}

// ---------- «Поставщики исходник» и сопоставление по имени ----------

const SUPPLIER_SOURCE = 'Поставщики исходник';
export const NO_SUPPLIER_NAME = 'Поставщик не указан';

class SupplierBook {
  readonly list: Supplier[] = [];
  private byKey = new Map<string, Supplier>();
  constructor(private ctx: Ctx) {}
  add(s: Supplier) {
    this.list.push(s);
    const k = nameKey(s.name);
    if (!this.byKey.has(k)) this.byKey.set(k, s);
  }
  /** id поставщика по имени; нет в справочнике — создаётся (с проблемой один раз на имя). */
  resolve(name: string | undefined, sheet: string, row: number): string {
    const k = nameKey(name);
    const found = this.byKey.get(k);
    if (found) return found.id;
    const s: Supplier = { id: newId('sup'), name: k === '' ? NO_SUPPLIER_NAME : name!.trim().replace(/\s+/g, ' ') };
    this.add(s);
    if (k !== '') this.ctx.problem(sheet, row, `Поставщика «${s.name}» нет в «${SUPPLIER_SOURCE}» — создан по имени`);
    return s.id;
  }
}

function mapSupplierSource(ctx: Ctx, book: SupplierBook) {
  const values = ctx.sheet(SUPPLIER_SOURCE);
  if (!values) return;
  const h = findHeaderRow(values, ['Компания']);
  if (h < 0) {
    ctx.problem(SUPPLIER_SOURCE, 1, 'Не найдена строка заголовков («Компания») — лист не перенесён');
    return;
  }
  const head = values[h];
  const fields: [keyof Supplier, number][] = [
    ['companyType', columnOf(head, 'Тип компании')], ['direction', columnOf(head, 'Направление')], ['specialization', columnOf(head, 'Специализация')],
    ['products', columnOf(head, 'Продукция/услуги', 'Продукция*')], ['priceNote', columnOf(head, 'Цена')], ['contactPerson', columnOf(head, 'Контактное лицо')],
    ['phone', columnOf(head, 'Телефон')], ['email', columnOf(head, 'Почта', 'email')], ['city', columnOf(head, 'Город')],
    ['province', columnOf(head, 'Провинция')], ['address', columnOf(head, 'Адрес')], ['website', columnOf(head, 'Ссылки/сайт', 'Сайт')],
    ['comment', columnOf(head, 'Комментарий')],
  ];
  const nameCol = columnOf(head, 'Компания');
  for (let i = h + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const name = text(row[nameCol]);
    if (!name) {
      if (hasAny(row, fields.map(([, c]) => c))) ctx.problem(SUPPLIER_SOURCE, i + 1, 'Нет названия компании — строка пропущена');
      continue;
    }
    const rec: Record<string, unknown> = { id: newId('sup'), name };
    for (const [key, c] of fields) if (c >= 0) rec[key] = text(row[c]);
    ctx.from(rec.id as string, SUPPLIER_SOURCE, i + 1);
    book.add(compact(rec as unknown as Supplier));
  }
}

// ---------- «Заказы» ----------

const ORDERS = 'Заказы';

interface SourceRow { row: Row; n: number }
interface OrderGroup { order: Order; rows: SourceRow[] }
export type OrderCols = Record<string, number>;

function firstOf<T>(rows: SourceRow[], pick: (row: Row) => T | undefined): T | undefined {
  for (const { row } of rows) { const v = pick(row); if (v !== undefined) return v; }
  return undefined;
}

function mapOrders(ctx: Ctx, book: SupplierBook) {
  const values = ctx.sheet(ORDERS);
  if (!values) return;
  const h = findHeaderRow(values, ['Заказ', 'Поставщик']);
  if (h < 0) {
    ctx.problem(ORDERS, 1, 'Не найдена строка заголовков («Заказ», «Поставщик») — лист не перенесён');
    return;
  }
  const head = values[h];
  const col = {
    number: columnOf(head, 'Заказ'), date: columnOf(head, 'Дата заказа'), department: columnOf(head, 'Целевое подразделение', 'Подразделение'),
    payer: columnOf(head, 'Плательщик'), customer: columnOf(head, 'Заказчик'),
    customerName: columnOf(head, 'Название изделия от заказчика', 'Название от заказчика'), techParams: columnOf(head, 'Технические параметры*', 'Тех. параметры'),
    docName: columnOf(head, 'Название в документах'), supplierName: columnOf(head, 'Product name from supplier'),
    supplier: columnOf(head, 'Поставщик'), qty: columnOf(head, 'QTY', 'Кол-во'), price: columnOf(head, 'Цена за шт*', 'Цена'),
    calcDate: columnOf(head, 'Дата расчета', 'Дата расчёта'),
    supplierSeq: columnOf(head, 'Номер поставщика в заказе'), purchased: columnOf(head, 'Закупка'), lineSeq: columnOf(head, 'Номер позиции в заказе', 'Номер позиции'),
    currency: columnOf(head, 'Валюта поставщика', 'Валюта'), calcRate: columnOf(head, 'Курс валюты*', 'Курс'),
    coef: columnOf(head, 'Коэффициент стоимости доставки для расчета', 'Коэффициент'), paymentTerms: columnOf(head, 'Тип расчета', 'Тип расчёта'),
    hsCode: columnOf(head, 'HS Code'), launchDate: columnOf(head, 'Дата запуска*'), productionDays: columnOf(head, 'Срок изготовления*'),
    actualReadyDate: columnOf(head, 'Фактическая дата готовности'), consolidationDate: columnOf(head, 'Дата отправки на склад консолидации'),
    sentDate: columnOf(head, 'Дата отправки в РФ'), packaging: columnOf(head, 'Упаковка'), packageSize: columnOf(head, 'Размер 1 упаковки', 'Размер*'),
    cbm: columnOf(head, 'CBM'), places: columnOf(head, 'Количество мест', 'Мест'), weight: columnOf(head, 'Вес*'),
    arrivalDate: columnOf(head, 'Дата прибытия на СВХ'),
  };
  // Строка с содержанием — есть хоть что-то из введённого руками (формулы итогов не в счёт).
  const contentCols = [col.customerName, col.techParams, col.docName, col.supplierName, col.supplier, col.qty, col.price];

  const groups = new Map<number, OrderGroup>();
  for (let i = h + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const n = i + 1;
    const a = row[col.number];
    if (isBlank(a)) {
      if (hasAny(row, contentCols)) ctx.problem(ORDERS, n, 'Нет номера заказа — строка пропущена');
      continue;
    }
    const number = num(a);
    if (number === undefined || !Number.isInteger(number) || number <= 0) {
      ctx.problem(ORDERS, n, `Номер заказа «${String(a)}» — не целое число, строка пропущена`);
      continue;
    }
    let g = groups.get(number);
    if (!g) {
      g = { order: { id: newId('ord'), number, date: '', costsComplete: false }, rows: [] };
      groups.set(number, g);
      ctx.from(g.order.id, ORDERS, n);
      if (looksLikeDateSerial(number)) {
        ctx.problem(ORDERS, n, `Номер заказа — дата ${ruDate(date(number)!)} (в ячейке число ${number}); заказ перенесён под номером ${number} — исправьте номер в карточке заказа`);
      }
    }
    g.rows.push({ row, n });
  }

  const orders: Order[] = [];
  const supplierOrders: SupplierOrder[] = [];
  const lines: Line[] = [];
  const shipments: Shipment[] = [];
  const batches: Batch[] = [];
  for (const g of groups.values()) {
    const first = <T>(pick: (row: Row) => T | undefined) => firstOf(g.rows, pick);
    const o = g.order;
    orders.push(o);
    const department = first((r) => text(r[col.department]));
    const payer = first((r) => text(r[col.payer]));
    const customer = first((r) => text(r[col.customer]));
    if (department) o.department = department;
    if (payer) o.payer = payer;
    if (customer) o.customer = customer;
    const orderDate = first((r) => date(r[col.date]));
    if (orderDate) o.date = orderDate;
    else {
      const fallback = (looksLikeDateSerial(o.number) ? date(o.number) : undefined) ?? first((r) => date(r[col.calcDate])) ?? ctx.today;
      o.date = fallback;
      ctx.problem(ORDERS, g.rows[0].n, `Заказ № ${o.number}: нет даты заказа — поставлена ${ruDate(fallback)}`);
    }
    const subs = mapSupplierOrders(ctx, book, o, g.rows, col);
    for (const sub of subs) {
      supplierOrders.push(sub.so);
      lines.push(...sub.lines);
      const shipped = mapShipment(o, sub, col);
      if (shipped) { shipments.push(shipped.shipment); batches.push(...shipped.batches); }
    }
  }
  ctx.data.orders = orders;
  ctx.data.supplierOrders = supplierOrders;
  ctx.data.lines = lines;
  ctx.data.shipments = shipments;
  ctx.data.batches = batches;
}

/** НДС поставки по умолчанию (как «Настройки» → vatRateDefault новой таблицы). */
const DEFAULT_VAT_RATE = 22;

/** Поставка подзаказа — только если в его строках есть даты отправки/прибытия; партии — позиции этих строк. */
function mapShipment(order: Order, sub: SubOrder, col: OrderCols): { shipment: Shipment; batches: Batch[] } | null {
  const dateCols = [col.consolidationDate, col.sentDate, col.arrivalDate];
  const shippedRows = sub.rows.filter((r) => dateCols.some((c) => c >= 0 && date(r.row[c]) !== undefined));
  if (shippedRows.length === 0) return null;
  const first = (c: number) => firstOf(shippedRows, (r) => date(r[c]));
  const shipment: Shipment = compact({
    id: newId('shp'), number: `${order.number}-${sub.so.seq}`, mode: 'other' as const, typeId: TYPE_ID_BY_MODE.other,
    consolidationDate: first(col.consolidationDate), sentDate: first(col.sentDate), arrivalDate: first(col.arrivalDate),
    vatRate: DEFAULT_VAT_RATE,
  });
  const batches: Batch[] = [];
  sub.lineRows.forEach((r, i) => {
    const line = sub.lines[i];
    if (!shippedRows.includes(r) || !line.purchased || !(line.qty > 0)) return;
    batches.push(compact({ id: newId('bat'), shipmentId: shipment.id, lineId: line.id, qty: line.qty, cbm: line.cbm, weight: line.weight, places: line.places }));
  });
  return { shipment, batches };
}

interface SubOrder { so: SupplierOrder; rows: SourceRow[]; lines: Line[]; lineRows: SourceRow[] }

/** Поставщики заказа (группировка по имени R без регистра и пробелов) и их позиции. */
function mapSupplierOrders(ctx: Ctx, book: SupplierBook, order: Order, rows: SourceRow[], col: OrderCols): SubOrder[] {
  const byKey = new Map<string, SourceRow[]>();
  for (const r of rows) {
    const k = nameKey(r.row[col.supplier]);
    const list = byKey.get(k) ?? [];
    list.push(r);
    byKey.set(k, list);
  }
  const subs: SubOrder[] = [];
  const usedSeq = new Set<number>();
  const pending: SubOrder[] = [];
  for (const [k, srows] of byKey) {
    const first = <T>(pick: (row: Row) => T | undefined) => firstOf(srows, pick);
    const name = first((r) => text(r[col.supplier]));
    const supplierId = book.resolve(name, ORDERS, srows[0].n);
    if (k === '') ctx.problem(ORDERS, srows[0].n, `Заказ № ${order.number}: поставщик не указан — позиции перенесены под поставщиком «${NO_SUPPLIER_NAME}»`);

    const currencies = new Set(srows.map((r) => currencyOf(r.row[col.currency])).filter((c): c is Currency => c !== undefined));
    let currency = first((r) => currencyOf(r[col.currency]));
    if (!currency) {
      currency = 'CNY';
      const raw = first((r) => text(r[col.currency]));
      ctx.problem(ORDERS, srows[0].n, raw
        ? `Заказ № ${order.number}: валюта «${raw}» не распознана — поставлен юань (RMB)`
        : `Заказ № ${order.number}, поставщик «${name ?? NO_SUPPLIER_NAME}»: валюта не указана — поставлен юань (RMB)`);
    } else if (currencies.size > 1) {
      ctx.problem(ORDERS, srows[0].n, `Заказ № ${order.number}, поставщик «${name}»: в строках разные валюты — взята ${currency}`);
    }
    const rates = new Set(srows.map((r) => num(r.row[col.calcRate])).filter((v): v is number => v !== undefined && v > 0));
    const calcRate = first((r) => { const v = num(r[col.calcRate]); return v !== undefined && v > 0 ? v : undefined; });
    if (rates.size > 1) ctx.problem(ORDERS, srows[0].n, `Заказ № ${order.number}, поставщик «${name}»: в строках разные курсы расчёта — взят ${calcRate}`);

    const seqRaw = first((r) => { const v = num(r[col.supplierSeq]); return v !== undefined && Number.isInteger(v) && v > 0 ? v : undefined; });
    const so: SupplierOrder = compact({
      id: newId('so'), orderId: order.id, seq: 0, supplierId, currency,
      calcDate: first((r) => date(r[col.calcDate])), calcRate,
      paymentTerms: first((r) => text(r[col.paymentTerms])), launchDate: first((r) => date(r[col.launchDate])),
      productionDays: first((r) => { const v = num(r[col.productionDays]); return v !== undefined ? Math.round(v) : undefined; }),
      actualReadyDate: first((r) => date(r[col.actualReadyDate])),
    });
    const sub: SubOrder = { so, rows: srows, lines: [], lineRows: [] };
    ctx.from(so.id, ORDERS, srows[0].n);
    if (seqRaw !== undefined && !usedSeq.has(seqRaw)) { so.seq = seqRaw; usedSeq.add(seqRaw); } else pending.push(sub);
    subs.push(sub);
    mapLines(ctx, sub, order, col);
    liftCoef(sub);
  }
  let next = 1;
  for (const sub of pending) {
    while (usedSeq.has(next)) next++;
    sub.so.seq = next;
    usedSeq.add(next);
  }
  return subs;
}

/**
 * AD поставщика в заказе (G05.1): самый частый AD его позиций (при равенстве — встреченный первым).
 * Позиции с этим AD своего не хранят — берут AD поставщика; позиции с другим AD сохраняют свой.
 */
function liftCoef(sub: SubOrder) {
  const counts = new Map<number, number>();
  for (const l of sub.lines) if (l.coef !== undefined) counts.set(l.coef, (counts.get(l.coef) ?? 0) + 1);
  let best: number | undefined;
  for (const [coef, n] of counts) if (best === undefined || n > counts.get(best)!) best = coef;
  if (best === undefined) return;
  sub.so.coef = best;
  for (const l of sub.lines) if (l.coef === best) delete l.coef;
}

function mapLines(ctx: Ctx, sub: SubOrder, order: Order, col: OrderCols) {
  const used = new Set<number>();
  const pending: Line[] = [];
  for (const r of sub.rows) {
    const row = r.row;
    const seq = num(row[col.lineSeq]);
    const intNum = (c: number) => { const v = num(row[c]); return v !== undefined ? Math.round(v) : undefined; };
    const line: Line = compact({
      id: newId('ln'), orderId: order.id, supplierOrderId: sub.so.id, seq: 0,
      customerName: text(row[col.customerName]), techParams: text(row[col.techParams]), docName: text(row[col.docName]),
      supplierName: text(row[col.supplierName]), qty: num(row[col.qty]) ?? 0, unitPrice: num(row[col.price]) ?? 0,
      purchased: col.purchased >= 0 && bool(row[col.purchased]), hsCode: text(row[col.hsCode]), packaging: text(row[col.packaging]),
      packageSize: text(row[col.packageSize]), cbm: num(row[col.cbm]), weight: num(row[col.weight]), places: intNum(col.places),
      coef: num(row[col.coef]),
    });
    if (seq !== undefined && Number.isInteger(seq) && seq > 0 && !used.has(seq)) { line.seq = seq; used.add(seq); } else pending.push(line);
    sub.lines.push(line);
    sub.lineRows.push(r);
    ctx.from(line.id, ORDERS, r.n);
  }
  let next = 1;
  for (const line of pending) {
    while (used.has(next)) next++;
    line.seq = next;
    used.add(next);
  }
}

// ---------- «Затраты по заказам» ----------

const COSTS = 'Затраты по заказам';

/** Старые затраты — к заказу целиком (точнее в старых данных нет). Нет даты операции — плановая. */
function mapCosts(ctx: Ctx) {
  const values = ctx.sheet(COSTS);
  if (!values) return;
  const h = findHeaderRow(values, ['Номер заказа']);
  if (h < 0) {
    ctx.problem(COSTS, 1, 'Не найдена строка заголовков («Номер заказа») — лист не перенесён');
    return;
  }
  const head = values[h];
  const col = {
    entryDate: columnOf(head, 'Дата заполнения'), paymentDate: columnOf(head, 'Дата операции', 'Дата оплаты'), order: columnOf(head, 'Номер заказа'),
    invoiceNumber: columnOf(head, 'Номер счета', 'Номер счёта'), invoiceDate: columnOf(head, 'Дата счета', 'Дата счёта'), payee: columnOf(head, 'Кому платим'),
    executor: columnOf(head, 'Испольнитель операции', 'Исполнитель операции', 'Исполнитель*'), costType: columnOf(head, 'Тип затрат'),
    comment: columnOf(head, 'Комментарий'), amount: columnOf(head, 'Сумма в валюте'), currency: columnOf(head, 'Валюта'),
    rate: columnOf(head, 'Курс*'), amountRub: columnOf(head, 'Сумма в р*'),
  };
  const orderByNumber = new Map((ctx.data.orders ?? []).map((o) => [o.number, o]));
  const contentCols = [col.paymentDate, col.order, col.payee, col.costType, col.amount, col.amountRub];
  const costs: Cost[] = [];
  for (let i = h + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    const n = i + 1;
    if (!hasAny(row, contentCols)) continue;
    const ref = row[col.order];
    if (isBlank(ref)) { ctx.problem(COSTS, n, 'Нет номера заказа — затрата пропущена'); continue; }
    const number = num(ref);
    const order = number !== undefined ? orderByNumber.get(number) : undefined;
    if (!order) {
      const shown = number !== undefined && looksLikeDateSerial(number) ? `${number} (${ruDate(date(number)!)})` : String(ref);
      ctx.problem(COSTS, n, `Заказ № ${shown} не найден в «${ORDERS}» — затрата пропущена`);
      continue;
    }
    const paymentDate = date(row[col.paymentDate]);
    const amountCell = num(row[col.amount]);
    const rubCell = num(row[col.amountRub]);
    const rateCell = num(row[col.rate]);
    const rate = rateCell !== undefined && rateCell > 0 ? rateCell : undefined;
    let currency = currencyOf(row[col.currency]);
    const rawCurrency = text(row[col.currency]);
    if (!currency && rawCurrency) ctx.problem(COSTS, n, `Валюта «${rawCurrency}» не распознана — сумма перенесена в рублях`);
    let amount: number | undefined;
    let lostAmountNote: string | undefined;
    if (currency && currency !== 'RUB') {
      amount = amountCell ?? (rubCell !== undefined && rate ? rubCell / rate : undefined);
    } else {
      currency = 'RUB';
      amount = rubCell ?? amountCell;
      // K при пустой (или рублёвой) валюте и заполненной N не попадает в сумму — сохраняется в комментарии.
      if (amountCell !== undefined && rubCell !== undefined && amountCell !== rubCell) {
        const what = rawCurrency ? `валюта «${rawCurrency}»` : 'валюта не указана';
        lostAmountNote = `Сумма в валюте (${what}): ${amountCell}`;
        ctx.problem(COSTS, n, `Заказ № ${order.number}: сумма в валюте ${amountCell}, но ${what} — перенесена сумма в рублях ${rubCell}, сумма в валюте записана в комментарий`);
      } else if (amountCell !== undefined && rubCell === undefined && !rawCurrency) {
        // K без валюты и без рублей — не выдаём её за рубли: сумма пустая, K — в комментарии.
        amount = undefined;
        lostAmountNote = `Сумма в валюте (валюта не указана): ${amountCell}`;
        ctx.problem(COSTS, n, `Заказ № ${order.number}: сумма в валюте ${amountCell}, но валюта не указана и нет суммы в рублях — затрата перенесена без суммы, сумма в валюте записана в комментарий`);
      }
    }
    const comment = [text(row[col.comment]), lostAmountNote].filter(Boolean).join('; ') || undefined;
    const foreign = currency !== 'RUB';
    if (amount === undefined && rubCell === undefined && !lostAmountNote) ctx.problem(COSTS, n, `Заказ № ${order.number}: нет суммы — затрата перенесена без суммы`);
    const payeeText = text(row[col.payee]);
    const costId = newId('cst');
    ctx.from(costId, COSTS, n);
    costs.push(compact({
      id: costId, entryDate: date(row[col.entryDate]) ?? paymentDate ?? ctx.today, paymentDate,
      status: paymentDate ? 'fact' as const : 'plan' as const, targetType: 'order' as const, targetId: order.id,
      costType: text(row[col.costType]) ?? 'Прочее', payeeType: payeeText ? 'text' as const : undefined, payeeText,
      executor: text(row[col.executor]), invoiceNumber: text(row[col.invoiceNumber]), invoiceDate: date(row[col.invoiceDate]),
      amount, currency, rate: foreign ? rate : undefined, rateManual: foreign && rate !== undefined,
      amountRub: rubCell ?? (currency === 'RUB' ? amount : undefined), comment,
    }));
  }
  // G33: номера затрат по порядку дат внутри заказа (заказы старой таблицы — без кода, номер заказа — прежний)
  const codes = new Map(planCostCodes({ ...emptyDataset(), orders: ctx.data.orders ?? [], costs }).map((c) => [c.id, c.code]));
  ctx.data.costs = costs.map((c) => (codes.has(c.id) ? { ...c, code: codes.get(c.id) } : c));
}

// ---------- «Списки»: списки, города, курсы ----------

const LISTS = 'Списки';
const LIST_COLUMNS: [header: string, list: ListKey][] = [
  ['Тип компании', 'companyType'], ['Направление', 'direction'], ['Специализация', 'specialization'], ['Плательщик', 'payer'],
  ['Целевое подразделение', 'department'], ['Тип расчета', 'paymentTerms'], ['Затраты', 'costType'], ['Заказчики', 'customer'],
];

function mapLists(ctx: Ctx) {
  const values = ctx.sheet(LISTS);
  if (!values) return;
  const h = findHeaderRow(values, ['Тип компании']);
  if (h < 0) {
    ctx.problem(LISTS, 1, 'Не найдена строка заголовков («Тип компании») — лист не перенесён');
    return;
  }
  const head = values[h];
  const body = values.slice(h + 1);

  const lists: ListItem[] = [];
  for (const [header, list] of LIST_COLUMNS) {
    const c = columnOf(head, header);
    if (c < 0) continue;
    const seen = new Set<string>();
    for (const row of body) {
      const value = text(row?.[c]);
      if (!value || seen.has(norm(value))) continue;
      seen.add(norm(value));
      lists.push({ id: newId('lst'), list, value, order: seen.size });
    }
  }
  const logist = columnOf(head, 'Тип логиста');
  if (logist >= 0 && body.some((r) => !isBlank(r?.[logist]))) {
    ctx.problem(LISTS, h + 1, 'Список «Тип логиста» не переносится — в приложении тип перевозчика вводится текстом');
  }
  ctx.data.lists = lists;

  // Города: «Город» + «Провинция города» (L/M) и «Город» + «Население…» (T/U) — пары соседних колонок.
  const provCol = columnOf(head, 'Провинция города');
  const popCol = columnOf(head, 'Население*');
  const cities = new Map<string, City>();
  const cityOf = (name: string) => {
    const k = norm(name);
    let city = cities.get(k);
    if (!city) { city = { id: newId('city'), city: name, province: '' }; cities.set(k, city); }
    return city;
  };
  for (const row of body) {
    if (provCol > 0) {
      const name = text(row?.[provCol - 1]);
      const province = text(row?.[provCol]);
      if (name) { const c = cityOf(name); if (!c.province && province) c.province = province; }
    }
    if (popCol > 0) {
      const name = text(row?.[popCol - 1]);
      const pop = num(row?.[popCol]);
      if (name) { const c = cityOf(name); if (c.population === undefined && pop !== undefined) c.population = Math.round(pop); }
    }
  }
  // G20: город без провинции получает её из справочника Китая (если город там однозначен); страна — Китай.
  ctx.data.cities = [...cities.values()].map((c) => ({ ...c, province: c.province || chinaProvinceOf(c.city) || '', countryId: CHINA_COUNTRY_ID }));

  // Курсы ВТБ: «Дата», «Валюта», «Курс ВТБ» — переносятся как ручные.
  const rateCol = columnOf(head, 'Курс ВТБ', 'Курс');
  const dateCol = columnOf(head, 'Дата');
  const curCol = columnOf(head, 'Валюта');
  const rates: Rate[] = [];
  if (rateCol >= 0 && dateCol >= 0 && curCol >= 0) {
    const seen = new Set<string>();
    body.forEach((row, i) => {
      if (!hasAny(row ?? [], [dateCol, curCol, rateCol])) return;
      const n = h + 2 + i;
      const d = date(row[dateCol]);
      const cur = currencyOf(row[curCol]);
      const rate = num(row[rateCol]);
      if (!d || !cur || cur === 'RUB' || rate === undefined || !(rate > 0)) {
        ctx.problem(LISTS, n, 'Курс без даты, валюты или значения — пропущен');
        return;
      }
      const key = `${d}|${cur}`;
      if (seen.has(key)) { ctx.problem(LISTS, n, `Курс ${cur} на ${ruDate(d)} повторяется — взят первый`); return; }
      seen.add(key);
      rates.push({ id: newId('r'), date: d, currency: cur, rate, source: 'manual', comment: 'Перенесён из старой таблицы' });
    });
  }
  ctx.data.rates = rates;
}

// ---------- «Платежные агенты», «Перевозчики» — колонки называются как в приложении ----------

function mapByHeaders<T extends { id: string; name: string }>(ctx: Ctx, sheet: string, entity: 'agents' | 'carriers', prefix: string): T[] {
  const values = ctx.sheet(sheet);
  if (!values) return [];
  const def = sheetFor(entity);
  const nameDef = def.columns.find((c) => c.key === 'name')!;
  // в старой таблице колонки называются по-прежнему — ищем и по нынешнему названию, и по прежним (aliases)
  const h = [nameDef.header, ...(nameDef.aliases ?? [])].map((name) => findHeaderRow(values, [name])).find((i) => i >= 0) ?? -1;
  if (h < 0) {
    ctx.problem(sheet, 1, `Не найдена строка заголовков («${nameDef.header}») — лист не перенесён`);
    return [];
  }
  const cols = def.columns.filter((c) => c.key !== 'id').map((c) => ({ def: c, i: columnOf(values[h], c.header, ...(c.aliases ?? [])) })).filter((c) => c.i >= 0);
  const out: T[] = [];
  for (let r = h + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const rec: Record<string, unknown> = { id: newId(prefix) };
    for (const { def: c, i } of cols) {
      const v = row[i];
      rec[c.key] = c.type === 'date' ? date(v) : c.type === 'bool' ? (isBlank(v) ? undefined : bool(v)) : text(v);
    }
    if (!rec.name) {
      if (hasAny(row, cols.map((c) => c.i))) ctx.problem(sheet, r + 1, 'Нет наименования — строка пропущена');
      continue;
    }
    out.push(compact(rec as T));
  }
  return out;
}

// ---------- сборка ----------

export function mapLegacy(raw: LegacyRaw, today: ISODate): ImportPlan {
  const ctx = new Ctx(raw, today);
  const book = new SupplierBook(ctx);
  mapSupplierSource(ctx, book);
  mapOrders(ctx, book);
  ctx.data.suppliers = book.list;
  mapCosts(ctx);
  mapLists(ctx);
  ctx.data.agents = mapByHeaders<PaymentAgent>(ctx, 'Платежные агенты', 'agents', 'agt');
  ctx.data.carriers = mapByHeaders<Carrier>(ctx, 'Перевозчики', 'carriers', 'car');
  // Порядок ключей data — порядок записи (сначала справочники, потом ссылающиеся на них записи).
  const order: (keyof ImportData)[] = ['lists', 'cities', 'rates', 'suppliers', 'agents', 'carriers', 'orders', 'supplierOrders', 'lines', 'shipments', 'batches', 'declarations', 'costs'];
  ctx.data = Object.fromEntries(order.filter((k) => ctx.data[k] !== undefined).map((k) => [k, ctx.data[k]])) as ImportData;

  const stats: Record<string, number> = {};
  for (const [k, v] of Object.entries(ctx.data)) stats[k] = (v as unknown[]).length;
  return { data: ctx.data, problems: ctx.problems, stats, origins: ctx.origins };
}

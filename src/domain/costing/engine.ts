// Движок себестоимости (spec «Решения по реализации» → «Движок себестоимости»).
//
// 1. Затраты переводятся в рубли: факт — по зафиксированному курсу, план — по курсу даты расчёта.
// 2. Каждая затрата распределяется по партиям; неотгруженный остаток позиции — виртуальная партия `rest:<lineId>`.
// 3. Правила распределения — по привязке затраты (таблица спецификации):
//    поставщик в заказе — стоимость позиций в валюте; заказ — стоимость позиций в ₽ по курсу расчёта;
//    поставка — CBM (доставка поставки, чей тип делит доставку по объёму; без типа — контейнер море/авто, G29;
//    партии без CBM — доля по весу, G01) → вес → стоимость; декларация — тамож. стоимость (× % пошлины; + пошлина для НДС);
//    позиция — целиком на неё. Внутри позиции доля делится между её партиями по количеству.
//    Доля каждой затраты в каждой партии — `allocations` (по ним — доли затрат по заказам, src/domain/costShares.ts).
// 4. Себестоимость партии = сумма долей; позиции — сумма партий; AV = итог / кол-во, AW = AV / Y.
//    AD и AB позиции — по действующему AD: свой AD позиции, иначе AD поставщика в заказе (effectiveCoef).
// Расчёт всегда по всему набору данных: выбор заказов на экране — только фильтр показа.
// Внутри расчёта ничего не округляется.

import type { Batch, Cost, Currency, Dataset, ISODate, Line, Order, Shipment, SupplierOrder } from '../model';
import { calcRateFor, effectiveCoef, lineFigures, type LineFigures } from '../lineFigures';
import { pickRate, type RatePick } from '../rates';
import { ruDate } from '../format';
import { orderRef } from '../numbering';
import { deliveryBasis } from '../shipmentTypes';
import { costCategory } from './costTypes';
import {
  COST_CATEGORIES, type BatchCost, type CostCategory, type CostRub, type CostWarning, type CostingResult,
  type CustomsForecast, type LineCost, type OrderTotals,
} from './types';

const DEFAULT_VAT_RATE = 22;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => num(v) && v > 0;
const zeroBreakdown = (): Record<CostCategory, number> =>
  Object.fromEntries(COST_CATEGORIES.map((c) => [c, 0])) as Record<CostCategory, number>;

const CURRENCY_LABEL: Record<Currency, string> = { RUB: '₽', CNY: 'юань (RMB)', USD: 'USD', EUR: 'EUR' };

// ---------- внутренние структуры ----------

interface LineCtx {
  line: Line;
  order: Order | undefined;
  so: SupplierOrder | undefined;
  figures: LineFigures;
  accs: Acc[];            // все партии позиции, включая виртуальную
}

interface Acc {
  out: BatchCost;
  lc: LineCtx;
  batch: Batch | null;    // null — виртуальная партия остатка
  cbm: number | undefined;
  weight: number | undefined;
  customsValue: number | null;   // ₽: кол-во × цена × курс расчёта
  declDuty: number;              // пошлина, разнесённая на партию затратами её декларации (для базы НДС)
  plan: number;
  fact: number;
}

type Status = 'plan' | 'fact';

class Collector {
  warnings: CostWarning[] = [];
  private seen = new Set<string>();
  add(w: CostWarning) {
    const key = `${w.code}|${w.refs.map((r) => `${r.type}:${r.id}`).join(',')}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.warnings.push(w);
  }
}

/** Доли затрат по партиям (G31): `costId` → `batchId` → ₽. Заполняется в `book`, наружу — `CostingResult.allocations`. */
type AllocMap = Map<string, Map<string, number>>;

function book(acc: Acc, category: CostCategory, rub: number, status: Status, alloc: AllocMap, costId: string) {
  acc.out.breakdown[category] += rub;
  acc.out.total += rub;
  if (status === 'plan') acc.plan += rub; else acc.fact += rub;
  let byBatch = alloc.get(costId);
  if (!byBatch) { byBatch = new Map(); alloc.set(costId, byBatch); }
  byBatch.set(acc.out.batchId, (byBatch.get(acc.out.batchId) ?? 0) + rub);
}

/** Делит сумму пропорционально весам. false — база пустая (сумма весов не положительна). */
function spread<T>(items: { item: T; w: number }[], rub: number, put: (item: T, part: number) => void): boolean {
  const total = items.reduce((s, x) => s + (pos(x.w) ? x.w : 0), 0);
  if (!(total > 0)) return false;
  for (const x of items) if (pos(x.w)) put(x.item, (rub * x.w) / total);
  return true;
}

/** Доля позиции — по её партиям пропорционально количеству. */
function spreadInLine(lc: LineCtx, rub: number, put: (a: Acc, part: number) => void): boolean {
  return spread(lc.accs.map((a) => ({ item: a, w: a.out.qty })), rub, put);
}

// ---------- расчёт ----------

export function computeCosting(ds: Dataset, today: ISODate): CostingResult {
  const warn = new Collector();
  const alloc: AllocMap = new Map();
  const orders = new Map(ds.orders.map((o) => [o.id, o]));
  const sos = new Map(ds.supplierOrders.map((s) => [s.id, s]));
  const shipments = new Map(ds.shipments.map((s) => [s.id, s]));
  const declarations = new Map(ds.declarations.map((d) => [d.id, d]));

  // Курс расчёта поставщика в заказе (W).
  const soRate = new Map<string, RatePick | null>();
  const rateOfSo = (so: SupplierOrder): RatePick | null => {
    if (!soRate.has(so.id)) {
      const order = orders.get(so.orderId);
      soRate.set(so.id, order ? calcRateFor(ds, order, so, today) : null);
    }
    return soRate.get(so.id) ?? null;
  };

  // ----- позиции и партии (только «Закупка») -----
  const lineCtx = new Map<string, LineCtx>();
  const allAccs: Acc[] = [];
  const batchesByLine = new Map<string, Batch[]>();
  for (const b of ds.batches) {
    const list = batchesByLine.get(b.lineId) ?? [];
    list.push(b);
    batchesByLine.set(b.lineId, list);
  }

  const noRateSo = new Set<string>();
  for (const line of ds.lines) {
    if (!line.purchased) continue;
    const so = sos.get(line.supplierOrderId);
    const order = orders.get(line.orderId);
    const rate = so ? rateOfSo(so) : null;
    if (so && !rate && !noRateSo.has(so.id)) {
      noRateSo.add(so.id);
      const o = orders.get(so.orderId);
      warn.add({
        code: 'NO_RATE',
        message: `Заказ ${o ? orderRef(o) : '№ ?'}, поставщик ${so.seq}: нет курса ${CURRENCY_LABEL[so.currency]} на дату расчёта — цена в ₽, прогноз цены в РФ и таможенная стоимость не посчитаны`,
        refs: [{ type: 'supplierOrder', id: so.id }],
      });
    }
    const figures = lineFigures(line, rate, so);
    const lc: LineCtx = { line, order, so, figures, accs: [] };
    lineCtx.set(line.id, lc);

    const lineQty = num(line.qty) ? line.qty : 0;
    const price = num(line.unitPrice) ? line.unitPrice : 0;
    const makeAcc = (batch: Batch | null, qty: number): Acc => {
      const share = lineQty > 0 ? qty / lineQty : 0;
      const cbm = batch && pos(batch.cbm) ? batch.cbm : pos(line.cbm) && share > 0 ? line.cbm * share : undefined;
      const weight = batch && pos(batch.weight) ? batch.weight : pos(line.weight) && share > 0 ? line.weight * share : undefined;
      const acc: Acc = {
        out: {
          batchId: batch ? batch.id : `rest:${line.id}`, virtual: !batch, lineId: line.id,
          shipmentId: batch ? batch.shipmentId : null, qty, breakdown: zeroBreakdown(), total: 0, unitCost: 0,
        },
        lc, batch, cbm, weight,
        customsValue: rate ? qty * price * rate.rate : null,
        declDuty: 0, plan: 0, fact: 0,
      };
      lc.accs.push(acc);
      allAccs.push(acc);
      return acc;
    };

    let shipped = 0;
    for (const b of batchesByLine.get(line.id) ?? []) {
      const q = num(b.qty) ? b.qty : 0;
      shipped += q;
      makeAcc(b, q);
    }
    if (shipped > lineQty) {
      warn.add({
        code: 'BATCH_OVER_QTY',
        message: `Позиция ${line.seq} заказа ${order ? orderRef(order) : '№ ?'}: в партиях ${shipped} из ${lineQty} шт`,
        refs: [{ type: 'line', id: line.id }],
      });
    } else if (lineQty - shipped > 0) {
      makeAcc(null, lineQty - shipped);
    }
  }

  const realAccs = allAccs.filter((a) => a.batch);
  const accsOfShipment = (id: string) => realAccs.filter((a) => a.batch!.shipmentId === id);
  const accsOfDeclaration = (id: string) => realAccs.filter((a) => a.batch!.declarationId === id);

  // ----- затраты в рублях -----
  const planRateDate = (c: Cost): { date: ISODate; so?: SupplierOrder } => {
    if (c.targetType === 'supplierOrder' || c.targetType === 'line') {
      const so = c.targetType === 'supplierOrder' ? sos.get(c.targetId) : sos.get(ds.lines.find((l) => l.id === c.targetId)?.supplierOrderId ?? '');
      const order = so ? orders.get(so.orderId) : undefined;
      if (so && order) return { date: so.calcDate || order.calcDate || today, so };
    }
    if (c.targetType === 'order') {
      const order = orders.get(c.targetId);
      if (order) return { date: order.calcDate || today };
    }
    return { date: today };   // поставка и декларация общие для разных заказов — курс на сегодня
  };

  const toRub = (c: Cost): CostRub => {
    const amount = num(c.amount) ? c.amount : null;
    if (c.status === 'fact') {
      const rateDate = c.rateDate || c.paymentDate || c.entryDate;
      if (amount !== null && c.currency === 'RUB') return { costId: c.id, rub: amount, rate: { rate: 1, date: rateDate, source: 'fixed', exact: true } };
      if (amount !== null && pos(c.rate)) {
        return { costId: c.id, rub: amount * c.rate, rate: { rate: c.rate, date: rateDate, source: c.rateManual ? 'manual' : 'vtb', exact: true } };
      }
      if (num(c.amountRub)) return { costId: c.id, rub: c.amountRub, rate: null };
      if (amount === null) return { costId: c.id, rub: null, rate: null };
      const r = pickRate(ds.rates, c.currency, rateDate);
      return { costId: c.id, rub: r ? amount * r.rate : null, rate: r };
    }
    if (amount === null) return { costId: c.id, rub: null, rate: null };
    if (c.rateManual && pos(c.rate) && c.currency !== 'RUB') {
      return { costId: c.id, rub: amount * c.rate, rate: { rate: c.rate, date: c.rateDate || today, source: 'manual', exact: true } };
    }
    const { date, so } = planRateDate(c);
    let r: RatePick | null;
    if (so && so.currency === c.currency && pos(so.calcRate)) r = { rate: so.calcRate, date, source: 'manual', exact: true };
    else r = pickRate(ds.rates, c.currency, date);
    return { costId: c.id, rub: r ? amount * r.rate : null, rate: r };
  };

  const costsRub: CostRub[] = ds.costs.map(toRub);
  let unallocatedRub = 0;

  const emptyBase = (c: Cost, rub: number, why: string) => {
    if (rub === 0) return;
    unallocatedRub += rub;
    warn.add({ code: 'EMPTY_BASE', message: `Затрата «${c.costType}» на ${rub.toFixed(2)} ₽ не распределена: ${why}`, refs: [{ type: 'cost', id: c.id }, { type: c.targetType, id: c.targetId }] });
  };

  // Категория в разбивке: на позицию — «прямые»; «прочее» на поставку — «прочие расходы поставки».
  const bookCategory = (c: Cost, cat: CostCategory): CostCategory =>
    c.targetType === 'line' ? 'direct' : c.targetType === 'shipment' && cat === 'other' ? 'shipmentOther' : cat;

  const batchRefs = (sh: Shipment, list: Acc[]): CostWarning['refs'] =>
    [{ type: 'shipment', id: sh.id }, ...list.map((a) => ({ type: 'batch' as const, id: a.out.batchId }))];
  const byValue = (sh: Shipment, accs: Acc[], missingW: Acc[]): { item: Acc; w: number }[] => {
    warn.add({
      code: 'NO_WEIGHT',
      message: `Поставка «${sh.number}»: нет веса у партий (${missingW.length}) — затраты делятся по стоимости`,
      refs: batchRefs(sh, missingW),
    });
    return accs.map((a) => ({ item: a, w: a.customsValue ?? 0 }));
  };

  /**
   * База поставки, с предупреждениями.
   * Доставка поставки с правилом «по объёму» (тип поставки; без типа — контейнер море/авто): CBM у всех — по CBM; CBM ни у одной — по весу;
   * CBM у части (G01) — партия без CBM получает долю = её вес / общий вес партий поставки,
   * остаток делится между партиями с CBM по CBM; вес партии с CBM без веса — 1 CBM = 1000 кг (NO_WEIGHT).
   * Партия без CBM и без веса — вся поставка по стоимости. Остальное — вес → стоимость.
   */
  const shipmentWeights = (sh: Shipment, accs: Acc[], cat: CostCategory): { item: Acc; w: number }[] => {
    const container = cat === 'delivery' && deliveryBasis(ds, sh) === 'cbm';
    if (container) {
      const noCbm = accs.filter((a) => !pos(a.cbm));
      if (noCbm.length === 0) return accs.map((a) => ({ item: a, w: a.cbm! }));
      warn.add({
        code: 'NO_CBM',
        message: `Поставка «${sh.number}»: нет CBM у партий (${noCbm.length}) — их доля доставки считается по весу`,
        refs: batchRefs(sh, noCbm),
      });
      const withCbm = accs.filter((a) => pos(a.cbm));
      if (withCbm.length > 0) {
        const noCbmNoWeight = noCbm.filter((a) => !pos(a.weight));
        if (noCbmNoWeight.length > 0) return byValue(sh, accs, noCbmNoWeight);
        const imputed = withCbm.filter((a) => !pos(a.weight));
        if (imputed.length > 0) {
          warn.add({
            code: 'NO_WEIGHT',
            message: `Поставка «${sh.number}»: нет веса у партий с CBM (${imputed.length}) — для доли доставки по весу взято 1 CBM = 1000 кг`,
            refs: batchRefs(sh, imputed),
          });
        }
        const weightOf = (a: Acc) => (pos(a.weight) ? a.weight : a.cbm! * 1000);
        const totalWeight = accs.reduce((s, a) => s + weightOf(a), 0);
        const cbmWeight = withCbm.reduce((s, a) => s + weightOf(a), 0);
        const totalCbm = withCbm.reduce((s, a) => s + a.cbm!, 0);
        // Веса в долях от суммы: без CBM — вес / общий вес; с CBM — (вес партий с CBM / общий вес) × CBM / ΣCBM.
        return accs.map((a) => ({
          item: a,
          w: pos(a.cbm) ? ((cbmWeight / totalWeight) * a.cbm) / totalCbm : weightOf(a) / totalWeight,
        }));
      }
    }
    const missingW = accs.filter((a) => !pos(a.weight));
    if (missingW.length === 0) return accs.map((a) => ({ item: a, w: a.weight! }));
    return byValue(sh, accs, missingW);
  };

  const declHas = (declId: string, cat: CostCategory) =>
    ds.costs.some((c) => c.targetType === 'declaration' && c.targetId === declId && costCategory(c.costType) === cat);
  /** Расчётная пошлина партии: тамож. стоимость × % пошлины позиции. */
  const calcDuty = (a: Acc) => ((a.customsValue ?? 0) * (num(a.lc.line.dutyRate) ? a.lc.line.dutyRate : 0)) / 100;

  const allocate = (c: Cost, rub: number) => {
    const status: Status = c.status === 'plan' ? 'plan' : 'fact';
    const cat = costCategory(c.costType);
    const into = bookCategory(c, cat);
    const put = (a: Acc, part: number) => book(a, into, part, status, alloc, c.id);
    const byLines = (items: { item: LineCtx; w: number }[]) =>
      spread(items, rub, (lc, part) => { if (!spreadInLine(lc, part, put)) unallocatedRub += part; });

    switch (c.targetType) {
      case 'supplierOrder': {
        const lcs = [...lineCtx.values()].filter((lc) => lc.line.supplierOrderId === c.targetId);
        if (!byLines(lcs.map((lc) => ({ item: lc, w: lc.figures.X })))) emptyBase(c, rub, 'у поставщика в заказе нет закупаемых позиций со стоимостью');
        return;
      }
      case 'order': {
        const lcs = [...lineCtx.values()].filter((lc) => lc.line.orderId === c.targetId);
        if (!byLines(lcs.map((lc) => ({ item: lc, w: lc.figures.Z ?? 0 })))) emptyBase(c, rub, 'у заказа нет закупаемых позиций со стоимостью в рублях');
        return;
      }
      case 'line': {
        const lc = lineCtx.get(c.targetId);
        if (!lc || !spreadInLine(lc, rub, put)) emptyBase(c, rub, 'позиция не найдена, не закупается или без количества');
        return;
      }
      case 'shipment': {
        const sh = shipments.get(c.targetId);
        const accs = sh ? accsOfShipment(sh.id) : [];
        if (!sh || accs.length === 0 || !spread(shipmentWeights(sh, accs, cat), rub, put)) emptyBase(c, rub, 'в поставке нет партий с базой распределения');
        return;
      }
      case 'declaration': {
        const accs = declarations.has(c.targetId) ? accsOfDeclaration(c.targetId) : [];
        let items: { item: Acc; w: number }[];
        if (cat === 'duty') {
          items = accs.map((a) => ({ item: a, w: (a.customsValue ?? 0) * (num(a.lc.line.dutyRate) ? a.lc.line.dutyRate : 0) }));
          if (!items.some((x) => pos(x.w))) items = accs.map((a) => ({ item: a, w: a.customsValue ?? 0 }));
        } else if (cat === 'vat') {
          const entered = declHas(c.targetId, 'duty');
          items = accs.map((a) => ({ item: a, w: (a.customsValue ?? 0) + (entered ? a.declDuty : calcDuty(a)) }));
        } else {
          items = accs.map((a) => ({ item: a, w: a.customsValue ?? 0 }));
        }
        const ok = spread(items, rub, (a, part) => {
          put(a, part);
          if (cat === 'duty') a.declDuty += part;
        });
        if (!ok) emptyBase(c, rub, 'в декларации нет партий с таможенной стоимостью');
        return;
      }
      default: {
        const t: never = c.targetType;
        emptyBase(c, rub, `неизвестная привязка ${String(t)}`);
      }
    }
  };

  // Затраты без курса.
  ds.costs.forEach((c, i) => {
    if (costsRub[i].rub === null && num(c.amount)) {
      warn.add({
        code: 'NO_RATE',
        message: `Затрата «${c.costType}»: нет курса ${CURRENCY_LABEL[c.currency]} на ${ruDate(c.status === 'fact' ? c.rateDate || c.paymentDate || c.entryDate : planRateDate(c).date)} и раньше — сумма в рублях не посчитана`,
        refs: [{ type: 'cost', id: c.id }],
      });
    }
  });

  // Пошлина декларации должна быть разнесена раньше НДС: база НДС — тамож. стоимость + доля пошлины.
  const isDeclVat = (c: Cost) => c.targetType === 'declaration' && costCategory(c.costType) === 'vat';
  ds.costs.forEach((c, i) => { const rub = costsRub[i].rub; if (rub !== null && !isDeclVat(c)) allocate(c, rub); });
  ds.costs.forEach((c, i) => { const rub = costsRub[i].rub; if (rub !== null && isDeclVat(c)) allocate(c, rub); });

  // Прогноз таможни декларации (R22.1) — только для показа: в себестоимость партий и planRub не входит,
  // иначе сумма партий разошлась бы с суммой затрат и удвоила бы пошлину/НДС, внесённые на другую привязку.
  const settingsVatText = String(ds.settings?.vatRateDefault ?? '').trim().replace(',', '.');
  const defaultVat = settingsVatText !== '' && Number.isFinite(Number(settingsVatText)) ? Number(settingsVatText) : DEFAULT_VAT_RATE;
  const customsForecasts: CustomsForecast[] = [];
  for (const d of ds.declarations) {
    const sh = shipments.get(d.shipmentId);
    if (!sh) continue;
    const vatRate = num(sh.vatRate) ? sh.vatRate : defaultVat;
    const f: CustomsForecast = { declarationId: d.id, shipmentId: sh.id, customsValue: 0, duty: 0, vat: 0, vatRate };
    for (const a of accsOfDeclaration(d.id)) {
      const cv = a.customsValue ?? 0;
      const duty = calcDuty(a);
      f.customsValue += cv;
      f.duty += duty;
      f.vat += ((cv + duty) * vatRate) / 100;
    }
    customsForecasts.push(f);
  }

  // Партии без декларации в поставке с таможней.
  for (const sh of ds.shipments) {
    const accs = accsOfShipment(sh.id);
    const hasCustoms = ds.declarations.some((d) => d.shipmentId === sh.id)
      || ds.costs.some((c) => c.targetType === 'shipment' && c.targetId === sh.id && ['duty', 'vat', 'customsFees'].includes(costCategory(c.costType)));
    const without = accs.filter((a) => !a.batch!.declarationId || !declarations.has(a.batch!.declarationId));
    if (hasCustoms && without.length > 0) {
      warn.add({
        code: 'NO_DECLARATION',
        message: `Поставка «${sh.number}»: партии без декларации (${without.length}) — таможенные затраты на них не ложатся`,
        refs: [{ type: 'shipment', id: sh.id }, ...without.map((a) => ({ type: 'batch' as const, id: a.out.batchId }))],
      });
    }
  }

  // ----- партии и позиции -----
  for (const a of allAccs) a.out.unitCost = a.out.qty > 0 ? a.out.total / a.out.qty : 0;

  const lines: LineCost[] = [];
  for (const lc of lineCtx.values()) {
    const breakdown = zeroBreakdown();
    let total = 0;
    let shipped = 0;
    for (const a of lc.accs) {
      for (const k of COST_CATEGORIES) breakdown[k] += a.out.breakdown[k];
      total += a.out.total;
      if (!a.out.virtual) shipped += a.out.qty;
    }
    const qty = num(lc.line.qty) ? lc.line.qty : 0;
    const AV = qty > 0 && total !== 0 ? total / qty : null;
    const Y = lc.figures.Y;
    lines.push({
      lineId: lc.line.id, orderId: lc.line.orderId, qty, unshippedQty: Math.max(0, qty - shipped),
      Y, AB: lc.figures.AB, AD: effectiveCoef(lc.line, lc.so) ?? null,
      breakdown, total, AV, AW: AV !== null && Y !== null && Y > 0 ? AV / Y : null,
      provisional: !lc.order?.costsComplete,
    });
  }

  // ----- итоги заказов -----
  const totals: OrderTotals[] = ds.orders.map((o) => {
    const t: OrderTotals = { orderId: o.id, sumByCurrency: {}, rubAtCalc: 0, forecastRub: 0, planRub: 0, factRub: 0, costTotal: 0 };
    for (const lc of lineCtx.values()) {
      if (lc.line.orderId !== o.id) continue;
      if (lc.so) t.sumByCurrency[lc.so.currency] = (t.sumByCurrency[lc.so.currency] ?? 0) + lc.figures.X;
      if (lc.figures.Z !== null) t.rubAtCalc += lc.figures.Z;
      if (lc.figures.AB !== null) t.forecastRub += lc.figures.AB * (num(lc.line.qty) ? lc.line.qty : 0);
      for (const a of lc.accs) { t.planRub += a.plan; t.factRub += a.fact; }
    }
    t.costTotal = t.planRub + t.factRub;
    if (!o.costsComplete && [...lineCtx.values()].some((lc) => lc.line.orderId === o.id)) {
      warn.add({ code: 'NOT_COMPLETE', message: `Заказ ${orderRef(o)}: не отмечено «Все затраты внесены» — фактический коэффициент себестоимости доставки предварительный`, refs: [{ type: 'order', id: o.id }] });
    }
    return t;
  });

  return {
    costsRub, batches: allAccs.map((a) => a.out), lines, orders: totals, unallocatedRub,
    warnings: warn.warnings, customsForecasts,
    allocations: [...alloc].flatMap(([costId, byBatch]) => [...byBatch].map(([batchId, rub]) => ({ costId, batchId, rub }))),
  };
}


import { describe, expect, it } from 'vitest';
import { computeCosting, costCategory, type CostingResult } from '../../src/domain/costing';
import {
  emptyDataset, type Batch, type Cost, type CostTargetType, type Currency, type Dataset, type Declaration, type Line,
  type Order, type Rate, type Shipment, type ShipmentMode, type SupplierOrder,
} from '../../src/domain/model';

// ---------- фикстуры ----------

const TODAY = '2026-10-25';
let orderNo = 0;
const ds = (p: Partial<Dataset>): Dataset => ({ ...emptyDataset(), ...p });
const ord = (id: string, extra: Partial<Order> = {}): Order => ({ id, number: ++orderNo, date: '2026-09-01', costsComplete: true, ...extra });
const so = (id: string, orderId: string, currency: Currency, extra: Partial<SupplierOrder> = {}): SupplierOrder =>
  ({ id, orderId, seq: 1, supplierId: 'sup_1', currency, ...extra });
const ln = (id: string, supplierOrderId: string, orderId: string, qty: number, unitPrice: number, extra: Partial<Line> = {}): Line =>
  ({ id, orderId, supplierOrderId, seq: 1, qty, unitPrice, purchased: true, ...extra });
const sh = (id: string, mode: ShipmentMode, extra: Partial<Shipment> = {}): Shipment => ({ id, number: id, mode, vatRate: 22, ...extra });
const bt = (id: string, shipmentId: string, lineId: string, qty: number, extra: Partial<Batch> = {}): Batch => ({ id, shipmentId, lineId, qty, ...extra });
const decl = (id: string, shipmentId: string): Declaration => ({ id, shipmentId });
const cost = (id: string, targetType: CostTargetType, targetId: string, costType: string, amount: number, extra: Partial<Cost> = {}): Cost =>
  ({ id, entryDate: '2026-10-01', status: 'fact', targetType, targetId, costType, amount, currency: 'RUB', rateManual: false, ...extra });
const rate = (date: string, currency: Rate['currency'], value: number): Rate => ({ id: `r_${date}_${currency}`, date, currency, rate: value, source: 'vtb' });

const batchOf = (res: CostingResult, id: string) => {
  const b = res.batches.find((x) => x.batchId === id);
  if (!b) throw new Error(`нет партии ${id}`);
  return b;
};
const lineOf = (res: CostingResult, id: string) => {
  const l = res.lines.find((x) => x.lineId === id);
  if (!l) throw new Error(`нет позиции ${id}`);
  return l;
};
const rubOf = (res: CostingResult, id: string) => res.costsRub.find((c) => c.costId === id)?.rub;
const codes = (res: CostingResult) => res.warnings.map((w) => w.code);
const refIds = (res: CostingResult, code: string) => res.warnings.filter((w) => w.code === code).flatMap((w) => w.refs.map((r) => r.id));

// Один заказ, один поставщик CNY с ручным курсом 10, две позиции: A — 100 шт × 10, B — 100 шт × 30.
// Тамож. стоимость: A = 10 000 ₽, B = 30 000 ₽.
function twoLines(extra: { lineA?: Partial<Line>; lineB?: Partial<Line>; batchA?: Partial<Batch>; batchB?: Partial<Batch>; mode?: ShipmentMode } = {}) {
  return ds({
    orders: [ord('o1')],
    supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 })],
    lines: [ln('A', 's1', 'o1', 100, 10, extra.lineA), ln('B', 's1', 'o1', 100, 30, extra.lineB)],
    shipments: [sh('sh1', extra.mode ?? 'sea_container')],
    batches: [bt('bA', 'sh1', 'A', 100, extra.batchA), bt('bB', 'sh1', 'B', 100, extra.batchB)],
  });
}

// ---------- перевод затрат в рубли ----------

describe('затраты в рублях', () => {
  const base = (calcDate: string, costs: Cost[]) => ds({
    rates: [rate('2026-10-01', 'CNY', 11.48), rate('2026-10-20', 'CNY', 11.55), rate('2026-10-01', 'USD', 82.2), rate('2026-10-20', 'USD', 82.7)],
    orders: [ord('o1', { calcDate })],
    supplierOrders: [so('s1', 'o1', 'CNY')],
    lines: [ln('L1', 's1', 'o1', 100, 10)],
    costs,
  });
  const costs = [
    cost('fact', 'supplierOrder', 's1', 'Аванс', 1000, { currency: 'CNY', rate: 11.6, rateDate: '2026-09-12', rateManual: true }),
    cost('planSo', 'supplierOrder', 's1', 'Итоговый расчёт', 1000, { status: 'plan', currency: 'CNY' }),
    cost('planOrder', 'order', 'o1', 'Комиссия банка', 100, { status: 'plan', currency: 'USD' }),
    cost('planRub', 'order', 'o1', 'Прочее', 5000, { status: 'plan' }),
  ];

  it('факт — по зафиксированному курсу, план — по курсу даты расчёта, RUB — курс 1', () => {
    const res = computeCosting(base('2026-10-01', costs), TODAY);
    expect(rubOf(res, 'fact')).toBeCloseTo(11600, 6);
    expect(rubOf(res, 'planSo')).toBeCloseTo(11480, 6);
    expect(rubOf(res, 'planOrder')).toBeCloseTo(8220, 6);
    expect(rubOf(res, 'planRub')).toBe(5000);
    expect(res.costsRub.find((c) => c.costId === 'planSo')?.rate).toEqual({ rate: 11.48, date: '2026-10-01', source: 'vtb', exact: true });
  });

  it('смена даты расчёта меняет только плановые затраты', () => {
    const res = computeCosting(base('2026-10-20', costs), TODAY);
    expect(rubOf(res, 'fact')).toBeCloseTo(11600, 6);
    expect(rubOf(res, 'planSo')).toBeCloseTo(11550, 6);
    expect(rubOf(res, 'planOrder')).toBeCloseTo(8270, 6);
    expect(rubOf(res, 'planRub')).toBe(5000);
  });

  it('нет курса валюты затраты — сумма в рублях пустая и предупреждение NO_RATE', () => {
    const res = computeCosting(base('2026-10-01', [cost('eur', 'order', 'o1', 'Прочее', 100, { status: 'plan', currency: 'EUR' })]), TODAY);
    expect(rubOf(res, 'eur')).toBeNull();
    expect(refIds(res, 'NO_RATE')).toContain('eur');
    expect(res.unallocatedRub).toBe(0);
  });

  it('поставщик без курса расчёта — NO_RATE со ссылкой на поставщика в заказе, Y пустой', () => {
    const d = ds({ orders: [ord('o1')], supplierOrders: [so('s1', 'o1', 'EUR')], lines: [ln('L1', 's1', 'o1', 1, 1)] });
    const res = computeCosting(d, TODAY);
    expect(refIds(res, 'NO_RATE')).toContain('s1');
    expect(lineOf(res, 'L1').Y).toBeNull();
  });
});

// ---------- правила распределения ----------

describe('распределение: поставщик в заказе', () => {
  it('по стоимости закупаемых позиций в валюте, внутри позиции — по количеству партий; без «Закупки» не участвует', () => {
    const d = ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 })],
      lines: [ln('L1', 's1', 'o1', 100, 10), ln('L2', 's1', 'o1', 50, 60), ln('L3', 's1', 'o1', 10, 100, { purchased: false })],
      shipments: [sh('sh1', 'sea_container')],
      batches: [bt('b1', 'sh1', 'L2', 20, { cbm: 1, weight: 10 }), bt('b3', 'sh1', 'L3', 10, { cbm: 1, weight: 10 })],
      costs: [cost('c1', 'supplierOrder', 's1', 'Аванс', 4000)],
    });
    const res = computeCosting(d, TODAY);
    expect(lineOf(res, 'L1').total).toBeCloseTo(1000, 9);
    expect(lineOf(res, 'L2').total).toBeCloseTo(3000, 9);
    expect(batchOf(res, 'b1').breakdown.goods).toBeCloseTo(1200, 9);
    expect(batchOf(res, 'rest:L2').breakdown.goods).toBeCloseTo(1800, 9);
    expect(res.lines.map((l) => l.lineId)).not.toContain('L3');
    expect(res.batches.map((b) => b.batchId)).not.toContain('b3');
  });
});

describe('распределение: заказ', () => {
  it('по стоимости закупаемых позиций в рублях по курсу даты расчёта (без AD)', () => {
    const d = ds({
      orders: [ord('o1'), ord('o2')],
      supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 }), so('s2', 'o1', 'USD', { calcRate: 80 }), so('s3', 'o2', 'RUB')],
      lines: [ln('L1', 's1', 'o1', 100, 10, { coef: 5 }), ln('L4', 's2', 'o1', 10, 25, { coef: 1 }), ln('L9', 's3', 'o2', 1, 1000)],
      costs: [cost('c1', 'order', 'o1', 'Брокер', 3000)],
    });
    const res = computeCosting(d, TODAY);
    expect(lineOf(res, 'L1').total).toBeCloseTo(1000, 9);
    expect(lineOf(res, 'L4').total).toBeCloseTo(2000, 9);
    expect(lineOf(res, 'L9').total).toBe(0);
  });
});

describe('распределение: поставка', () => {
  it('контейнер (море) — доставка по CBM', () => {
    const d = twoLines({ batchA: { cbm: 2, weight: 100 }, batchB: { cbm: 6, weight: 900 } });
    d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 8000)];
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(2000, 9);
    expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(6000, 9);
    expect(codes(res)).not.toContain('NO_CBM');
  });

  describe('тип поставки задаёт правило доставки (G29)', () => {
    const withType = (mode: ShipmentMode, typeId: string, types: Dataset['shipmentTypes']) => {
      const d = twoLines({ mode, batchA: { cbm: 2, weight: 100 }, batchB: { cbm: 6, weight: 900 } });
      d.shipments[0].typeId = typeId;
      d.shipmentTypes = types;
      d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 8000)];
      return computeCosting(d, TODAY);
    };

    it('тип «по объёму» — по CBM, даже если прежний тип поставки «авиа»', () => {
      const res = withType('air', 't_rail', [{ id: 't_rail', name: 'Ж/д, контейнер', basis: 'cbm' }]);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(2000, 9);
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(6000, 9);
    });

    it('тип «по весу» — по весу, даже если прежний тип «море, контейнер»', () => {
      const res = withType('sea_container', 't_gr', [{ id: 't_gr', name: 'Авто, сборный груз', basis: 'weight' }]);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(800, 9);
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(7200, 9);
    });

    it('тип не найден в справочнике — как раньше, по прежнему типу поставки', () => {
      const res = withType('sea_container', 'нет_такого', []);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(2000, 9);
    });
  });

  it('контейнер (авто) — CBM есть не у всех партий: партия без CBM — доля по весу, остаток по CBM; NO_CBM со списком партий без CBM', () => {
    const d = twoLines({ mode: 'road_container', batchA: { cbm: 2, weight: 100 }, batchB: { weight: 300 } });
    d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 4000)];
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(1000, 9);
    expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(3000, 9);
    expect(refIds(res, 'NO_CBM')).toContain('bB');
    expect(refIds(res, 'NO_CBM')).not.toContain('bA');
  });

  describe('контейнер: CBM есть не у всех партий (G01)', () => {
    // Три позиции по 1 шт × 1000 ₽ (RUB), каждая целиком в своей партии одной поставки.
    const mixed = (mode: ShipmentMode, a: Partial<Batch>, b: Partial<Batch>, c: Partial<Batch>, costs: Cost[]) => ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'RUB')],
      lines: [ln('A', 's1', 'o1', 1, 1000), ln('B', 's1', 'o1', 1, 1000), ln('C', 's1', 'o1', 1, 1000)],
      shipments: [sh('sh1', mode)],
      batches: [bt('bA', 'sh1', 'A', 1, a), bt('bB', 'sh1', 'B', 1, b), bt('bC', 'sh1', 'C', 1, c)],
      costs,
    });
    const distributed = (res: CostingResult) => res.batches.reduce((s, x) => s + x.total, 0);

    it('партия без CBM — доля доставки = её вес / общий вес; остаток — между партиями с CBM по CBM', () => {
      const d = mixed('sea_container', { cbm: 2, weight: 500 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bC').breakdown.delivery).toBeCloseTo(2000, 9);          // 10 000 × 200 / 1000
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(5333.333333333, 6); // 8 000 × 2/3
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(2666.666666667, 6); // 8 000 × 1/3
      expect(res.unallocatedRub).toBe(0);
      expect(distributed(res)).toBeCloseTo(10000, 6);
      expect(refIds(res, 'NO_CBM')).toEqual(['sh1', 'bC']);
      const msg = res.warnings.find((w) => w.code === 'NO_CBM')!.message;
      expect(msg).not.toMatch(/доставка делится по весу/);
      expect(codes(res)).not.toContain('NO_WEIGHT');
    });

    it('у партии с CBM нет веса ни у неё, ни у позиции — для доли веса 1 CBM = 1000 кг и NO_WEIGHT', () => {
      // Веса: A = 2 × 1000 = 2000, B = 300, C = 200; всего 2500.
      const d = mixed('road_container', { cbm: 2 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bC').breakdown.delivery).toBeCloseTo(800, 9);           // 10 000 × 200 / 2500
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(6133.333333333, 6); // 9 200 × 2/3
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(3066.666666667, 6); // 9 200 × 1/3
      expect(distributed(res)).toBeCloseTo(10000, 6);
      expect(refIds(res, 'NO_WEIGHT')).toContain('bA');
      expect(refIds(res, 'NO_WEIGHT')).not.toContain('bB');
      expect(refIds(res, 'NO_WEIGHT')).not.toContain('bC');
    });

    it('вес партии с CBM берётся у позиции, если у партии его нет', () => {
      const d = mixed('sea_container', { cbm: 2 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
      d.lines[0].weight = 500;
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bC').breakdown.delivery).toBeCloseTo(2000, 9);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(5333.333333333, 6);
      expect(codes(res)).not.toContain('NO_WEIGHT');
    });

    it('CBM ни у одной партии — вся доставка по весу', () => {
      const d = mixed('sea_container', { weight: 500 }, { weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(5000, 9);
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(3000, 9);
      expect(batchOf(res, 'bC').breakdown.delivery).toBeCloseTo(2000, 9);
      expect(refIds(res, 'NO_CBM')).toEqual(['sh1', 'bA', 'bB', 'bC']);
    });

    it('партия без CBM и без веса — вся поставка по стоимости с NO_WEIGHT, даже если у партии с CBM нет веса', () => {
      // Тамож. стоимость каждой партии 1000 ₽ → поровну.
      const d = mixed('sea_container', { cbm: 2 }, { cbm: 1, weight: 300 }, {},
        [cost('c1', 'shipment', 'sh1', 'Доставка', 9000)]);
      const res = computeCosting(d, TODAY);
      for (const id of ['bA', 'bB', 'bC']) expect(batchOf(res, id).breakdown.delivery, id).toBeCloseTo(3000, 9);
      expect(refIds(res, 'NO_WEIGHT')).toContain('bC');
      expect(refIds(res, 'NO_CBM')).toEqual(['sh1', 'bC']);
    });

    it('прочие затраты поставки в том же контейнере — по весу, без подстановки 1 CBM = 1000 кг', () => {
      const d = mixed('sea_container', { cbm: 2, weight: 500 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'СВХ', 1000)]);
      let res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bA').breakdown.shipmentOther).toBeCloseTo(500, 9);
      expect(batchOf(res, 'bB').breakdown.shipmentOther).toBeCloseTo(300, 9);
      expect(batchOf(res, 'bC').breakdown.shipmentOther).toBeCloseTo(200, 9);

      const noW = mixed('sea_container', { cbm: 2 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Брокер', 900)]);
      res = computeCosting(noW, TODAY);
      for (const id of ['bA', 'bB', 'bC']) expect(batchOf(res, id).breakdown.shipmentOther, id).toBeCloseTo(300, 9);
      expect(refIds(res, 'NO_WEIGHT')).toContain('bA');
    });

    it('авиа с той же раскладкой — доставка по весу', () => {
      const d = mixed('air', { cbm: 2, weight: 500 }, { cbm: 1, weight: 300 }, { weight: 200 },
        [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(5000, 9);
      expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(3000, 9);
      expect(batchOf(res, 'bC').breakdown.delivery).toBeCloseTo(2000, 9);
      expect(codes(res)).not.toContain('NO_CBM');
    });
  });

  it('CBM партии не задан, но есть у позиции — берётся доля позиции по количеству', () => {
    const d = twoLines({ lineA: { cbm: 4 }, batchA: { qty: 50, weight: 1 }, batchB: { cbm: 6, weight: 1 } });
    d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 8000)];
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(2000, 9);   // 50 из 100 шт → CBM 2
    expect(codes(res)).not.toContain('NO_CBM');
  });

  it('нет ни CBM, ни веса у части партий — по стоимости и предупреждения NO_CBM, NO_WEIGHT', () => {
    const d = twoLines({ batchA: { cbm: 2, weight: 100 } });
    d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 4000)];
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(1000, 9);   // 10 000 : 30 000
    expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(3000, 9);
    expect(refIds(res, 'NO_CBM')).toEqual(expect.arrayContaining(['bB']));
    expect(refIds(res, 'NO_WEIGHT')).toEqual(expect.arrayContaining(['bB']));
  });

  it('авиа — доставка по весу; нет веса — по стоимости с NO_WEIGHT', () => {
    const d = twoLines({ mode: 'air', batchA: { cbm: 6, weight: 100 }, batchB: { cbm: 2, weight: 300 } });
    d.costs = [cost('c1', 'shipment', 'sh1', 'Доставка', 1000)];
    let res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.delivery).toBeCloseTo(250, 9);
    expect(batchOf(res, 'bB').breakdown.delivery).toBeCloseTo(750, 9);

    const noW = twoLines({ mode: 'air', batchA: { weight: 100 } });
    noW.costs = [cost('c2', 'shipment', 'sh1', 'СВХ', 400)];
    res = computeCosting(noW, TODAY);
    expect(batchOf(res, 'bA').breakdown.shipmentOther).toBeCloseTo(100, 9);
    expect(batchOf(res, 'bB').breakdown.shipmentOther).toBeCloseTo(300, 9);
    expect(refIds(res, 'NO_WEIGHT')).toContain('bB');
    expect(refIds(res, 'NO_WEIGHT')).not.toContain('bA');
  });

  it('СВХ, брокер, терминальная обработка, сертификаты, прочее в контейнере — по весу, а не по CBM', () => {
    for (const type of ['СВХ', 'Брокер', 'Терминальная обработка', 'Сертификаты', 'Прочее']) {
      const d = twoLines({ batchA: { cbm: 6, weight: 100 }, batchB: { cbm: 2, weight: 300 } });
      d.costs = [cost('c1', 'shipment', 'sh1', type, 1000)];
      const res = computeCosting(d, TODAY);
      expect(batchOf(res, 'bA').breakdown.shipmentOther, type).toBeCloseTo(250, 9);
      expect(batchOf(res, 'bB').breakdown.shipmentOther, type).toBeCloseTo(750, 9);
    }
  });

  it('доля партии не зависит от выбора заказов: поставка делится по всем партиям, включая партии другого заказа', () => {
    const d = ds({
      orders: [ord('o1'), ord('o2')],
      supplierOrders: [so('s1', 'o1', 'RUB'), so('s2', 'o2', 'RUB')],
      lines: [ln('L1', 's1', 'o1', 10, 100), ln('L2', 's2', 'o2', 10, 100)],
      shipments: [sh('sh1', 'sea_container')],
      batches: [bt('b1', 'sh1', 'L1', 10, { cbm: 1, weight: 1 }), bt('b2', 'sh1', 'L2', 10, { cbm: 3, weight: 1 })],
      costs: [cost('c1', 'shipment', 'sh1', 'Доставка', 4000)],
    });
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'b1').total).toBeCloseTo(1000, 9);
    expect(batchOf(res, 'b2').total).toBeCloseTo(3000, 9);
    const onlyOrder1 = res.lines.filter((l) => l.orderId === 'o1');
    expect(onlyOrder1.map((l) => l.total)).toEqual([expect.closeTo(1000, 9)]);
  });
});

describe('распределение: декларация', () => {
  const withDecl = (costs: Cost[], extra: Parameters<typeof twoLines>[0] = {}) => {
    const d = twoLines({ lineA: { dutyRate: 5 }, lineB: { dutyRate: 10 }, batchA: { declarationId: 'd1' }, batchB: { declarationId: 'd1' }, ...extra });
    d.declarations = [decl('d1', 'sh1')];
    d.costs = costs;
    return d;
  };

  it('пошлина ∝ тамож. стоимость × % пошлины', () => {
    const res = computeCosting(withDecl([cost('c1', 'declaration', 'd1', 'Пошлина', 3500)]), TODAY);
    expect(batchOf(res, 'bA').breakdown.duty).toBeCloseTo(500, 9);    // 10 000 × 5 %
    expect(batchOf(res, 'bB').breakdown.duty).toBeCloseTo(3000, 9);   // 30 000 × 10 %
  });

  it('все % пошлины = 0 — пошлина ∝ тамож. стоимости', () => {
    const d = withDecl([cost('c1', 'declaration', 'd1', 'Пошлина', 400)], { lineA: { dutyRate: 0 }, lineB: {} });
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.duty).toBeCloseTo(100, 9);
    expect(batchOf(res, 'bB').breakdown.duty).toBeCloseTo(300, 9);
  });

  it('НДС ∝ (тамож. стоимость + доля пошлины), сборы ∝ тамож. стоимости', () => {
    const res = computeCosting(withDecl([
      cost('c1', 'declaration', 'd1', 'Пошлина', 3500),
      cost('c2', 'declaration', 'd1', 'НДС', 9570),
      cost('c3', 'declaration', 'd1', 'Растаможка/сборы', 4000),
    ]), TODAY);
    expect(batchOf(res, 'bA').breakdown.vat).toBeCloseTo(2310, 9);    // 9570 × 10 500 / 43 500
    expect(batchOf(res, 'bB').breakdown.vat).toBeCloseTo(7260, 9);
    expect(batchOf(res, 'bA').breakdown.customsFees).toBeCloseTo(1000, 9);
    expect(batchOf(res, 'bB').breakdown.customsFees).toBeCloseTo(3000, 9);
    const f = res.customsForecasts.find((x) => x.declarationId === 'd1');
    expect(f).toEqual({ declarationId: 'd1', shipmentId: 'sh1', customsValue: 40000, duty: expect.closeTo(3500, 9), vat: expect.closeTo(9570, 9), vatRate: 22 });
    expect(f?.duty).toBeCloseTo(3500, 9);
    expect(f?.vat).toBeCloseTo(9570, 9);
  });

  it('до внесения пошлины и НДС — прогноз из % пошлины и ставки НДС поставки только показывается, в себестоимость не входит', () => {
    const res = computeCosting(withDecl([]), TODAY);
    // пошлина: 10 000 × 5 % + 30 000 × 10 % = 3500; НДС: (40 000 + 3500) × 22 % = 9570
    expect(res.customsForecasts).toEqual([
      { declarationId: 'd1', shipmentId: 'sh1', customsValue: 40000, duty: expect.closeTo(3500, 9), vat: expect.closeTo(9570, 9), vatRate: 22 },
    ]);
    expect(batchOf(res, 'bA').breakdown.duty).toBe(0);
    expect(batchOf(res, 'bA').breakdown.vat).toBe(0);
    expect(res.batches.reduce((s, b) => s + b.total, 0)).toBe(0);
    expect(res.orders[0].planRub).toBe(0);
  });

  it('НДС на декларации без внесённой пошлины — база НДС: тамож. стоимость + расчётная пошлина партии', () => {
    const res = computeCosting(withDecl([cost('c2', 'declaration', 'd1', 'НДС', 9570)]), TODAY);
    expect(batchOf(res, 'bA').breakdown.vat).toBeCloseTo(2310, 9);    // 9570 × (10 000 + 500) / 43 500
    expect(batchOf(res, 'bB').breakdown.vat).toBeCloseTo(7260, 9);
    expect(batchOf(res, 'bA').breakdown.duty + batchOf(res, 'bB').breakdown.duty).toBe(0);
  });

  it('ставка НДС поставки не задана — из настроек vatRateDefault', () => {
    const d = withDecl([cost('c1', 'declaration', 'd1', 'Пошлина', 0)], { lineA: { dutyRate: 0 }, lineB: { dutyRate: 0 } });
    d.shipments = [{ ...d.shipments[0], vatRate: undefined as unknown as number }];
    d.settings = { vatRateDefault: '20' };
    const res = computeCosting(d, TODAY);
    expect(res.customsForecasts[0].vatRate).toBe(20);
    expect(res.customsForecasts[0].vat).toBeCloseTo(8000, 9);    // 40 000 × 20 %
    expect(batchOf(res, 'bA').breakdown.vat).toBe(0);
  });

  it('партии без декларации при таможенных затратах — NO_DECLARATION, таможня на них не ложится', () => {
    const d = twoLines({ batchA: { declarationId: 'd1' } });
    d.declarations = [decl('d1', 'sh1')];
    d.costs = [cost('c1', 'declaration', 'd1', 'Растаможка/сборы', 1000)];
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'bA').breakdown.customsFees).toBeCloseTo(1000, 9);
    expect(batchOf(res, 'bB').breakdown.customsFees).toBe(0);
    expect(batchOf(res, 'bB').breakdown.duty).toBe(0);
    expect(refIds(res, 'NO_DECLARATION')).toContain('bB');
    expect(refIds(res, 'NO_DECLARATION')).not.toContain('bA');
  });
});

describe('распределение: позиция', () => {
  it('затрата на позицию — целиком на неё, по партиям — по количеству; категория «прямые»', () => {
    const d = ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'RUB')],
      lines: [ln('L1', 's1', 'o1', 50, 10), ln('L2', 's1', 'o1', 50, 10)],
      shipments: [sh('sh1', 'air')],
      batches: [bt('b1', 'sh1', 'L1', 20, { weight: 5 })],
      costs: [cost('c1', 'line', 'L1', 'Сертификаты', 600)],
    });
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'b1').breakdown.direct).toBeCloseTo(240, 9);
    expect(batchOf(res, 'rest:L1').breakdown.direct).toBeCloseTo(360, 9);
    expect(lineOf(res, 'L2').total).toBe(0);
  });
});

// ---------- партии, позиции, итоги ----------

describe('неотгруженный остаток', () => {
  it('виртуальная партия rest:<lineId> получает товар и комиссии, но не доставку и таможню', () => {
    const d = ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 })],
      lines: [ln('L1', 's1', 'o1', 100, 10, { dutyRate: 10 })],
      shipments: [sh('sh1', 'sea_container')],
      declarations: [decl('d1', 'sh1')],
      batches: [bt('b1', 'sh1', 'L1', 40, { cbm: 1, weight: 1, declarationId: 'd1' })],
      costs: [
        cost('c1', 'supplierOrder', 's1', 'Аванс', 1000),
        cost('c2', 'supplierOrder', 's1', 'Комиссия банка', 100),
        cost('c3', 'shipment', 'sh1', 'Доставка', 500),
        cost('c4', 'declaration', 'd1', 'Растаможка/сборы', 300),
      ],
    });
    const res = computeCosting(d, TODAY);
    const rest = batchOf(res, 'rest:L1');
    expect(rest).toMatchObject({ virtual: true, shipmentId: null, lineId: 'L1', qty: 60 });
    expect(rest.breakdown.goods).toBeCloseTo(600, 9);
    expect(rest.breakdown.commission).toBeCloseTo(60, 9);
    expect(rest.breakdown.delivery + rest.breakdown.customsFees + rest.breakdown.duty + rest.breakdown.vat).toBe(0);
    expect(batchOf(res, 'b1').breakdown.delivery).toBeCloseTo(500, 9);
    expect(lineOf(res, 'L1').unshippedQty).toBe(60);
  });
});

describe('позиция в двух поставках', () => {
  it('две партии с разной себестоимостью единицы; позиция — их сумма; AV и AW = AV / Y', () => {
    const d = ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 })],
      lines: [ln('L1', 's1', 'o1', 100, 10, { coef: 1.5 })],
      shipments: [sh('sh1', 'sea_container'), sh('sh2', 'air')],
      batches: [bt('b1', 'sh1', 'L1', 40, { cbm: 1, weight: 1 }), bt('b2', 'sh2', 'L1', 60, { weight: 1 })],
      costs: [
        cost('c1', 'supplierOrder', 's1', 'Итоговый расчёт', 1000),
        cost('c2', 'shipment', 'sh1', 'Доставка', 2000),
        cost('c3', 'shipment', 'sh2', 'Доставка', 600),
      ],
    });
    const res = computeCosting(d, TODAY);
    expect(batchOf(res, 'b1').total).toBeCloseTo(2400, 9);
    expect(batchOf(res, 'b1').unitCost).toBeCloseTo(60, 9);
    expect(batchOf(res, 'b2').total).toBeCloseTo(1200, 9);
    expect(batchOf(res, 'b2').unitCost).toBeCloseTo(20, 9);
    expect(res.batches.map((b) => b.batchId)).not.toContain('rest:L1');
    const line = lineOf(res, 'L1');
    expect(line.total).toBeCloseTo(3600, 9);
    expect(line.unshippedQty).toBe(0);
    expect(line.Y).toBeCloseTo(100, 9);
    expect(line.AB).toBeCloseTo(150, 9);
    expect(line.AD).toBe(1.5);
    expect(line.AV).toBeCloseTo(36, 9);
    expect(line.AW).toBeCloseTo(0.36, 9);
    expect(line.breakdown.goods).toBeCloseTo(1000, 9);
    expect(line.breakdown.delivery).toBeCloseTo(2600, 9);
  });
});

describe('нераспределённое и предупреждения', () => {
  it('затрата без базы — EMPTY_BASE и сумма в unallocatedRub; распределённое + нераспределённое = сумма затрат', () => {
    const d = twoLines({ batchA: { cbm: 1, weight: 1, qty: 30 }, batchB: { cbm: 3, weight: 2 } });
    d.shipments.push(sh('empty', 'air'));
    d.costs = [
      cost('c1', 'shipment', 'empty', 'Доставка', 500),
      cost('c2', 'order', 'nope', 'Прочее', 70),
      cost('c3', 'supplierOrder', 's1', 'Аванс', 1234.5),
      cost('c4', 'shipment', 'sh1', 'Доставка', 777, { status: 'plan', currency: 'USD', rateManual: true, rate: 81.3 }),
      cost('c5', 'order', 'o1', 'Комиссия агента', 99.9),
      cost('c6', 'line', 'B', 'Прочее', 10),
    ];
    const res = computeCosting(d, TODAY);
    expect(res.unallocatedRub).toBeCloseTo(570, 9);
    expect(refIds(res, 'EMPTY_BASE')).toEqual(expect.arrayContaining(['c1', 'c2']));
    const allocated = res.batches.reduce((s, b) => s + b.total, 0);
    const totalRub = res.costsRub.reduce((s, c) => s + (c.rub ?? 0), 0);
    expect(allocated + res.unallocatedRub).toBeCloseTo(totalRub, 6);
    expect(res.lines.reduce((s, l) => s + l.total, 0)).toBeCloseTo(allocated, 6);
  });

  describe('инвариант на поставке с декларацией: Σ партий + нераспределённое = Σ затрат в ₽', () => {
    // A: 100 шт, 30 в партии bA (декларация d1), остаток 70; B: 100 шт целиком в bB (d1); % пошлины 5 и 10.
    const declared = (costs: Cost[]) => {
      const d = twoLines({
        lineA: { dutyRate: 5 }, lineB: { dutyRate: 10 },
        batchA: { qty: 30, cbm: 1, weight: 1, declarationId: 'd1' }, batchB: { cbm: 3, weight: 2, declarationId: 'd1' },
      });
      d.declarations = [decl('d1', 'sh1')];
      d.shipments.push(sh('empty', 'air'));
      d.costs = [
        cost('c1', 'shipment', 'empty', 'Доставка', 500),
        cost('c3', 'supplierOrder', 's1', 'Аванс', 1234.5),
        cost('c4', 'shipment', 'sh1', 'Доставка', 777, { status: 'plan', currency: 'USD', rateManual: true, rate: 81.3 }),
        cost('c5', 'declaration', 'd1', 'Растаможка/сборы', 4000, { status: 'plan' }),
        ...costs,
      ];
      return d;
    };
    const check = (res: CostingResult, expectedTotalRub: number) => {
      const allocated = res.batches.reduce((s, b) => s + b.total, 0);
      const totalRub = res.costsRub.reduce((s, c) => s + (c.rub ?? 0), 0);
      expect(totalRub).toBeCloseTo(expectedTotalRub, 6);
      expect(allocated + res.unallocatedRub).toBeCloseTo(totalRub, 6);
      expect(res.lines.reduce((s, l) => s + l.total, 0)).toBeCloseTo(allocated, 6);
      const plan = res.orders.reduce((s, o) => s + o.planRub, 0);
      const fact = res.orders.reduce((s, o) => s + o.factRub, 0);
      expect(plan + fact).toBeCloseTo(allocated, 6);
    };
    const base = 500 + 1234.5 + 777 * 81.3 + 4000;

    it('декларация без затрат «Пошлина»/«НДС» — прогноз есть, в суммы не попадает', () => {
      const res = computeCosting(declared([]), TODAY);
      check(res, base);
      expect(res.unallocatedRub).toBeCloseTo(500, 9);
      expect(res.customsForecasts[0].duty).toBeCloseTo(3000 * 0.05 + 30000 * 0.1, 9);
    });

    it('пошлина на декларации, НДС на заказе при партиях в декларации — ничего не удваивается', () => {
      const res = computeCosting(declared([
        cost('d', 'declaration', 'd1', 'Пошлина', 3150),
        cost('v', 'order', 'o1', 'НДС', 7293),
      ]), TODAY);
      check(res, base + 3150 + 7293);
      const vat = res.batches.reduce((s, b) => s + b.breakdown.vat, 0);
      const duty = res.batches.reduce((s, b) => s + b.breakdown.duty, 0);
      expect(vat).toBeCloseTo(7293, 9);
      expect(duty).toBeCloseTo(3150, 9);
    });

    it('пошлина и НДС на декларации', () => {
      const res = computeCosting(declared([
        cost('d', 'declaration', 'd1', 'Пошлина', 3150),
        cost('v', 'declaration', 'd1', 'НДС', 7293, { status: 'plan', currency: 'CNY' }),
      ]), TODAY);
      expect(res.costsRub.find((c) => c.costId === 'v')?.rub).toBeNull();   // плановая в юанях без курса
      check(res, base + 3150);
    });
  });

  it('партий больше, чем количество позиции — BATCH_OVER_QTY, остатка нет', () => {
    const d = ds({
      orders: [ord('o1')], supplierOrders: [so('s1', 'o1', 'RUB')], lines: [ln('L1', 's1', 'o1', 100, 1)],
      shipments: [sh('sh1', 'air')], batches: [bt('b1', 'sh1', 'L1', 60), bt('b2', 'sh1', 'L1', 60)],
    });
    const res = computeCosting(d, TODAY);
    expect(refIds(res, 'BATCH_OVER_QTY')).toContain('L1');
    expect(lineOf(res, 'L1').unshippedQty).toBe(0);
    expect(res.batches.map((b) => b.batchId)).not.toContain('rest:L1');
  });

  it('provisional = !order.costsComplete; незакрытый заказ — NOT_COMPLETE', () => {
    const d = ds({
      orders: [ord('o1', { costsComplete: true }), ord('o2', { costsComplete: false })],
      supplierOrders: [so('s1', 'o1', 'RUB'), so('s2', 'o2', 'RUB')],
      lines: [ln('L1', 's1', 'o1', 1, 1), ln('L2', 's2', 'o2', 1, 1)],
    });
    const res = computeCosting(d, TODAY);
    expect(lineOf(res, 'L1').provisional).toBe(false);
    expect(lineOf(res, 'L2').provisional).toBe(true);
    expect(refIds(res, 'NOT_COMPLETE')).toEqual(['o2']);
  });
});

describe('итоги заказа', () => {
  it('суммы по валютам, ₽ по курсу расчёта, прогноз через AD, план и факт затрат', () => {
    const d = ds({
      orders: [ord('o1')],
      supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10 }), so('s2', 'o1', 'USD', { calcRate: 80 })],
      lines: [
        ln('L1', 's1', 'o1', 100, 10, { coef: 1.5 }),
        ln('L4', 's2', 'o1', 10, 25, { coef: 2 }),
        ln('Lx', 's1', 'o1', 5, 1000, { purchased: false, coef: 9 }),
      ],
      costs: [cost('f', 'order', 'o1', 'Аванс', 3000), cost('p', 'supplierOrder', 's1', 'Комиссия банка', 1000, { status: 'plan' })],
    });
    const res = computeCosting(d, TODAY);
    const t = res.orders.find((o) => o.orderId === 'o1');
    expect(t?.sumByCurrency).toEqual({ CNY: 1000, USD: 250 });
    expect(t?.rubAtCalc).toBeCloseTo(30000, 9);
    expect(t?.forecastRub).toBeCloseTo(55000, 9);   // 10 000 × 1,5 + 20 000 × 2
    expect(t?.planRub).toBeCloseTo(1000, 9);
    expect(t?.factRub).toBeCloseTo(3000, 9);
    expect(t?.costTotal).toBeCloseTo(4000, 9);
  });
});

describe('AD поставщика в заказе (G05)', () => {
  // Поставщик s1 (CNY, курс 10, AD 1.6): A — 100 шт × 10 без своего AD, B — 100 шт × 30 со своим AD 2.
  // Поставщик s2 (USD, курс 80, без AD): C — 10 шт × 25 без AD.
  const d = () => ds({
    orders: [ord('o1')],
    supplierOrders: [so('s1', 'o1', 'CNY', { calcRate: 10, coef: 1.6 }), so('s2', 'o1', 'USD', { calcRate: 80 })],
    lines: [ln('A', 's1', 'o1', 100, 10), ln('B', 's1', 'o1', 100, 30, { coef: 2 }), ln('C', 's2', 'o1', 10, 25)],
  });

  it('позиция без своего AD берёт AD поставщика: AD = 1.6, AB = 10 · 10 · 1.6 = 160', () => {
    const a = lineOf(computeCosting(d(), TODAY), 'A');
    expect(a.AD).toBe(1.6);
    expect(a.AB).toBeCloseTo(160, 9);
  });

  it('позиция со своим AD — свой: AD = 2, AB = 30 · 10 · 2 = 600', () => {
    const b = lineOf(computeCosting(d(), TODAY), 'B');
    expect(b.AD).toBe(2);
    expect(b.AB).toBeCloseTo(600, 9);
  });

  it('нет AD ни у позиции, ни у поставщика — AD и AB пустые', () => {
    const c = lineOf(computeCosting(d(), TODAY), 'C');
    expect(c.AD).toBeNull();
    expect(c.AB).toBeNull();
  });

  it('прогноз заказа — по действующему AD: 10 000 × 1,6 + 30 000 × 2 = 76 000', () => {
    const t = computeCosting(d(), TODAY).orders.find((o) => o.orderId === 'o1');
    expect(t?.forecastRub).toBeCloseTo(76000, 9);
  });
});

describe('категории типов затрат', () => {
  it('стандартные типы и незнакомые по ключевому слову', () => {
    expect(costCategory('Аванс')).toBe('goods');
    expect(costCategory('комиссия агента')).toBe('commission');
    expect(costCategory('Доставка')).toBe('delivery');
    expect(costCategory('Брокер')).toBe('shipmentOther');
    expect(costCategory('Пошлина')).toBe('duty');
    expect(costCategory('НДС')).toBe('vat');
    expect(costCategory('Растаможка/сборы')).toBe('customsFees');
    expect(costCategory('Доставка авиа до Москвы')).toBe('delivery');
    expect(costCategory('Что-то своё')).toBe('other');
  });
});

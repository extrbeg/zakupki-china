import { describe, expect, it } from 'vitest';
import { computeCosting } from '../../src/domain/costing';
import { costSharesByOrder, costUnallocatedRub, orderShipmentShares, shipmentCostsOf } from '../../src/domain/costShares';
import {
  emptyDataset, type Batch, type Cost, type CostTargetType, type Dataset, type Line, type Shipment,
} from '../../src/domain/model';

const TODAY = '2026-10-25';
const cost = (id: string, targetType: CostTargetType, targetId: string, costType: string, amount: number, extra: Partial<Cost> = {}): Cost =>
  ({ id, entryDate: '2026-10-01', status: 'fact', targetType, targetId, costType, amount, currency: 'RUB', rateManual: false, ...extra });
const ln = (id: string, orderId: string, soId: string, qty: number, unitPrice: number, extra: Partial<Line> = {}): Line =>
  ({ id, orderId, supplierOrderId: soId, seq: 1, qty, unitPrice, purchased: true, ...extra });
const bt = (id: string, shipmentId: string, lineId: string, qty: number, extra: Partial<Batch> = {}): Batch => ({ id, shipmentId, lineId, qty, ...extra });

// Два заказа в одной поставке. З-2026-001: позиция A, 100 шт, партия 6 CBM / 300 кг.
// З-2026-002: позиция B, 200 шт, партия 4 CBM / 900 кг (и ещё 100 шт B — неотгруженный остаток).
function twoOrders(ship: Partial<Shipment>, costs: Cost[], more: Partial<Dataset> = {}): Dataset {
  return {
    ...emptyDataset(),
    orders: [
      { id: 'o1', number: 1, code: 'З-2026-001', date: '2026-09-01', costsComplete: false },
      { id: 'o2', number: 2, code: 'З-2026-002', date: '2026-09-02', costsComplete: false },
    ],
    supplierOrders: [
      { id: 's1', orderId: 'o1', seq: 1, supplierId: 'sup', currency: 'RUB' },
      { id: 's2', orderId: 'o2', seq: 1, supplierId: 'sup', currency: 'RUB' },
    ],
    lines: [ln('A', 'o1', 's1', 100, 10), ln('B', 'o2', 's2', 300, 10)],
    shipments: [{ id: 'sh1', number: 'П-2026-001', mode: 'sea_container', vatRate: 20, ...ship }],
    batches: [bt('b1', 'sh1', 'A', 100, { cbm: 6, weight: 300 }), bt('b2', 'sh1', 'B', 200, { cbm: 4, weight: 900 })],
    costs,
    ...more,
  };
}

const shares = (d: Dataset, costId: string) => costSharesByOrder(d, computeCosting(d, TODAY), costId);

describe('costSharesByOrder — доли затраты поставки по заказам (G31)', () => {
  it('доставка контейнера — по CBM: 6 и 4 CBM → 60 % и 40 % от 10 000 ₽', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)]);
    const s = shares(d, 'c1');
    expect(s.map((x) => x.orderId)).toEqual(['o1', 'o2']);
    expect(s[0].rub).toBeCloseTo(6000, 9);
    expect(s[0].pct).toBeCloseTo(60, 9);
    expect(s[1].rub).toBeCloseTo(4000, 9);
    expect(s[1].pct).toBeCloseTo(40, 9);
  });

  it('доставка авиа — по весу: 300 и 900 кг → 25 % и 75 %', () => {
    const d = twoOrders({ mode: 'air', typeId: 'stp_air' }, [cost('c1', 'shipment', 'sh1', 'Доставка', 8000)]);
    const s = shares(d, 'c1');
    expect(s[0]).toMatchObject({ orderId: 'o1' });
    expect(s[0].rub).toBeCloseTo(2000, 9);
    expect(s[0].pct).toBeCloseTo(25, 9);
    expect(s[1].rub).toBeCloseTo(6000, 9);
    expect(s[1].pct).toBeCloseTo(75, 9);
  });

  it('прочие затраты контейнера (СВХ) — по весу, не по CBM', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'shipment', 'sh1', 'СВХ', 1200)]);
    const s = shares(d, 'c1');
    expect(s[0].rub).toBeCloseTo(300, 9);
    expect(s[1].rub).toBeCloseTo(900, 9);
  });

  it('две партии одного заказа складываются в одну долю; сумма долей = рубли затраты', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'shipment', 'sh1', 'Доставка', 10000)], {
      lines: [ln('A', 'o1', 's1', 100, 10), ln('A2', 'o1', 's1', 50, 10), ln('B', 'o2', 's2', 300, 10)],
      batches: [
        bt('b1', 'sh1', 'A', 100, { cbm: 3, weight: 100 }), bt('b3', 'sh1', 'A2', 50, { cbm: 3, weight: 200 }),
        bt('b2', 'sh1', 'B', 200, { cbm: 4, weight: 900 }),
      ],
    });
    const s = shares(d, 'c1');
    expect(s).toHaveLength(2);
    expect(s[0].rub).toBeCloseTo(6000, 9);
    expect(s.reduce((a, x) => a + x.rub, 0)).toBeCloseTo(10000, 9);
  });

  it('затрата в валюте — доли в рублях по курсу затраты', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'shipment', 'sh1', 'Доставка', 1000, { currency: 'USD', rate: 80, rateDate: '2026-10-01' })]);
    const s = shares(d, 'c1');
    expect(s[0].rub).toBeCloseTo(48000, 9);
    expect(s[1].rub).toBeCloseTo(32000, 9);
  });

  it('декларация — по таможенной стоимости партий: 1000 и 2000 ₽ → треть и две трети', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'declaration', 'd1', 'Растаможка/сборы', 3000)], {
      declarations: [{ id: 'd1', shipmentId: 'sh1' }],
      batches: [bt('b1', 'sh1', 'A', 100, { cbm: 6, weight: 300, declarationId: 'd1' }), bt('b2', 'sh1', 'B', 200, { cbm: 4, weight: 900, declarationId: 'd1' })],
    });
    const s = shares(d, 'c1');
    expect(s[0].rub).toBeCloseTo(1000, 9);
    expect(s[1].rub).toBeCloseTo(2000, 9);
  });

  it('пустая поставка — долей нет, вся затрата нераспределена', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [cost('c1', 'shipment', 'sh1', 'Доставка', 5000)], { batches: [] });
    const res = computeCosting(d, TODAY);
    expect(costSharesByOrder(d, res, 'c1')).toEqual([]);
    expect(costUnallocatedRub(d, res, 'c1')).toBeCloseTo(5000, 9);
  });

  it('затрата на заказ — вся на этот заказ (100 %); неизвестная затрата — пусто', () => {
    const d = twoOrders({}, [cost('c1', 'order', 'o2', 'Прочее', 700)]);
    const s = shares(d, 'c1');
    expect(s).toHaveLength(1);
    expect(s[0].orderId).toBe('o2');
    expect(s[0].rub).toBeCloseTo(700, 9);
    expect(s[0].pct).toBeCloseTo(100, 9);
    expect(shares(d, 'nope')).toEqual([]);
  });
});

describe('доли поставок, легшие на заказ', () => {
  it('затраты поставки и её декларации; доля заказа — по каждой затрате', () => {
    const d = twoOrders({ typeId: 'stp_sea' }, [
      cost('c1', 'shipment', 'sh1', 'Доставка', 10000),
      cost('c2', 'declaration', 'd1', 'Растаможка/сборы', 3000),
      cost('c3', 'order', 'o1', 'Прочее', 100),
    ], {
      declarations: [{ id: 'd1', shipmentId: 'sh1' }],
      batches: [bt('b1', 'sh1', 'A', 100, { cbm: 6, weight: 300, declarationId: 'd1' }), bt('b2', 'sh1', 'B', 200, { cbm: 4, weight: 900, declarationId: 'd1' })],
    });
    expect(shipmentCostsOf(d, 'sh1').map((c) => c.id)).toEqual(['c1', 'c2']);
    const res = computeCosting(d, TODAY);
    const rows = orderShipmentShares(d, res, 'o1');
    expect(rows.map((r) => r.cost.id)).toEqual(['c1', 'c2']);
    expect(rows[0].shipmentId).toBe('sh1');
    expect(rows[0].rub).toBeCloseTo(6000, 9);
    expect(rows[1].rub).toBeCloseTo(1000, 9);
    expect(rows[1].pct).toBeCloseTo(100 / 3, 9);
  });
});

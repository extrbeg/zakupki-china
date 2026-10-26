import { describe, expect, it } from 'vitest';
import { computeCosting } from '../../../src/domain/costing';
import { emptyDataset, type Cost, type Dataset } from '../../../src/domain/model';
import { buildReportRows, buildRows, deviationPct, selectionTotals, selectionWarnings } from '../../../src/ui/screens/costing/costingLogic';

const TODAY = '2026-10-25';

const fact = (id: string, targetType: Cost['targetType'], targetId: string, amount: number): Cost => ({
  id, entryDate: '2026-10-01', status: 'fact', targetType, targetId, costType: 'Прочее', amount, currency: 'RUB', rateManual: false,
});

function dataset(): Dataset {
  return {
    ...emptyDataset(),
    rates: [{ id: 'r1', date: '2026-10-01', currency: 'CNY', rate: 10, source: 'vtb' }],
    suppliers: [{ id: 's1', name: 'Alpha Valve' }],
    orders: [
      { id: 'o12', number: 12, date: '2026-09-01', calcDate: '2026-10-01', costsComplete: false },
      { id: 'o6', number: 6, date: '2026-08-01', calcDate: '2026-10-01', costsComplete: true },
    ],
    supplierOrders: [
      { id: 'so12', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'CNY' },
      { id: 'so6', orderId: 'o6', seq: 1, supplierId: 's1', currency: 'CNY' },
    ],
    lines: [
      { id: 'l12', orderId: 'o12', supplierOrderId: 'so12', seq: 1, customerName: 'Кран', qty: 100, unitPrice: 5, purchased: true, coef: 1.5 },
      { id: 'l12b', orderId: 'o12', supplierOrderId: 'so12', seq: 2, customerName: 'Не куплен', qty: 5, unitPrice: 1, purchased: false },
      { id: 'l6', orderId: 'o6', supplierOrderId: 'so6', seq: 1, customerName: 'Кабель', qty: 10, unitPrice: 10, purchased: true, coef: 2 },
    ],
    shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container', vatRate: 22 }],
    batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l12', qty: 60 }],
    costs: [fact('c1', 'line', 'l12', 7500), fact('c2', 'line', 'l6', 100), { ...fact('c3', 'order', 'o12', 5000), costType: 'Предоплата 100 %' }],
  };
}

describe('deviationPct — отклонение AW от AD', () => {
  it('AW больше AD — положительное (хуже), меньше — отрицательное (лучше)', () => {
    expect(deviationPct(1.8, 1.5)).toBeCloseTo(20, 6);
    expect(deviationPct(1.2, 1.5)).toBeCloseTo(-20, 6);
  });
  it('нет AW или AD (или AD = 0) — null', () => {
    expect(deviationPct(null, 1.5)).toBeNull();
    expect(deviationPct(1.5, null)).toBeNull();
    expect(deviationPct(1.5, 0)).toBeNull();
  });
});

describe('buildRows', () => {
  it('строка на каждую закупаемую позицию выбранных заказов, по номеру заказа', () => {
    const ds = dataset();
    const rows = buildRows(ds, computeCosting(ds, TODAY), new Set(['o12', 'o6']));
    expect(rows.map((r) => r.line.id)).toEqual(['l6', 'l12']);
  });

  it('выбран один заказ — только его позиции; с партиями, включая неотгруженный остаток', () => {
    const ds = dataset();
    const rows = buildRows(ds, computeCosting(ds, TODAY), new Set(['o12']));
    expect(rows).toHaveLength(1);
    expect(rows[0].supplier?.name).toBe('Alpha Valve');
    expect(rows[0].batches.map((b) => [b.virtual, b.qty])).toEqual([[false, 60], [true, 40]]);
  });

  it('отклонение считается от AD и AW строки: 125 / 50 = 2.5 против 1.5 → +66.67 %', () => {
    const ds = dataset();
    const [row] = buildRows(ds, computeCosting(ds, TODAY), new Set(['o12']));
    expect(row.deviationPct).toBeCloseTo(66.6667, 3);
  });

  it('выбор — только фильтр показа: себестоимость позиции не зависит от выбранных заказов (R18.1)', () => {
    const ds = dataset();
    const costing = computeCosting(ds, TODAY);
    const one = buildRows(ds, costing, new Set(['o12']))[0].cost.total;
    const both = buildRows(ds, costing, new Set(['o12', 'o6'])).find((r) => r.line.id === 'l12')!.cost.total;
    expect(one).toBe(both);
  });
});

describe('selectionTotals', () => {
  it('суммирует только выбранные строки; разбивка по категориям', () => {
    const ds = dataset();
    const costing = computeCosting(ds, TODAY);
    const sel = new Set(['o12']);
    const t = selectionTotals(costing, buildRows(ds, costing, sel), sel);
    expect(t.lines).toBe(1);
    expect(t.total).toBeCloseTo(12500, 6);          // оплата товара 5000 + прямые 7500
    expect(t.breakdown.goods).toBeCloseTo(5000, 6);
    expect(t.breakdown.direct).toBeCloseTo(7500, 6);   // затрата на позицию — «Прямые»
    expect(t.forecastRub).toBeCloseTo(7500, 6);     // AB = 50 × 1.5 = 75 за шт. × 100
  });
});

describe('selectionWarnings', () => {
  it('показывает предупреждения выбранных заказов со ссылкой на заказ, чужие скрыты', () => {
    const ds = dataset();
    const costing = computeCosting(ds, TODAY);
    // o12 не закрыт → NOT_COMPLETE; o6 закрыт — предупреждения нет. Добавим закрытому заказу свою проблему.
    const w12 = selectionWarnings(ds, costing, new Set(['o12']));
    const notComplete = w12.find((w) => w.warning.code === 'NOT_COMPLETE');
    expect(notComplete?.links).toEqual([{ to: '/orders/o12', label: 'Заказ № 12' }]);
    expect(selectionWarnings(ds, costing, new Set(['o6'])).some((w) => w.warning.code === 'NOT_COMPLETE')).toBe(false);
  });

  it('предупреждение про поставку с партией выбранного заказа ведёт на поставку', () => {
    const ds = dataset();
    ds.costs.push({ ...fact('cs', 'shipment', 'sh1', 600), status: 'plan', costType: 'Доставка' });
    const costing = computeCosting(ds, TODAY);
    const ws = selectionWarnings(ds, costing, new Set(['o12'])).filter((w) => w.links.some((l) => l.to === '/shipments/sh1'));
    expect(ws.length).toBeGreaterThan(0);
    expect(selectionWarnings(ds, costing, new Set(['o6'])).some((w) => w.links.some((l) => l.to === '/shipments/sh1'))).toBe(false);
  });
});

describe('buildReportRows — лист «Себестоимость»', () => {
  const build = () => {
    const ds = dataset();
    const costing = computeCosting(ds, TODAY);
    const sel = new Set(['o12', 'o6']);
    return buildReportRows(ds, buildRows(ds, costing, sel), sel, TODAY);
  };

  it('шапка: дата расчёта и выбранные заказы', () => {
    const rows = build();
    expect(rows.find((r) => r[0] === 'Дата расчёта')).toEqual(['Дата расчёта', '2026-10-25']);
    expect(rows.find((r) => r[0] === 'Заказы')).toEqual(['Заказы', '6, 12']);
  });

  it('строка позиции: числа округлены до 2 знаков, незакрытый заказ помечен предварительно', () => {
    const rows = build();
    const head = rows.findIndex((r) => r[0] === 'Заказ');
    expect(head).toBeGreaterThan(0);
    const cols = rows[head] as string[];
    const line = rows.slice(head + 1).find((r) => r[cols.indexOf('Позиция')] === 'Кран')!;
    expect(line[cols.indexOf('Себестоимость позиции, ₽')]).toBe(12500);
    expect(line[cols.indexOf('AV, ₽/шт')]).toBe(125);
    expect(line[cols.indexOf('AW')]).toBe(2.5);
    expect(line[cols.indexOf('AD')]).toBe(1.5);
    expect(line[cols.indexOf('Отклонение, %')]).toBe(66.67);
    expect(line[cols.indexOf('Статус')]).toBe('предварительно');
    const closed = rows.slice(head + 1).find((r) => r[cols.indexOf('Позиция')] === 'Кабель')!;
    expect(closed[cols.indexOf('Статус')]).toBe('закрыт');
  });
});

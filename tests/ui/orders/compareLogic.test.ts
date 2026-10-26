// Матрица «Сравнение цен» (истории 78–80): группировка товаров, пустые ячейки, лучший прогноз, итоги по выбранным и по всем.
import { describe, expect, it } from 'vitest';
import { emptyDataset, type Dataset, type Line } from '../../../src/domain/model';
import { buildCompareMatrix } from '../../../src/ui/screens/orders/compareLogic';

const line = (id: string, so: string, seq: number, name: string | undefined, qty: number, unitPrice: number, purchased = false): Line =>
  ({ id, orderId: 'o1', supplierOrderId: so, seq, customerName: name, qty, unitPrice, purchased });

/** Заказ 7, расчёт 01.10: CNY = 10. 7-1 AD 1,5; 7-2 AD 1,2. */
const ds = (lines: Line[]): Dataset => ({
  ...emptyDataset(),
  rates: [{ id: 'r', date: '2026-10-01', currency: 'CNY', rate: 10, source: 'vtb' }],
  suppliers: [{ id: 's1', name: 'Alpha' }, { id: 's2', name: 'Beta' }],
  orders: [{ id: 'o1', number: 7, date: '2026-09-01', calcDate: '2026-10-01', costsComplete: false }],
  supplierOrders: [
    { id: 'b', orderId: 'o1', seq: 2, supplierId: 's2', currency: 'CNY', coef: 1.2 },
    { id: 'a', orderId: 'o1', seq: 1, supplierId: 's1', currency: 'CNY', coef: 1.5 },
  ],
  lines,
});

describe('buildCompareMatrix', () => {
  it('группирует по названию от заказчика без учёта регистра и крайних пробелов; колонки — поставщики по порядку', () => {
    const m = buildCompareMatrix(ds([
      line('a1', 'a', 1, 'Кран DN50', 10, 10),
      line('b1', 'b', 1, '  кран dn50 ', 10, 11),
      line('b2', 'b', 2, 'Фланец', 5, 2),
    ]), ds([]).orders[0], '2026-10-25');
    expect(m.columns.map((c) => c.code)).toEqual(['7-1', '7-2']);
    expect(m.columns.map((c) => c.supplierName)).toEqual(['Alpha', 'Beta']);
    expect(m.rows.map((r) => r.title)).toEqual(['Кран DN50', 'Фланец']);
    expect(m.rows[0].cells.a.map((o) => o.line.id)).toEqual(['a1']);
    expect(m.rows[0].cells.b.map((o) => o.line.id)).toEqual(['b1']);
    expect(m.rows[1].cells.a ?? []).toEqual([]);
  });

  it('пустое название — своя строка на каждую позицию; две позиции с одним названием у поставщика — обе в ячейке', () => {
    const m = buildCompareMatrix(ds([
      line('a1', 'a', 1, '', 1, 1),
      line('a2', 'a', 2, undefined, 1, 1),
      line('b1', 'b', 1, 'Болт', 100, 1),
      line('b2', 'b', 2, 'болт', 200, 0.9),
    ]), ds([]).orders[0], '2026-10-25');
    expect(m.rows).toHaveLength(3);
    expect(m.rows.filter((r) => (r.cells.a ?? []).length === 1)).toHaveLength(2);
    expect(m.rows.find((r) => r.title === 'Болт')?.cells.b.map((o) => o.line.id)).toEqual(['b1', 'b2']);
  });

  it('прогноз ₽/шт по действующему AD; лучший — минимальный прогноз в строке; итоги по выбранным и по всем', () => {
    // a1: Y 100, AB 150 (AD 1,5); b1: Y 110, AB 132 (AD 1,2) → лучший b1, хотя цена выше
    const m = buildCompareMatrix(ds([
      line('a1', 'a', 1, 'Кран', 10, 10, true),
      line('b1', 'b', 1, 'кран', 10, 11),
      line('b2', 'b', 2, 'Фланец', 5, 2, true),
    ]), ds([]).orders[0], '2026-10-25');
    const [a1] = m.rows[0].cells.a;
    const [b1] = m.rows[0].cells.b;
    expect([a1.Y, a1.AB, a1.best]).toEqual([100, 150, false]);
    expect(b1.Y).toBeCloseTo(110, 9);
    expect(b1.AB).toBeCloseTo(132, 9);
    expect(b1.best).toBe(true);
    expect(m.totals.b.selected).toMatchObject({ count: 1, X: 10 });
    expect(m.totals.b.selected.forecast).toBeCloseTo(120, 9);   // b2: 20 ₽ × 1,2 × 5
    expect(m.totals.b.all).toMatchObject({ count: 2, X: 120 });
    expect(m.totals.b.all.forecast).toBeCloseTo(1440, 9);       // 132 × 10 + 120
    expect(m.order.sumByCurrency).toEqual({ CNY: 110 });         // a1 100 + b2 10
    expect(m.order.forecast).toBeCloseTo(1620, 9);               // 1500 + 120
  });

  it('isSelected подменяет флаг (ещё не записанный выбор)', () => {
    const m = buildCompareMatrix(ds([line('a1', 'a', 1, 'Кран', 10, 10, true)]), ds([]).orders[0], '2026-10-25', () => false);
    expect(m.rows[0].cells.a[0].selected).toBe(false);
    expect(m.totals.a.selected.count).toBe(0);
    expect(m.order.sumByCurrency).toEqual({});
  });
});

import { describe, expect, it } from 'vitest';
import { computeCosting, suggestCoef } from '../../src/domain/costing';
import { emptyDataset, type Cost, type Dataset, type Line, type Order, type ShipmentMode, type SupplierOrder } from '../../src/domain/model';

// Каждый заказ — один поставщик RUB, одна позиция 10 шт × 100 ₽ (Y = 100) и затрата на позицию:
// AW = затрата / 10 / 100, т. е. затрата 1500 → AW 1,5.
function history(rows: { supplierId: string; mode?: ShipmentMode; aw: number; complete?: boolean }[]): Dataset {
  const orders: Order[] = [];
  const sos: SupplierOrder[] = [];
  const lines: Line[] = [];
  const costs: Cost[] = [];
  rows.forEach((r, i) => {
    orders.push({ id: `o${i}`, number: i + 1, date: '2026-01-01', costsComplete: r.complete ?? true });
    sos.push({ id: `s${i}`, orderId: `o${i}`, seq: 1, supplierId: r.supplierId, currency: 'RUB', plannedMode: r.mode });
    lines.push({ id: `l${i}`, orderId: `o${i}`, supplierOrderId: `s${i}`, seq: 1, qty: 10, unitPrice: 100, purchased: true });
    costs.push({ id: `c${i}`, entryDate: '2026-01-01', status: 'fact', targetType: 'line', targetId: `l${i}`, costType: 'Прочее', amount: r.aw * 1000, currency: 'RUB', rateManual: false });
  });
  return { ...emptyDataset(), orders, supplierOrders: sos, lines, costs };
}

const suggest = (d: Dataset, supplierId: string, mode: ShipmentMode | undefined) => suggestCoef(d, computeCosting(d, '2026-10-25'), supplierId, mode);

describe('suggestCoef', () => {
  const d = history([
    { supplierId: 'A', mode: 'sea_container', aw: 1.4 },
    { supplierId: 'A', mode: 'sea_container', aw: 1.6 },
    { supplierId: 'A', mode: 'sea_container', aw: 1.5 },
    { supplierId: 'A', mode: 'air', aw: 3.0 },
    { supplierId: 'B', mode: 'sea_container', aw: 2.0 },
    { supplierId: 'B', mode: 'air', aw: 2.2 },
    { supplierId: 'A', mode: 'sea_container', aw: 9.9, complete: false },   // незакрытый — не считается
  ]);

  it('поставщик + тип доставки, если там не меньше 3 точек — медиана', () => {
    expect(suggest(d, 'A', 'sea_container')).toEqual({ value: expect.closeTo(1.5, 9), basis: 'supplier+mode', points: 3 });
  });

  it('у поставщика мало точек — тот же тип доставки по всем поставщикам', () => {
    const r = suggest(d, 'B', 'sea_container');   // 1.4, 1.6, 1.5, 2.0 → медиана 1.55
    expect(r.basis).toBe('mode');
    expect(r.points).toBe(4);
    expect(r.value).toBeCloseTo(1.55, 9);
  });

  it('мало точек по типу — все закрытые позиции', () => {
    const r = suggest(d, 'B', 'air');   // 1.4 1.5 1.6 3.0 2.0 2.2 → медиана (1.6 + 2.0) / 2
    expect(r.basis).toBe('all');
    expect(r.points).toBe(6);
    expect(r.value).toBeCloseTo(1.8, 9);
  });

  it('тип доставки не задан — сразу по всем', () => {
    expect(suggest(d, 'A', undefined).basis).toBe('all');
  });

  it('меньше 3 точек всего — value null, basis none', () => {
    const few = history([{ supplierId: 'A', aw: 1.5 }, { supplierId: 'A', aw: 1.7 }, { supplierId: 'A', aw: 2, complete: false }]);
    expect(suggest(few, 'A', undefined)).toEqual({ value: null, basis: 'none', points: 2 });
  });
});

import { describe, expect, it } from 'vitest';
import type { Cost, Dataset, Order, Shipment } from '../../src/domain/model';
import { emptyDataset } from '../../src/domain/model';
import {
  costCodePrefix, costCodeTaken, nextCostCode, nextOrderCode, nextShipmentCode, orderLabel, orderRef, planCostCodes, shipmentCodeYear,
} from '../../src/domain/numbering';
import { validateOrderNumberUnique } from '../../src/domain/validation';

const order = (id: string, number: number, date: string, code?: string): Order => ({ id, number, date, costsComplete: false, ...(code ? { code } : {}) });
const shipment = (id: string, number: string, extra: Partial<Shipment> = {}): Shipment => ({ id, number, mode: 'sea_container', vatRate: 22, ...extra });
const cost = (id: string, targetType: Cost['targetType'], targetId: string, extra: Partial<Cost> = {}): Cost =>
  ({ id, entryDate: '2026-10-01', status: 'fact', targetType, targetId, costType: 'Прочее', currency: 'RUB', rateManual: false, ...extra });

describe('номер заказа З-ГГГГ-NNN (G33)', () => {
  it('первый заказ года — 001, с ведущими нулями', () => {
    expect(nextOrderCode([], '2026-10-27')).toEqual({ code: 'З-2026-001', number: 1 });
  });

  it('следующий после наибольшего номера заказов этого года, включая старые без кода', () => {
    const orders = [order('a', 30, '2025-12-20'), order('b', 31, '2026-01-10'), order('c', 40, '2026-06-01')];
    expect(nextOrderCode(orders, '2026-10-27')).toEqual({ code: 'З-2026-041', number: 41 });
  });

  it('пропуски не заполняются: 001 и 005 → 006', () => {
    const orders = [order('a', 1, '2026-01-10', 'З-2026-001'), order('b', 5, '2026-02-10', 'З-2026-005')];
    expect(nextOrderCode(orders, '2026-03-01').code).toBe('З-2026-006');
  });

  it('смена года — снова 001; год заказа с кодом — по коду', () => {
    const orders = [order('a', 41, '2026-12-30', 'З-2026-041'), order('b', 7, '2027-01-02', 'З-2026-007')];
    expect(nextOrderCode(orders, '2027-01-05')).toEqual({ code: 'З-2027-001', number: 1 });
    expect(nextOrderCode(orders, '2026-12-31').code).toBe('З-2026-042');
  });

  it('номер заказа — дата-serial (старая таблица, 46039) не сдвигает счётчик года', () => {
    const orders = [order('a', 46039, '2026-01-17'), order('b', 31, '2026-02-01'), order('c', 12, '2026-03-01')];
    expect(nextOrderCode(orders, '2026-10-27')).toEqual({ code: 'З-2026-032', number: 32 });
    expect(nextOrderCode([order('a', 46039, '2026-01-17')], '2026-10-27').code).toBe('З-2026-001');
  });

  it('номер больше 999 — без обрезки', () => {
    expect(nextOrderCode([order('a', 999, '2026-05-01')], '2026-06-01').code).toBe('З-2026-1000');
  });

  it('показ: код, у старого заказа — прежний номер', () => {
    expect(orderLabel(order('a', 32, '2026-01-01'))).toBe('32');
    expect(orderLabel(order('a', 41, '2026-01-01', 'З-2026-041'))).toBe('З-2026-041');
    expect(orderRef(order('a', 32, '2026-01-01'))).toBe('№ 32');
    expect(orderRef(order('a', 41, '2026-01-01', 'З-2026-041'))).toBe('З-2026-041');
  });

  it('уникальность (в тексте — занявший номер заказ): тот же код — ошибка; тот же NNN в другом году — нет; старый номер с тем же числом в том же году — ошибка', () => {
    const orders = [order('a', 5, '2025-03-01'), order('b', 41, '2026-02-01', 'З-2026-041')];
    expect(validateOrderNumberUnique({ orders }, { id: 'x', number: 41, code: 'З-2026-041', date: '2026-10-01' })).toEqual({ number: 'Заказ З-2026-041 уже есть' });
    expect(validateOrderNumberUnique({ orders }, { id: 'x', number: 5, code: 'З-2026-005', date: '2026-10-01' })).toEqual({});
    expect(validateOrderNumberUnique({ orders }, { id: 'x', number: 5, code: 'З-2025-005', date: '2026-10-01' })).toEqual({ number: 'Заказ № 5 уже есть' });
    expect(validateOrderNumberUnique({ orders }, { id: 'b', number: 41, code: 'З-2026-041', date: '2026-02-01' })).toEqual({});
  });
});

describe('номер поставки П-ГГГГ-NNN (G28)', () => {
  it('первая в году — П-ГГГГ-001; дальше — после наибольшего этого года', () => {
    expect(nextShipmentCode([], 2026)).toBe('П-2026-001');
    const list = [shipment('a', 'П-2026-001'), shipment('b', 'П-2026-004'), shipment('c', 'П-2025-017')];
    expect(nextShipmentCode(list, 2026)).toBe('П-2026-005');
    expect(nextShipmentCode(list, 2025)).toBe('П-2025-018');
    expect(nextShipmentCode(list, 2027)).toBe('П-2027-001');
  });

  it('старые номера другого вида не мешают', () => {
    expect(nextShipmentCode([shipment('a', '32-1'), shipment('b', 'Контейнер 7'), shipment('c', 'п-2026-002')], 2026)).toBe('П-2026-003');
  });

  it('год — по дате отправки в РФ, иначе по дате создания', () => {
    expect(shipmentCodeYear({ sentDate: '2027-01-15' }, '2026-12-20')).toBe(2027);
    expect(shipmentCodeYear({}, '2026-12-20')).toBe(2026);
  });
});

describe('номер затраты (G33)', () => {
  const ds = (): Dataset => ({
    ...emptyDataset(),
    orders: [order('o32', 32, '2026-03-01'), order('o41', 41, '2026-09-01', 'З-2026-041'), order('o7', 7, '2025-05-01')],
    supplierOrders: [{ id: 'so1', orderId: 'o41', seq: 1, supplierId: 's', currency: 'CNY' }],
    lines: [{ id: 'l1', orderId: 'o41', supplierOrderId: 'so1', seq: 1, qty: 1, unitPrice: 1, purchased: true }],
    shipments: [shipment('sh5', 'П-2026-005'), shipment('shOld', '32-1', { sentDate: '2025-11-02' })],
    declarations: [{ id: 'd1', shipmentId: 'sh5' }],
  });

  it('затрата на заказ, поставщика в заказе, позицию: год и номер заказа', () => {
    const d = ds();
    expect(costCodePrefix(d, { targetType: 'order', targetId: 'o32', entryDate: '2026-10-01' })).toBe('Р-2026-32-');
    expect(nextCostCode(d, { targetType: 'order', targetId: 'o32', entryDate: '2026-10-01' })).toBe('Р-2026-32-001');
    expect(nextCostCode(d, { targetType: 'supplierOrder', targetId: 'so1', entryDate: '2026-10-01' })).toBe('Р-2026-041-001');
    expect(nextCostCode(d, { targetType: 'line', targetId: 'l1', entryDate: '2026-10-01' })).toBe('Р-2026-041-001');
    expect(nextCostCode(d, { targetType: 'order', targetId: 'o7', entryDate: '2026-10-01' })).toBe('Р-2025-7-001');
  });

  it('затрата на поставку и декларацию: Р-ГГГГ-П<NNN>-NNN; старый номер поставки — как есть, год — по датам поставки', () => {
    const d = ds();
    expect(nextCostCode(d, { targetType: 'shipment', targetId: 'sh5', entryDate: '2026-10-01' })).toBe('Р-2026-П005-001');
    expect(nextCostCode(d, { targetType: 'declaration', targetId: 'd1', entryDate: '2026-10-01' })).toBe('Р-2026-П005-001');
    expect(nextCostCode(d, { targetType: 'shipment', targetId: 'shOld', entryDate: '2026-10-01' })).toBe('Р-2025-П32-1-001');
  });

  it('NNN — порядковый внутри заказа или поставки, после наибольшего', () => {
    const d = ds();
    d.costs = [
      cost('c1', 'order', 'o41', { code: 'Р-2026-041-001' }),
      cost('c2', 'line', 'l1', { code: 'Р-2026-041-003' }),
      cost('c3', 'order', 'o32', { code: 'Р-2026-32-009' }),
    ];
    expect(nextCostCode(d, { targetType: 'supplierOrder', targetId: 'so1', entryDate: '2026-10-01' })).toBe('Р-2026-041-004');
    expect(nextCostCode(d, { targetType: 'shipment', targetId: 'sh5', entryDate: '2026-10-01' })).toBe('Р-2026-П005-001');
  });

  it('привязка не найдена — кода нет', () => {
    expect(nextCostCode(ds(), { targetType: 'order', targetId: 'нет', entryDate: '2026-10-01' })).toBeNull();
  });

  it('существующим без кода — коды по порядку дат оплаты/заполнения, после уже проставленных; с кодом — не трогаются', () => {
    const d = ds();
    d.costs = [
      cost('late', 'order', 'o32', { paymentDate: '2026-05-10', entryDate: '2026-05-11' }),
      cost('coded', 'order', 'o32', { code: 'Р-2026-32-001', paymentDate: '2026-06-01' }),
      cost('early', 'order', 'o32', { paymentDate: '2026-04-01' }),
      cost('plan', 'order', 'o32', { status: 'plan', entryDate: '2026-04-15' }),
      cost('ship', 'declaration', 'd1', { paymentDate: '2026-10-02' }),
      cost('orphan', 'order', 'нет'),
    ];
    expect(planCostCodes(d)).toEqual([
      { id: 'early', code: 'Р-2026-32-002' },
      { id: 'plan', code: 'Р-2026-32-003' },
      { id: 'late', code: 'Р-2026-32-004' },
      { id: 'ship', code: 'Р-2026-П005-001' },
    ]);
  });

  it('уникальность кода — без учёта регистра и пробелов по краям, своя запись не в счёт', () => {
    const costs = [cost('c1', 'order', 'o32', { code: 'Р-2026-32-001' })];
    expect(costCodeTaken(costs, { id: 'c2', code: ' р-2026-32-001 ' })).toBe(true);
    expect(costCodeTaken(costs, { id: 'c1', code: 'Р-2026-32-001' })).toBe(false);
    expect(costCodeTaken(costs, { id: 'c2', code: 'Р-2026-32-002' })).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { validateBatchQty, validateLine, validateOrderNumberUnique } from '../../src/domain/validation';
import type { Batch, Line, Order } from '../../src/domain/model';

const line: Line = { id: 'L1', orderId: 'o1', supplierOrderId: 's1', seq: 1, qty: 1000, unitPrice: 5, purchased: true };

describe('validateLine', () => {
  it('верная позиция — без ошибок', () => {
    expect(validateLine(line)).toEqual({});
    expect(validateLine({ ...line, unitPrice: 0 })).toEqual({});
  });

  it('кол-во должно быть больше нуля, цена — не меньше нуля', () => {
    expect(validateLine({ ...line, qty: 0 }).qty).toBe('Количество должно быть больше нуля');
    expect(validateLine({ ...line, qty: undefined }).qty).toBe('Количество должно быть больше нуля');
    expect(validateLine({ ...line, unitPrice: -1 }).unitPrice).toBe('Цена не может быть отрицательной');
    expect(validateLine({ ...line, unitPrice: undefined }).unitPrice).toBe('Укажите цену');
  });

  it('коэффициент AD больше нуля, пошлина от 0 до 100 %', () => {
    expect(validateLine({ ...line, coef: 0 }).coef).toBe('Коэффициент должен быть больше нуля');
    expect(validateLine({ ...line, dutyRate: 120 }).dutyRate).toBe('Пошлина — от 0 до 100 %');
  });
});

describe('validateBatchQty', () => {
  const b = (id: string, qty: number): Batch => ({ id, shipmentId: 'sh', lineId: 'L1', qty });

  it('сумма партий не больше количества позиции', () => {
    const ds = { lines: [line], batches: [b('b1', 700)] };
    expect(validateBatchQty(ds, b('b2', 300))).toEqual({});
    expect(validateBatchQty(ds, b('b2', 500))).toEqual({ qty: 'В партиях 1200 из 1000 шт' });
  });

  it('правка существующей партии заменяет её прежнее количество', () => {
    const ds = { lines: [line], batches: [b('b1', 700), b('b2', 300)] };
    expect(validateBatchQty(ds, b('b1', 600))).toEqual({});
    expect(validateBatchQty(ds, b('b1', 800))).toEqual({ qty: 'В партиях 1100 из 1000 шт' });
  });

  it('кол-во партии больше нуля', () => {
    expect(validateBatchQty({ lines: [line], batches: [] }, b('b1', 0))).toEqual({ qty: 'Количество должно быть больше нуля' });
  });
});

describe('validateOrderNumberUnique', () => {
  const orders: Order[] = [{ id: 'o1', number: 5, date: '2026-10-01', costsComplete: false }];
  it('номер заказа уникален; свой номер при правке — не ошибка', () => {
    expect(validateOrderNumberUnique({ orders }, { id: 'o2', number: 5 })).toEqual({ number: 'Заказ № 5 уже есть' });
    expect(validateOrderNumberUnique({ orders }, { id: 'o1', number: 5 })).toEqual({});
    expect(validateOrderNumberUnique({ orders }, { id: 'o2', number: 6 })).toEqual({});
  });
});

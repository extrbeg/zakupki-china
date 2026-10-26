import { describe, expect, it } from 'vitest';
import { calcRateFor, effectiveCalcDate, effectiveCoef, lineFigures } from '../../src/domain/lineFigures';
import { emptyDataset, type Line, type Order, type SupplierOrder } from '../../src/domain/model';

const line: Line = { id: 'ln_1', orderId: 'ord_1', supplierOrderId: 'so_1', seq: 1, qty: 720, unitPrice: 60, purchased: true, coef: 1.5 };
const order: Order = { id: 'ord_1', number: 1, date: '2026-09-10', costsComplete: false };
const so: SupplierOrder = { id: 'so_1', orderId: 'ord_1', seq: 1, supplierId: 'sup_1', currency: 'CNY' };

describe('lineFigures — формулы старой таблицы', () => {
  it('S=720, T=60, W=11.45, AD=1.5 → X=43200, Y=687, Z=494640, AB=1030.5', () => {
    const rate = { rate: 11.45, date: '2026-09-15', source: 'manual' as const, exact: true };
    const f = lineFigures(line, rate);
    expect(f.X).toBe(43200);
    expect(f.Y).toBeCloseTo(687, 9);
    expect(f.Z).toBeCloseTo(494640, 6);
    expect(f.AB).toBeCloseTo(1030.5, 9);
    expect(f.calcRate).toBe(rate);
  });

  it('нет курса — Y, Z, AB пустые; нет AD — AB пустой', () => {
    expect(lineFigures(line, null)).toEqual({ X: 43200, Y: null, Z: null, AB: null, calcRate: null });
    const noCoef = lineFigures({ ...line, coef: undefined }, { rate: 10, date: '2026-09-15', source: 'vtb', exact: true });
    expect(noCoef.Y).toBe(600);
    expect(noCoef.AB).toBeNull();
  });
});

describe('effectiveCalcDate', () => {
  it('дата поставщика → дата заказа → сегодня', () => {
    expect(effectiveCalcDate({ ...order, calcDate: '2026-10-01' }, { ...so, calcDate: '2026-10-05' }, '2026-10-25')).toBe('2026-10-05');
    expect(effectiveCalcDate({ ...order, calcDate: '2026-10-01' }, so, '2026-10-25')).toBe('2026-10-01');
    expect(effectiveCalcDate(order, so, '2026-10-25')).toBe('2026-10-25');
  });
});

describe('calcRateFor', () => {
  const ds = { ...emptyDataset(), rates: [
    { id: 'a', date: '2026-10-01', currency: 'CNY' as const, rate: 11.48, source: 'vtb' as const },
    { id: 'b', date: '2026-10-20', currency: 'CNY' as const, rate: 11.55, source: 'vtb' as const },
  ] };

  it('ручной курс поставщика в заказе важнее таблицы курсов', () => {
    expect(calcRateFor(ds, order, { ...so, calcRate: 11.45 }, '2026-10-25'))
      .toEqual({ rate: 11.45, date: '2026-10-25', source: 'manual', exact: true });
  });

  it('иначе — курс валюты поставщика на дату расчёта', () => {
    expect(calcRateFor(ds, { ...order, calcDate: '2026-10-01' }, so, '2026-10-25'))
      .toEqual({ rate: 11.48, date: '2026-10-01', source: 'vtb', exact: true });
    expect(calcRateFor(ds, order, so, '2026-10-25'))
      .toEqual({ rate: 11.55, date: '2026-10-20', source: 'vtb', exact: false });
  });

  it('валюта RUB — курс 1', () => {
    expect(calcRateFor(ds, order, { ...so, currency: 'RUB' }, '2026-10-25')?.rate).toBe(1);
  });
});

describe('effectiveCoef — действующий AD позиции (G05)', () => {
  it('у позиции нет своего AD — берётся AD поставщика в заказе', () => {
    expect(effectiveCoef({ ...line, coef: undefined }, { ...so, coef: 1.7 })).toBe(1.7);
  });

  it('свой AD позиции — переопределение AD поставщика', () => {
    expect(effectiveCoef(line, { ...so, coef: 1.7 })).toBe(1.5);
  });

  it('нет AD ни у позиции, ни у поставщика (или поставщика нет) — undefined', () => {
    expect(effectiveCoef({ ...line, coef: undefined }, so)).toBeUndefined();
    expect(effectiveCoef({ ...line, coef: undefined }, undefined)).toBeUndefined();
    expect(effectiveCoef(line, undefined)).toBe(1.5);
  });
});

describe('lineFigures с поставщиком в заказе — AB по действующему AD', () => {
  const rate = { rate: 10, date: '2026-09-15', source: 'manual' as const, exact: true };

  it('позиция без AD: AB = Y · AD поставщика (60 · 10 · 1.7 = 1020)', () => {
    expect(lineFigures({ ...line, coef: undefined }, rate, { ...so, coef: 1.7 }).AB).toBeCloseTo(1020, 9);
  });

  it('позиция со своим AD: AB = Y · свой AD (60 · 10 · 1.5 = 900)', () => {
    expect(lineFigures(line, rate, { ...so, coef: 1.7 }).AB).toBeCloseTo(900, 9);
  });

  it('нет AD ни у кого — AB пустой', () => {
    expect(lineFigures({ ...line, coef: undefined }, rate, so).AB).toBeNull();
  });
});

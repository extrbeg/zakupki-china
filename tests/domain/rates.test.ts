import { describe, expect, it } from 'vitest';
import { pickRate } from '../../src/domain/rates';
import type { Rate } from '../../src/domain/model';

const r = (date: string, currency: Rate['currency'], rate: number, source: Rate['source'] = 'vtb'): Rate =>
  ({ id: `r_${date}_${currency}_${source}_${rate}`, date, currency, rate, source });

const rates: Rate[] = [
  r('2026-10-20', 'CNY', 11.55),
  r('2026-10-20', 'CNY', 11.7, 'manual'),
  r('2026-10-20', 'USD', 82.7),
  r('2026-10-22', 'USD', 83.0),
  r('2026-10-24', 'CNY', 11.4),
  r('2026-10-23', 'CNY', 11.3, 'manual'),
];

describe('pickRate', () => {
  it('RUB — всегда 1, фиксированный', () => {
    expect(pickRate([], 'RUB', '2026-10-25')).toEqual({ rate: 1, date: '2026-10-25', source: 'fixed', exact: true });
  });

  it('ручной курс на дату важнее автоматического на ту же дату', () => {
    expect(pickRate(rates, 'CNY', '2026-10-20')).toEqual({ rate: 11.7, date: '2026-10-20', source: 'manual', exact: true });
  });

  it('автоматический курс на дату', () => {
    expect(pickRate(rates, 'USD', '2026-10-22')).toEqual({ rate: 83.0, date: '2026-10-22', source: 'vtb', exact: true });
  });

  it('на дату курса нет — последний до даты с exact:false и его датой', () => {
    expect(pickRate(rates, 'CNY', '2026-10-25')).toEqual({ rate: 11.4, date: '2026-10-24', source: 'vtb', exact: false });
    expect(pickRate(rates, 'USD', '2026-10-21')).toEqual({ rate: 82.7, date: '2026-10-20', source: 'vtb', exact: false });
  });

  it('курсов раньше даты нет — null; чужая валюта не подходит', () => {
    expect(pickRate(rates, 'CNY', '2026-10-19')).toBeNull();
    expect(pickRate(rates, 'EUR', '2026-10-25')).toBeNull();
  });

  it('курс из будущего не берётся', () => {
    expect(pickRate([r('2026-11-01', 'USD', 90)], 'USD', '2026-10-25')).toBeNull();
  });
});

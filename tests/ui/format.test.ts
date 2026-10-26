import { describe, expect, it } from 'vitest';
import { CURRENCY_LABEL, EMPTY, MODE_LABEL, formatDate, formatMoney, formatPct, formatQty, formatRate } from '../../src/ui/format';

const flat = (s: string) => s.replace(/ /g, ' ');

describe('ui/format — один модуль форматов', () => {
  it('деньги: 2 знака, разряды, минус «−»; пусто — «—»', () => {
    expect(flat(formatMoney(1234.5))).toBe('1 234,50');
    expect(flat(formatMoney(-0.5))).toBe('−0,50');
    expect(formatMoney(undefined)).toBe(EMPTY);
    expect(formatMoney(null)).toBe('—');
  });

  it('количество — до 3 знаков без разрядов; курс — 2–4 знака; процент со знаком', () => {
    expect(formatQty(1000)).toBe('1000');
    expect(formatQty(2.5)).toBe('2,5');
    expect(formatQty(undefined)).toBe('—');
    expect(formatRate(11.48)).toBe('11,48');
    expect(formatRate(92.12345)).toBe('92,1235');
    expect(formatPct(-20)).toBe('−20,0 %');
    expect(formatPct(10)).toBe('+10,0 %');
  });

  it('даты дд.мм.гггг; нет даты — «—»', () => {
    expect(formatDate('2026-10-08')).toBe('08.10.2026');
    expect(formatDate(undefined)).toBe('—');
  });

  it('одна версия подписей валют и типов доставки', () => {
    expect(CURRENCY_LABEL.CNY).toBe('юань (RMB)');
    expect(CURRENCY_LABEL.RUB).toBe('рубль (RUB)');
    expect(MODE_LABEL.sea_container).toBe('Море, контейнер');
  });
});

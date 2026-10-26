import { describe, expect, it } from 'vitest';
import { addDaysISO, bitrixTaskUrl, deviationPct, formatPct, nextOrderNumber, plannedReadyDate, suggestionText } from '../../../src/ui/screens/orders/orderLogic';

describe('orderLogic', () => {
  it('следующий номер: максимум + 1, для пустого списка — 1', () => {
    expect(nextOrderNumber([])).toBe(1);
    expect(nextOrderNumber([{ number: 3 }, { number: 12 }, { number: 6 }])).toBe(13);
  });

  it('ссылка Битрикс: без портала и без ID — нет; слэш в конце адреса не удваивается', () => {
    expect(bitrixTaskUrl('', '5')).toBeNull();
    expect(bitrixTaskUrl('https://b.ru', '')).toBeNull();
    expect(bitrixTaskUrl('https://b.ru//', '77')).toBe('https://b.ru/company/personal/user/0/tasks/task/view/77/');
  });

  it('готовность = запуск + срок, через границу месяца и года', () => {
    expect(addDaysISO('2026-12-20', 15)).toBe('2027-01-04');
    expect(plannedReadyDate({ launchDate: '2026-10-01', productionDays: 20 })).toBe('2026-10-21');
    expect(plannedReadyDate({ launchDate: '2026-10-01' })).toBeUndefined();
    expect(plannedReadyDate({ productionDays: 5 })).toBeUndefined();
  });

  it('отклонение AW от AD: 1,65 против 1,5 — плюс 10 %', () => {
    expect(deviationPct(1.65, 1.5)).toBeCloseTo(10, 9);
    expect(deviationPct(1.2, 1.5)).toBeCloseTo(-20, 9);
    expect(deviationPct(null, 1.5)).toBeNull();
    expect(deviationPct(1.2, 0)).toBeNull();
    expect(formatPct(-20)).toBe('−20,0 %');
  });

  it('текст подсказки: склонение «позиции / позициям»', () => {
    expect(suggestionText({ value: 1.58, basis: 'all', points: 5 })).toBe('подсказка 1,58 (по 5 закрытым позициям)');
    expect(suggestionText({ value: 1.58, basis: 'all', points: 21 })).toBe('подсказка 1,58 (по 21 закрытой позиции)');
    expect(suggestionText({ value: null, basis: 'none', points: 2 })).toBe('мало данных для подсказки');
  });
});

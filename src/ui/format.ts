// Форматы и подписи интерфейса — одна версия для всех экранов: деньги, количество, курсы, проценты, даты,
// пустое значение, подписи валют и типов доставки. Округление — только здесь, при показе.

import type { Currency, ISODate, ShipmentMode } from '../domain/model';
import { ruDate } from '../domain/format';

export { ruDate };

/** Пустое значение в таблицах и карточках. */
export const EMPTY = '—';

const NBSP = ' ';
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Число с `min`…`max` знаками после запятой, разряды через неразрывный пробел, минус — «−». */
function fixed(n: number, min: number, max: number, group = true): string {
  const s = Math.abs(n).toFixed(max);
  const [int, frac0 = ''] = s.split('.');
  let frac = frac0;
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  const neg = n < 0 && Number(s) !== 0;
  const intText = group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : int;
  return `${neg ? '−' : ''}${intText}${frac ? `,${frac}` : ''}`;
}

/** Деньги: ровно 2 знака — `1 234,50`; нет значения — «—». */
export function formatMoney(n: number | null | undefined): string {
  return isNum(n) ? fixed(n, 2, 2) : EMPTY;
}

/** Число с фиксированным числом знаков (по умолчанию 2); нет значения — «—». */
export function formatNumber(n: number | null | undefined, digits = 2): string {
  return isNum(n) ? fixed(n, digits, digits) : EMPTY;
}

/** Курс: от 2 до 4 знаков — `11,48`, `92,1234`; нет значения — «—». */
export function formatRate(n: number | null | undefined): string {
  return isNum(n) ? fixed(n, 2, 4) : EMPTY;
}

/** Количество: целое как есть, дробное — до 3 знаков, без разрядов — `1000`, `2,5`; нет значения — «—». */
export function formatQty(n: number | null | undefined): string {
  return isNum(n) ? fixed(n, 0, 3, false) : EMPTY;
}

/** Коэффициент (AD, AW как введены): без лишних нулей, до 4 знаков — `1,5`; нет значения — «—». */
export function formatCoef(n: number | null | undefined): string {
  return isNum(n) ? fixed(n, 0, 4, false) : EMPTY;
}

/** Процент со знаком: `+10,0 %`, `−20,0 %`, `0,0 %`. */
export function formatPct(p: number, digits = 1): string {
  const s = fixed(Math.abs(p), digits, digits);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${s} %`;
}

/** Дата для показа: дд.мм.гггг; нет даты — «—». */
export function formatDate(d: ISODate | null | undefined): string {
  return d ? ruDate(d) : EMPTY;
}

// ---------- валюты ----------

export const CURRENCIES: Currency[] = ['RUB', 'CNY', 'USD', 'EUR'];
export const FOREIGN_CURRENCIES: Exclude<Currency, 'RUB'>[] = ['USD', 'EUR', 'CNY'];

/** Подпись валюты; CNY в интерфейсе — «юань (RMB)». */
export const CURRENCY_LABEL: Record<Currency, string> = { RUB: 'рубль (RUB)', CNY: 'юань (RMB)', USD: 'USD', EUR: 'EUR' };

export const CURRENCY_OPTIONS = CURRENCIES.map((value) => ({ value, label: CURRENCY_LABEL[value] }));

// ---------- типы доставки ----------

export const MODE_LABEL: Record<ShipmentMode, string> = {
  sea_container: 'Море, контейнер',
  road_container: 'Авто, контейнер',
  air: 'Авиа',
  other: 'Другое',
};

export const MODE_OPTIONS = (Object.keys(MODE_LABEL) as ShipmentMode[]).map((value) => ({ value, label: MODE_LABEL[value] }));

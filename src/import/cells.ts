// Разбор ячеек старой таблицы и поиск колонок по заголовкам.
// Значения приходят из batchGet (UNFORMATTED_VALUE + SERIAL_NUMBER): числа, true/false, строки, даты — serial-числа.

import type { ISODate } from '../domain/model';
import { serialToDate } from '../store/schema';

/** Сравнимый вид текста: без регистра, ё = е, пробелы схлопнуты. */
export const norm = (v: unknown): string =>
  String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Ключ имени для сопоставления: без регистра и без пробелов вообще. */
export const nameKey = (v: unknown): string => String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');

export const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Текст ячейки без краевых пробелов; пусто — undefined. */
export function text(v: unknown): string | undefined {
  if (isBlank(v)) return undefined;
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  return String(v).trim();
}

const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;

/** Число ячейки: число как есть; строка — с пробелами-разделителями и десятичной запятой («1 234,5»), «9,618,000» — тысячи. */
export function num(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  let s = v.replace(/[\s ]/g, '');
  if (s === '') return undefined;
  s = THOUSANDS.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = norm(v);
  return s === 'true' || s === 'да' || s === 'истина' || s === '1' || s === 'yes';
}

const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Дата ячейки: serial-число или текст «дд.мм.гггг» / ISO. */
export function date(v: unknown): ISODate | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? serialToDate(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const iso = ISO_DATE.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = RU_DATE.exec(s);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  return undefined;
}

/** Похоже ли число на serial даты (2000–2099 гг.), а не на номер заказа. */
export const looksLikeDateSerial = (n: number): boolean => n >= 36_526 && n < 73_051;

/** дд.мм.гггг для сообщений — общая реализация из домена. */
export { ruDate } from '../domain/format';

/** Индекс строки заголовков: первая из первых `maxRows`, где есть все `required` (сравнение по norm). */
export function findHeaderRow(values: unknown[][], required: string[], maxRows = 10): number {
  const want = required.map(norm);
  for (let i = 0; i < Math.min(values.length, maxRows); i++) {
    const cells = new Set((values[i] ?? []).map(norm));
    if (want.every((w) => cells.has(w))) return i;
  }
  return -1;
}

/** Поиск колонки по заголовку: точное совпадение (norm) или префикс, если псевдоним кончается на «*». */
export function columnOf(header: unknown[], ...aliases: string[]): number {
  const cells = header.map(norm);
  for (const alias of aliases) {
    const prefix = alias.endsWith('*');
    const a = norm(prefix ? alias.slice(0, -1) : alias);
    const i = cells.findIndex((c) => (prefix ? c.startsWith(a) : c === a));
    if (i >= 0) return i;
  }
  return -1;
}

/** Есть ли в строке хоть одно значение в колонках `cols`. */
export const hasAny = (row: unknown[], cols: number[]): boolean => cols.some((c) => c >= 0 && !isBlank(row[c]));

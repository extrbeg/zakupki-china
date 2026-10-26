// Разбор товаров, вставленных из Excel: строки через перевод строки, ячейки через табуляцию.
// Колонки по порядку: товар, кол-во, цена, затем необязательные HS-код, CBM, вес.
// Числа как вводит человек: «1 234,5», «1234.5» (parseUserNumber). Чистая функция — без React.

import { parseUserNumber } from '../../components/NumberField';
import type { Line } from '../../../domain/model';

export type PastedLine = Pick<Line, 'customerName' | 'qty' | 'unitPrice'> & Partial<Pick<Line, 'hsCode' | 'cbm' | 'weight'>>;

export interface PasteRow {
  /** Номер строки во вставленном тексте, с 1 (пустые строки тоже считаются). */
  rowNo: number;
  cells: string[];
  ok: boolean;
  /** Есть только у корректной строки. */
  line?: PastedLine;
  errors: string[];
  /** Первая строка похожа на заголовок таблицы — пропускается без ошибки. */
  header?: boolean;
}

type NumResult = { value?: number; error?: string };

function readNumber(text: string, label: string): NumResult {
  if (text === '') return {};
  const n = parseUserNumber(text);
  if (n === null || n === undefined) return { error: `${label} — не число: «${text}»` };
  return { value: n };
}

export function parsePastedLines(text: string): PasteRow[] {
  const rows: PasteRow[] = [];
  const raw = text.split(/\r\n|\r|\n/);
  raw.forEach((source, i) => {
    if (source.trim() === '') return;
    const cells = source.split('\t').map((c) => c.trim());
    const [name = '', qtyText = '', priceText = '', hsCode = '', cbmText = '', weightText = ''] = cells;
    const errors: string[] = [];

    const qty = readNumber(qtyText, 'кол-во');
    const price = readNumber(priceText, 'цена');

    if (rows.length === 0 && qty.error && price.error) {
      rows.push({ rowNo: i + 1, cells, ok: false, header: true, errors: ['заголовок — пропущена'] });
      return;
    }

    if (name === '') errors.push('нет названия товара');
    if (qty.error) errors.push(qty.error);
    else if (qty.value === undefined) errors.push('нет кол-ва');
    else if (qty.value <= 0) errors.push('кол-во должно быть больше нуля');
    if (price.error) errors.push(price.error);
    else if (price.value === undefined) errors.push('нет цены');
    else if (price.value < 0) errors.push('цена не может быть отрицательной');

    const cbm = readNumber(cbmText, 'CBM');
    const weight = readNumber(weightText, 'вес');
    if (cbm.error) errors.push(cbm.error);
    else if (cbm.value !== undefined && cbm.value < 0) errors.push('CBM не может быть отрицательным');
    if (weight.error) errors.push(weight.error);
    else if (weight.value !== undefined && weight.value < 0) errors.push('вес не может быть отрицательным');

    if (errors.length > 0) {
      rows.push({ rowNo: i + 1, cells, ok: false, errors });
      return;
    }
    const line: PastedLine = { customerName: name, qty: qty.value as number, unitPrice: price.value as number };
    if (hsCode !== '') line.hsCode = hsCode;
    if (cbm.value !== undefined) line.cbm = cbm.value;
    if (weight.value !== undefined) line.weight = weight.value;
    rows.push({ rowNo: i + 1, cells, ok: true, line, errors });
  });
  return rows;
}

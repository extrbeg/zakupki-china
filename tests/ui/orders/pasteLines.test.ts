import { describe, expect, it } from 'vitest';
import { parsePastedLines } from '../../../src/ui/screens/orders/pasteLines';

describe('parsePastedLines — вставка товаров из Excel', () => {
  it('колонки товар, кол-во, цена; «1 234,5» и «1234.5» понимаются', () => {
    const rows = parsePastedLines('Кран DN50\t1 000\t1 234,5\nКран DN25\t20\t1234.5\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ rowNo: 1, ok: true, line: { customerName: 'Кран DN50', qty: 1000, unitPrice: 1234.5 } });
    expect(rows[1]).toMatchObject({ rowNo: 2, ok: true, line: { customerName: 'Кран DN25', qty: 20, unitPrice: 1234.5 } });
  });

  it('необязательные HS-код, CBM, вес; разделители строк Windows и неразрывные пробелы в числах', () => {
    const rows = parsePastedLines('Клапан\t5\t12,40\t8481800000\t0,25\t1 250\r\nМуфта\t3\t2\t\t\t7,5\r\n');
    expect(rows[0].line).toEqual({ customerName: 'Клапан', qty: 5, unitPrice: 12.4, hsCode: '8481800000', cbm: 0.25, weight: 1250 });
    expect(rows[1].line).toEqual({ customerName: 'Муфта', qty: 3, unitPrice: 2, weight: 7.5 });
  });

  it('пустые строки пропускаются, номер строки — как в вставленном тексте', () => {
    const rows = parsePastedLines('\nА\t1\t2\n\n\nБ\t3\t4\n   \n');
    expect(rows.map((r) => [r.rowNo, r.line?.customerName])).toEqual([[2, 'А'], [5, 'Б']]);
  });

  it('ошибки по каждой строке: нет товара, кол-во ≤ 0 или не число, цена < 0 или пустая, CBM/вес не число', () => {
    const rows = parsePastedLines([
      '\t5\t1',
      'Б\t0\t1',
      'В\tпять\t1',
      'Г\t2\t-3',
      'Д\t2',
      'Е\t2\t1\t\tмного\t-1',
    ].join('\n'));
    expect(rows.every((r) => !r.ok && r.line === undefined)).toBe(true);
    expect(rows[0].errors).toEqual(['нет названия товара']);
    expect(rows[1].errors).toEqual(['кол-во должно быть больше нуля']);
    expect(rows[2].errors).toEqual(['кол-во — не число: «пять»']);
    expect(rows[3].errors).toEqual(['цена не может быть отрицательной']);
    expect(rows[4].errors).toEqual(['нет цены']);
    expect(rows[5].errors).toEqual(['CBM — не число: «много»', 'вес не может быть отрицательным']);
  });

  it('первая строка-заголовок (кол-во и цена — не числа) помечается и не считается ошибкой', () => {
    const rows = parsePastedLines('Товар\tКол-во\tЦена\nКран\t1\t2');
    expect(rows[0]).toMatchObject({ rowNo: 1, ok: false, header: true, errors: ['заголовок — пропущена'] });
    expect(rows[1]).toMatchObject({ rowNo: 2, ok: true });
  });

  it('«1,234.5» с запятой-разделителем разрядов — не число, а не тихо 1,234', () => {
    const [row] = parsePastedLines('Кран\t1\t1,234.5');
    expect(row.ok).toBe(false);
    expect(row.errors).toEqual(['цена — не число: «1,234.5»']);
  });

  it('пустой текст — нет строк', () => {
    expect(parsePastedLines('')).toEqual([]);
    expect(parsePastedLines('\n \n')).toEqual([]);
  });
});

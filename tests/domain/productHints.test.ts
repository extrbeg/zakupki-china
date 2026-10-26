// Поиск при вводе (история 93): общий поиск по подстроке и подсказки товаров из прошлых позиций.
import { describe, expect, it } from 'vitest';
import { filterByQuery, matchRange, searchKey } from '../../src/domain/search';
import { findProductHints, productFill, productHints } from '../../src/domain/productHints';
import type { Line, Order } from '../../src/domain/model';

const orders: Order[] = [
  { id: 'o1', number: 1, date: '2026-01-10', costsComplete: false },
  { id: 'o2', number: 2, date: '2026-05-10', costsComplete: false },
];
const line = (id: string, orderId: string, customerName: string, extra: Partial<Line> = {}): Line =>
  ({ id, orderId, supplierOrderId: 'so', seq: 1, customerName, qty: 10, unitPrice: 1, purchased: false, ...extra });

describe('поиск по подстроке', () => {
  it('без учёта регистра, ё/е и крайних пробелов; по подстроке, порядок сохраняется, до 10', () => {
    expect(searchKey('  Ёлка  Зелёная ')).toBe('елка зеленая');
    const items = ['Катафот желтый', 'Болт', 'катафот красный', 'Ёрш', 'Мегакатафот'];
    expect(filterByQuery(items, (s) => s, ' КАТАФ ')).toEqual(['Катафот желтый', 'катафот красный', 'Мегакатафот']);
    expect(filterByQuery(items, (s) => s, 'ерш')).toEqual(['Ёрш']);
    const many = Array.from({ length: 15 }, (_, i) => `Товар ${i}`);
    expect(filterByQuery(many, (s) => s, 'товар')).toHaveLength(10);
    expect(filterByQuery(many, (s) => s, '')).toHaveLength(10);
  });

  it('подсветка: где в исходном тексте совпадение', () => {
    expect(matchRange('Красный Катафот', 'катаф')).toEqual([8, 13]);
    expect(matchRange('Ёрш', 'ер')).toEqual([0, 2]);
    expect(matchRange('Болт', 'катаф')).toBeNull();
    expect(matchRange('Болт', '  ')).toBeNull();
  });
});

describe('подсказки товаров', () => {
  const lines: Line[] = [
    line('l1', 'o1', 'Катафот желтый', { hsCode: '1111', weight: 5, qty: 10 }),
    line('l2', 'o2', 'Катафот красный', { hsCode: '2222' }),
    line('l3', 'o2', 'катафот желтый ', { hsCode: '8714', dutyRate: 5, packaging: 'коробка', packageSize: '40×30', supplierName: 'Yellow reflector', weight: 3, cbm: 0.06, qty: 20 }),
    line('l4', 'o1', 'Болт', {}),
    line('l5', 'o2', '', {}),
  ];

  it('уникальные названия, свежие первыми; данные — из последней позиции с этим названием', () => {
    const hints = productHints({ lines, orders });
    expect(hints.map((h) => h.name)).toEqual(['катафот желтый', 'Катафот красный', 'Болт']);
    expect(hints[0]).toMatchObject({ hsCode: '8714', dutyRate: 5, packaging: 'коробка', packageSize: '40×30', supplierName: 'Yellow reflector' });
    expect(hints[0].weightPerUnit).toBeCloseTo(0.15);
    expect(hints[0].cbmPerUnit).toBeCloseTo(0.003);
  });

  it('«катаф» находит «Катафот желтый» и «Катафот красный»', () => {
    const found = findProductHints(productHints({ lines, orders }), 'катаф');
    expect(found.map((h) => h.name.trim().toLowerCase())).toEqual(['катафот желтый', 'катафот красный']);
  });

  it('подстановка: вес и CBM на единицу × текущее кол-во; без кол-ва — без веса и CBM', () => {
    const hint = productHints({ lines, orders })[0];
    const fill = productFill(hint, 7);
    expect(fill).toMatchObject({ hsCode: '8714', dutyRate: 5, packaging: 'коробка', packageSize: '40×30', supplierName: 'Yellow reflector' });
    expect(fill.weight).toBeCloseTo(1.05);
    expect(fill.cbm).toBeCloseTo(0.021);
    expect(productFill(hint, undefined)).not.toHaveProperty('weight');
    expect(productFill(hint, undefined)).not.toHaveProperty('cbm');
    expect(productFill(productHints({ lines, orders })[2], 3)).toEqual({});
  });
});

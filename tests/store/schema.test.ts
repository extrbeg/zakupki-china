import { describe, expect, it } from 'vitest';
import { SHEETS, SCHEMA_VERSION, toRow, fromRow, type SheetDef } from '../../src/store/schema';
import { ENTITY_NAMES } from '../../src/domain/model';
import type { Order, Line, Carrier, Rate, Cost, SupplierOrder } from '../../src/domain/model';

const sheet = (entity: SheetDef['entity']): SheetDef => {
  const def = SHEETS.find((s) => s.entity === entity);
  if (!def) throw new Error(`нет листа для ${entity}`);
  return def;
};
const col = (def: SheetDef, key: string) => def.columns.findIndex((c) => c.key === key);

// Опорные serial-числа Google Sheets (эпоха 1899-12-30): 1970-01-01 = 25569, 2000-01-01 = 36526, 2024-01-01 = 45292.
describe('SHEETS', () => {
  it('описывает все листы interfaces.md §6 в нужном порядке', () => {
    expect(SHEETS.map((s) => s.sheet)).toEqual([
      '_meta', 'Настройки', 'Лог', 'Курсы', 'Списки', 'Города', 'Поставщики', 'Платежные агенты', 'Перевозчики',
      'Заказы', 'Поставщики в заказе', 'Позиции', 'Поставки', 'Партии', 'Декларации', 'Затраты',
    ]);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('у каждой сущности свой лист, первая колонка — id', () => {
    for (const e of ENTITY_NAMES) {
      const def = sheet(e);
      expect(def.columns[0]).toMatchObject({ key: 'id', header: 'id' });
      expect(new Set(def.columns.map((c) => c.key)).size).toBe(def.columns.length);
    }
  });

  it('заголовки — по таблице §6', () => {
    expect(sheet('orders').columns.map((c) => c.header)).toEqual([
      'id', 'Заказ', 'Дата заказа', 'Подразделение', 'Плательщик', 'Заказчик', 'Название', 'ID задачи Битрикс',
      'Дата расчёта', 'Все затраты внесены', 'Комментарий', 'Создан',
    ]);
    expect(sheet('batches').columns.map((c) => c.header)).toEqual(['id', 'shipmentId', 'lineId', 'Кол-во', 'CBM', 'Вес, кг', 'Мест', 'declarationId']);
    expect(sheet('meta').columns.map((c) => c.header)).toEqual(['Ключ', 'Значение']);
    expect(sheet('log').columns.map((c) => c.header)).toEqual(['Время', 'Уровень', 'Сообщение', 'Подробности']);
    expect(sheet('costs').columns.map((c) => c.key)).toEqual([
      'id', 'entryDate', 'paymentDate', 'status', 'targetType', 'targetId', 'costType', 'payeeType', 'payeeId', 'payeeText',
      'executor', 'invoiceNumber', 'invoiceDate', 'amount', 'currency', 'rate', 'rateDate', 'rateManual', 'amountRub', 'comment',
    ]);
  });

  it('формульные колонки перевода в «Позиции»', () => {
    const lines = sheet('lines');
    const en = lines.columns.find((c) => c.key === 'customerNameEn')!;
    const tech = lines.columns.find((c) => c.key === 'techParamsEn')!;
    expect(en).toMatchObject({ header: 'Name EN (авто)', type: 'formula' });
    expect(tech).toMatchObject({ header: 'Tech EN (авто)', type: 'formula' });
    const ref = (k: string) => ({ customerName: 'E7', techParams: 'F7' }[k] ?? '?');
    expect(en.formula!(ref)).toBe('=IF(ISBLANK(E7),"",GOOGLETRANSLATE(E7,"ru","en"))');
    expect(tech.formula!(ref)).toBe('=IF(ISBLANK(F7),"",GOOGLETRANSLATE(F7,"ru","en"))');
  });
});

describe('toRow', () => {
  it('даты → serial, дата-время → serial с дробью по Москве, bool и числа как есть, пустые → \'\', формулы → null', () => {
    const def = sheet('orders');
    const order: Order = { id: 'ord_1', number: 12, date: '2000-01-01', calcDate: '2024-01-01', costsComplete: true, createdAt: '2000-01-01T12:00:00.000Z' };
    const row = toRow(def, order);
    expect(row).toHaveLength(def.columns.length);
    expect(row[col(def, 'id')]).toBe('ord_1');
    expect(row[col(def, 'number')]).toBe(12);
    expect(row[col(def, 'date')]).toBe(36526);
    expect(row[col(def, 'calcDate')]).toBe(45292);
    expect(row[col(def, 'costsComplete')]).toBe(true);
    // 12:00 UTC = 15:00 по Москве (UTC+3) → 36526 + 15/24
    expect(row[col(def, 'createdAt')]).toBe(36526.625);
    // '' очищает ячейку при RAW-update; null Sheets пропустил бы и оставил старое значение
    expect(row[col(def, 'department')]).toBe('');
    expect(row[col(def, 'comment')]).toBe('');

    const lines = sheet('lines');
    const lrow = toRow(lines, { id: 'l1', orderId: 'o', supplierOrderId: 's', seq: 1, qty: 2, unitPrice: 1.5, purchased: false, customerName: 'Кран', customerNameEn: 'Crane' } satisfies Line);
    expect(lrow[col(lines, 'customerNameEn')]).toBeNull();
    expect(lrow[col(lines, 'techParamsEn')]).toBeNull();
    expect(lrow[col(lines, 'dutyRate')]).toBe('');
    expect(lrow[col(lines, 'unitPrice')]).toBe(1.5);
    expect(lrow[col(lines, 'purchased')]).toBe(false);
  });
});

describe('fromRow', () => {
  it('serial → ISODate, пустые ячейки не дают ключей, короткая строка допустима', () => {
    const def = sheet('orders');
    const row: unknown[] = ['ord_2', 7, 25569, '', 'ООО Плательщик'];
    expect(fromRow(def, row)).toEqual({ id: 'ord_2', number: 7, date: '1970-01-01', payer: 'ООО Плательщик', costsComplete: false });
  });

  it('терпит текст в ячейках: даты дд.мм.гггг и ISO, числа с запятой, TRUE/FALSE строкой, число в текстовой колонке', () => {
    const def = sheet('orders');
    const row: unknown[] = ['ord_3', '15', '25.10.2026', 'Цех', '', '', '', 123456, '2026-10-01', 'TRUE'];
    expect(fromRow(def, row)).toEqual({ id: 'ord_3', number: 15, date: '2026-10-25', department: 'Цех', bitrixTaskId: '123456', calcDate: '2026-10-01', costsComplete: true });
    const lines = sheet('lines');
    const lrow: unknown[] = [];
    lrow[col(lines, 'id')] = 'l1';
    lrow[col(lines, 'unitPrice')] = '1 234,5';
    lrow[col(lines, 'customerNameEn')] = 'Crane';
    expect(fromRow(lines, lrow)).toMatchObject({ id: 'l1', unitPrice: 1234.5, customerNameEn: 'Crane' });
  });
});

describe('«Поставщики в заказе» — коэффициент AD (G05)', () => {
  it('колонка coef — «Коэффициент AD», последняя (ensureSchema допишет её в конец существующего листа)', () => {
    const def = sheet('supplierOrders');
    expect(def.columns.at(-1)).toMatchObject({ key: 'coef', header: 'Коэффициент AD', type: 'number' });
    expect(def.columns.map((c) => c.header).slice(0, -1)).toEqual([
      'id', 'orderId', '№ поставщика', 'supplierId', 'ID задачи Битрикс', 'Валюта', 'Дата расчёта', 'Курс расчёта вручную',
      'Условия оплаты', 'План. доставка', 'Дата запуска', 'Срок изготовления, дн', 'Факт. готовность', 'Комментарий',
    ]);
  });

  it('AD поставщика переживает запись и чтение; пустой — остаётся пустым', () => {
    const def = sheet('supplierOrders');
    const so: SupplierOrder = { id: 'so', orderId: 'o', seq: 1, supplierId: 's', currency: 'CNY', coef: 1.55 };
    expect(fromRow(def, toRow(def, so))).toEqual(so);
    const bare: SupplierOrder = { id: 'so', orderId: 'o', seq: 1, supplierId: 's', currency: 'CNY' };
    expect(toRow(def, bare).at(-1)).toBe('');
    expect(fromRow(def, toRow(def, bare)).coef).toBeUndefined();
  });
});

describe('круговой тест toRow → fromRow', () => {
  const roundTrip = (def: SheetDef, rec: object) => fromRow(def, toRow(def, rec));

  it('string, number, int, date, datetime, bool (true/false)', () => {
    const order: Order = { id: 'ord_x', number: 101, date: '2026-10-25', department: 'Отдел', payer: 'П', customer: 'З', title: 'Т', bitrixTaskId: '555', calcDate: '2026-02-28', costsComplete: true, comment: 'к', createdAt: '2026-10-25T09:30:15.250Z' };
    expect(roundTrip(sheet('orders'), order)).toEqual(order);
    const line: Line = { id: 'l', orderId: 'o', supplierOrderId: 's', seq: 3, qty: 720, unitPrice: 60.125, purchased: false, dutyRate: 7.5, cbm: 0.333, weight: 12.4, places: 2, coef: 1.5 };
    expect(roundTrip(sheet('lines'), line)).toEqual(line);
  });

  it('високосный день, конец года и эпоха', () => {
    for (const date of ['2024-02-29', '1999-12-31', '1899-12-30', '1970-01-01']) {
      const rate: Rate = { id: 'r', date, currency: 'CNY', rate: 11.4567, source: 'vtb' };
      expect(roundTrip(sheet('rates'), rate)).toEqual(rate);
    }
  });

  it('пустые необязательные поля остаются пустыми, пустой bool читается как false', () => {
    const carrier: Carrier = { id: 'c', name: 'Перевозчик' };
    expect(roundTrip(sheet('carriers'), carrier)).toEqual({ id: 'c', name: 'Перевозчик', contractSigned: false });
    const carrier2: Carrier = { id: 'c', name: 'Перевозчик', contractValidUntil: '2027-01-31', contractSigned: true };
    expect(roundTrip(sheet('carriers'), carrier2)).toEqual(carrier2);
  });

  it('затрата со всеми типами полей', () => {
    const cost: Cost = { id: 'k', entryDate: '2026-10-01', paymentDate: '2026-10-05', status: 'fact', targetType: 'shipment', targetId: 'sh', costType: 'Доставка', payeeType: 'text', payeeText: 'Кто-то', amount: 1000.5, currency: 'USD', rate: 81.2345, rateDate: '2026-10-05', rateManual: true, amountRub: 81275.12 };
    expect(roundTrip(sheet('costs'), cost)).toEqual(cost);
  });

  it('дата-время в часовом поясе таблицы Europe/Moscow (UTC+3, без летнего времени)', () => {
    const log = sheet('log');
    const t = col(log, 'time');
    // 2024-01-01 12:00 по Москве = 09:00 UTC; serial = 45292 + 12/24
    expect(fromRow(log, [45292.5])).toEqual({ time: '2024-01-01T09:00:00.000Z' });
    expect(toRow(log, { time: '2024-01-01T09:00:00.000Z' })[t]).toBe(45292.5);
    // летом сдвиг тот же: 2026-07-15 00:00 по Москве = 2026-07-14 21:00 UTC; serial 2026-07-15 = 46218
    expect(toRow(log, { time: '2026-07-14T21:00:00.000Z' })[t]).toBe(46218);
    const rec = { time: '2026-10-25T23:30:00.000Z', level: 'info', message: 'м' };
    expect(fromRow(log, toRow(log, rec))).toEqual(rec);
  });

  it('настройки и мета — ключ/значение', () => {
    expect(roundTrip(sheet('settings'), { key: 'vatRateDefault', value: '22' })).toEqual({ key: 'vatRateDefault', value: '22' });
  });
});

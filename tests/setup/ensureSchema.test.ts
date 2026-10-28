import { DEFAULT_UNITS } from '../../src/domain/labels';
import { describe, expect, it } from 'vitest';
import { ensureSchema, NotAppSpreadsheetError } from '../../src/setup/ensureSchema';
import { SHEETS, SCHEMA_VERSION, sheetFor, headerRow, toRow } from '../../src/store/schema';
import { SheetsStore } from '../../src/store/sheetsStore';
import { FakeSheetsApi } from '../store/sheetsStoreFake';
import { sampleOrder } from '../store/contract';

const SP = 'sp_setup';
const header = (fake: FakeSheetsApi, sheet: string) => fake.values(SP, sheet)[0] as string[];

describe('ensureSchema', () => {
  it('пустая таблица: создаются все листы схемы с заголовками, форматами дат и чисел', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, { 'Лист1': [] });
    const report = await ensureSchema(fake, SP);
    expect(report.createdSheets.sort()).toEqual(SHEETS.map((d) => d.sheet).sort());
    expect(report.addedColumns).toEqual([]);
    for (const def of SHEETS) expect(header(fake, def.sheet)).toEqual(headerRow(def));
    const orders = sheetFor('orders');
    const fmt = fake.formats(SP, 'Заказы');
    expect(fmt[orders.columns.findIndex((c) => c.key === 'date')]).toMatch(/^DATE:/);
    expect(fmt[orders.columns.findIndex((c) => c.key === 'createdAt')]).toMatch(/^DATE_TIME:/);
    expect(fmt[orders.columns.findIndex((c) => c.key === 'number')]).toMatch(/^NUMBER:/);
    const lines = sheetFor('lines');
    expect(fake.formats(SP, 'Позиции')[lines.columns.findIndex((c) => c.key === 'unitPrice')]).toMatch(/^NUMBER:/);
    expect(fmt[orders.columns.findIndex((c) => c.key === 'customer')]).toBeUndefined();
    expect(fake.sheetTitles(SP)).toContain('Лист1');
  });

  it('заполняет «Списки» (типы затрат), «Настройки» по умолчанию и версию схемы в «_meta»', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, {});
    await ensureSchema(fake, SP);
    const ds = await new SheetsStore(fake, SP).load();
    const costTypes = ds.lists.filter((l) => l.list === 'costType').map((l) => l.value);
    expect(costTypes).toEqual(expect.arrayContaining(['Доставка', 'Пошлина', 'НДС']));
    expect(ds.lists.filter((l) => l.list === 'payer')).toEqual([]);   // плательщики — данные пользователя, не выдумываем
    expect(ds.settings).toEqual({ ratesSourceUrl: 'https://www.vtb.ru/personal/platezhi-i-perevody/obmen-valjuty/', bitrixPortalUrl: '', vatRateDefault: '22' });
    expect(ds.meta.schemaVersion).toBe(String(SCHEMA_VERSION));
  });

  it('идемпотентно: второй запуск ничего не пишет и ничего не создаёт', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, {});
    await ensureSchema(fake, SP);
    const before = fake.calls.length;
    const report = await ensureSchema(fake, SP);
    expect(report).toEqual({ createdSheets: [], addedColumns: [], renamedColumns: [] });
    expect(fake.calls.slice(before).filter((c) => c.method !== 'batchGet' && c.method !== 'getMeta')).toEqual([]);
  });

  it('существующий лист: данные и порядок колонок не трогаются, недостающие колонки дописываются справа', async () => {
    const fake = new FakeSheetsApi();
    const def = sheetFor('orders');
    // пользовательский лист: часть колонок схемы в своём порядке + своя колонка
    const head = ['Заказ', 'id', 'Мои заметки', 'Дата заказа'];
    const row = [41, 'ord_c1', 'моё', 46296];
    fake.seed(SP, { 'Заказы': [head, row], 'Списки': [headerRow(sheetFor('lists')), ['lst_1', 'payer', 'Свой плательщик', 1]] });
    const report = await ensureSchema(fake, SP);
    const added = def.columns.map((c) => c.header).filter((h) => !head.includes(h));
    expect(report.addedColumns).toEqual([{ sheet: 'Заказы', headers: added }]);
    expect(report.createdSheets).not.toContain('Заказы');
    const after = fake.values(SP, 'Заказы');
    expect(after[0]).toEqual([...head, ...added]);
    expect(after[1]).toEqual(row);
    // «Списки» не пустые — типы затрат по умолчанию не добавляются, дописываются только «Единицы измерения»
    const lists = fake.values(SP, 'Списки');
    expect(lists.slice(2).map((r) => r[1])).toEqual(DEFAULT_UNITS.map(() => 'unit'));
    expect(lists.slice(2).map((r) => r[2])).toEqual([...DEFAULT_UNITS]);
    // формат дат — только новым колонкам
    const fmt = fake.formats(SP, 'Заказы');
    expect(fmt[3]).toBeUndefined();
    expect(fmt[head.length + added.indexOf('Дата расчёта')]).toMatch(/^DATE:/);
  });

  it('после ensureSchema хранилище читает и пишет пользовательский лист', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, { 'Заказы': [['Заказ', 'id'], [7, 'ord_old']] });
    await ensureSchema(fake, SP);
    const store = new SheetsStore(fake, SP);
    await store.insert('orders', sampleOrder);
    const ds = await store.load();
    expect(ds.orders.map((o) => o.id)).toEqual(['ord_old', 'ord_c1']);
    expect(ds.orders[1]).toEqual(sampleOrder);
    expect(fake.values(SP, 'Заказы')[2].slice(0, 2)).toEqual(toRow(sheetFor('orders'), sampleOrder).slice(0, 2).reverse());
  });

  it('чужая таблица (старая «Закупки Китай AREC»): лист с данными без «id» в строке 1 → отказ, ничего не пишется', async () => {
    const fake = new FakeSheetsApi();
    // старая структура: в «Заказы» строка 1 — пустая/шапка, заголовки — в строке 2, данные с 3-й
    fake.seed(SP, {
      'Заказы': [[], ['Заказ', 'Дата заказа', 'Целевое подразделение'], [41, 46296, 'Цех 1']],
      'Списки': [['Тип компании', 'Направление'], ['Фабрика', 'Арматура']],
      'Платежные агенты': [['Наименование', 'Контактное лицо'], ['Агент', 'Иван']],
      'Перевозчики': [['Наименование перевозчика', 'Тип'], ['Перевозчик', 'Авто']],
    });
    const before = { orders: fake.values(SP, 'Заказы'), lists: fake.values(SP, 'Списки') };
    const err = await ensureSchema(fake, SP).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotAppSpreadsheetError);
    expect((err as Error).message).toBe('Это не таблица приложения — для переноса используйте Импорт');
    expect(fake.writes()).toEqual([]);
    expect(fake.values(SP, 'Заказы')).toEqual(before.orders);
    expect(fake.values(SP, 'Списки')).toEqual(before.lists);
    expect(fake.formats(SP, 'Заказы')).toEqual({});
    expect(fake.sheetTitles(SP)).toEqual(['Заказы', 'Списки', 'Платежные агенты', 'Перевозчики']);
  });

  it('лист схемы без «id», но без данных (только строка 1) — колонки дописываются как обычно', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, { 'Поставки': [['Поставка']] });
    const report = await ensureSchema(fake, SP);
    expect(report.addedColumns.find((a) => a.sheet === 'Поставки')?.headers).toContain('id');
  });
});

describe('ensureSchema: переименованные колонки', () => {
  it('колонка под прежним названием переименовывается на месте, данные не трогаются; хранилище читает её и до, и после', async () => {
    const fake = new FakeSheetsApi();
    const def = sheetFor('suppliers');
    const old = def.columns.map((c) => c.aliases?.[0] ?? c.header);
    const row = def.columns.map((c) => (c.key === 'id' ? 'sup_1' : c.key === 'name' ? 'Alpha' : c.key === 'email' ? 'a@b.cn' : ''));
    fake.seed(SP, { 'Поставщики': [old, row] });
    expect((await new SheetsStore(fake, SP).load()).suppliers[0]).toMatchObject({ name: 'Alpha', email: 'a@b.cn' });
    const report = await ensureSchema(fake, SP);
    expect(report.renamedColumns).toEqual(expect.arrayContaining([
      { sheet: 'Поставщики', from: 'Компания', to: 'Название' }, { sheet: 'Поставщики', from: 'Почта', to: 'Email' },
    ]));
    const after = fake.values(SP, 'Поставщики');
    expect(after[0]).toEqual(def.columns.map((c) => c.header));
    const email = def.columns.findIndex((c) => c.key === 'email');
    expect([after[1][0], after[1][1], after[1][email]]).toEqual(['sup_1', 'Alpha', 'a@b.cn']);
    expect((await new SheetsStore(fake, SP).load()).suppliers[0]).toMatchObject({ name: 'Alpha', email: 'a@b.cn' });
  });
});

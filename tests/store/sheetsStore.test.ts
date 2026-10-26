import { describe, expect, it } from 'vitest';
import type { Dataset } from '../../src/domain/model';
import { ENTITY_NAMES } from '../../src/domain/model';
import { SheetsStore } from '../../src/store/sheetsStore';
import { SHEETS, toRow, sheetFor, dateToSerial, type SheetDef } from '../../src/store/schema';
import { StoreError } from '../../src/store/types';
import { GoogleApiError } from '../../src/google/errors';
import { storeContract, sampleLine, sampleOrder } from './contract';
import { FakeSheetsApi } from './sheetsStoreFake';

const SP = 'sp_test';
const USER_COL = 'Мои заметки';

type Layout = (def: SheetDef) => { headers: string[]; keys: (string | null)[] };
/** Порядок колонок как в схеме. */
const schemaOrder: Layout = (def) => ({ headers: def.columns.map((c) => c.header), keys: def.columns.map((c) => c.key) });
/** Пользователь переставил колонки (обратный порядок) и вставил свою колонку второй. */
const shuffled: Layout = (def) => {
  const cols = [...def.columns].reverse();
  const headers = cols.map((c) => c.header);
  const keys: (string | null)[] = cols.map((c) => c.key);
  headers.splice(1, 0, USER_COL);
  keys.splice(1, 0, null);
  return { headers, keys };
};

/** Таблица с листами схемы (только заголовки) и данными seed, разложенными по раскладке. */
function seedFake(fake: FakeSheetsApi, layout: Layout, seed: Partial<Dataset> = {}) {
  const sheets: Record<string, unknown[][]> = {};
  for (const def of SHEETS) {
    const { headers, keys } = layout(def);
    const rows: unknown[][] = [headers];
    const records: object[] =
      def.entity === 'settings' || def.entity === 'meta'
        ? Object.entries((seed[def.entity] as Record<string, string> | undefined) ?? {}).map(([key, value]) => ({ key, value }))
        : def.entity === 'log' ? [] : ((seed[def.entity] as object[] | undefined) ?? []);
    for (const rec of records) {
      const schemaRow = toRow(def, rec);
      rows.push(keys.map((k) => (k === null ? 'моё' : schemaRow[def.columns.findIndex((c) => c.key === k)] ?? '')));
    }
    sheets[def.sheet] = rows;
  }
  fake.seed(SP, sheets);
}

function harness(layout: Layout) {
  return (seed?: Partial<Dataset>) => {
    const fake = new FakeSheetsApi();
    seedFake(fake, layout, seed);
    return {
      store: new SheetsStore(fake, SP),
      reopen: () => new SheetsStore(fake, SP),
      readReport: (sheet: string) => fake.writtenRows(SP, sheet) as (string | number | null)[][],
    };
  };
}

storeContract('SheetsStore (порядок схемы)', harness(schemaOrder));
storeContract('SheetsStore (колонки переставлены, своя колонка)', harness(shuffled));

const col = (fake: FakeSheetsApi, sheet: string, header: string) => (fake.values(SP, sheet)[0] as string[]).indexOf(header);

describe('SheetsStore: формат записи', () => {
  it('числа пишутся RAW числами, даты — serial, булевы — булевыми', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder);
    await new SheetsStore(fake, SP).insert('lines', sampleLine);
    await new SheetsStore(fake, SP).insert('orders', sampleOrder);
    const rawWrites = fake.writes().filter((c) => c.method === 'append' || c.method === 'update');
    expect(rawWrites.filter((c) => c.values?.flat().some((v) => v === 60.5))).not.toHaveLength(0);
    for (const c of rawWrites.filter((c) => c.values?.flat().some((v) => v === 60.5))) expect(c.input).toBe('RAW');
    const lines = fake.values(SP, 'Позиции');
    expect(lines[1][col(fake, 'Позиции', 'Цена в валюте')]).toBe(60.5);
    expect(lines[1][col(fake, 'Позиции', 'Закупка')]).toBe(true);
    const orders = fake.values(SP, 'Заказы');
    expect(orders[1][col(fake, 'Заказы', 'Дата заказа')]).toBe(dateToSerial('2026-10-01'));
    expect(orders[1][col(fake, 'Заказы', 'Дата заказа')]).toBe(46296);
  });

  it('формулы перевода пишутся отдельным USER_ENTERED-запросом с GOOGLETRANSLATE на свою строку', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, shuffled, { lines: [{ ...sampleLine, id: 'ln_0' }] });
    await new SheetsStore(fake, SP).insert('lines', sampleLine);
    const ue = fake.writes().filter((c) => c.input === 'USER_ENTERED');
    expect(ue).toHaveLength(1);
    expect(ue[0].values!.flat().filter((v) => typeof v === 'string' && v.includes('GOOGLETRANSLATE'))).toHaveLength(2);
    const enCol = col(fake, 'Позиции', 'Name EN (авто)');
    const srcCol = col(fake, 'Позиции', 'Название от заказчика');
    const letter = String.fromCharCode(65 + srcCol);
    expect(fake.formulaAt(SP, 'Позиции', 2, enCol)).toBe(`=IF(ISBLANK(${letter}3),"",GOOGLETRANSLATE(${letter}3,"ru","en"))`);
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.lines.find((l) => l.id === sampleLine.id)?.customerNameEn).toBe('[en] Кран шаровой');
    // RAW-запись строки не содержит формул
    for (const c of fake.writes().filter((w) => w.input === 'RAW')) {
      expect(c.values!.flat().some((v) => typeof v === 'string' && v.startsWith('='))).toBe(false);
    }
  });

  it('update и remove перечитывают колонку id: строка, сдвинутая после load, находится', async () => {
    const fake = new FakeSheetsApi();
    const a = { ...sampleOrder, id: 'ord_a', number: 1 };
    const b = { ...sampleOrder, id: 'ord_b', number: 2 };
    seedFake(fake, schemaOrder, { orders: [a, b] });
    const store = new SheetsStore(fake, SP);
    await store.load();
    // кто-то вставил строку сверху прямо в таблице
    fake.insertRow(SP, 'Заказы', 1, ['ord_x', 99]);
    await store.update('orders', { ...b, customer: 'Изменён' });
    await store.remove('orders', 'ord_a');
    const ds = await store.load();
    expect(ds.orders.map((o) => [o.id, o.customer])).toEqual([['ord_x', undefined], ['ord_b', 'Изменён']]);
    const reads = fake.calls.filter((c) => c.method === 'batchGet' && c.ranges?.some((r) => r.startsWith("'Заказы'!")));
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it('запись не трогает пользовательскую колонку', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, shuffled, { suppliers: [{ id: 'sup_1', name: 'Старое' }] });
    await new SheetsStore(fake, SP).update('suppliers', { id: 'sup_1', name: 'Новое' });
    const rows = fake.values(SP, 'Поставщики');
    expect(rows[1][1]).toBe('моё');
    expect(rows[1][col(fake, 'Поставщики', 'Компания')]).toBe('Новое');
  });

  it('недостающий лист читается как пустой', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(SP, { 'Заказы': [sheetFor('orders').columns.map((c) => c.header), toRow(sheetFor('orders'), sampleOrder)] });
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders).toEqual([sampleOrder]);
    for (const e of ENTITY_NAMES.filter((x) => x !== 'orders')) expect(ds[e]).toEqual([]);
  });
});

describe('SheetsStore: ошибки', () => {
  const cases: [Error, StoreError['kind']][] = [
    [new GoogleApiError(0), 'network'],
    [new GoogleApiError(401), 'auth'],
    [new GoogleApiError(403), 'auth'],
    [new GoogleApiError(404), 'notFound'],
    [new GoogleApiError(500), 'unknown'],
  ];
  for (const [err, kind] of cases) {
    it(`${err.message} → StoreError('${kind}')`, async () => {
      const fake = new FakeSheetsApi();
      seedFake(fake, schemaOrder);
      fake.failNext(err);
      const got = await new SheetsStore(fake, SP).load().catch((e: unknown) => e);
      expect(got).toBeInstanceOf(StoreError);
      expect((got as StoreError).kind).toBe(kind);
    });
  }

  it('insert с существующим id → conflict', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [sampleOrder] });
    const got = await new SheetsStore(fake, SP).insert('orders', sampleOrder).catch((e: unknown) => e);
    expect((got as StoreError).kind).toBe('conflict');
  });
});

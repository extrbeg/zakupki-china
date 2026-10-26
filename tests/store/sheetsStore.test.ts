import { describe, expect, it, vi } from 'vitest';
import type { Dataset } from '../../src/domain/model';
import { ENTITY_NAMES } from '../../src/domain/model';
import { SheetsStore } from '../../src/store/sheetsStore';
import { SHEETS, toRow, sheetFor, dateToSerial, type SheetDef } from '../../src/store/schema';
import { StoreError } from '../../src/store/types';
import { GoogleApiError } from '../../src/google/errors';
import { storeContract, sampleLine, sampleOrder, sampleSupplier } from './contract';
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

describe('SheetsStore: id для строк, вбитых прямо в таблицу (G26)', () => {
  const idsOf = (fake: FakeSheetsApi, sheet: string) => fake.values(SP, sheet).slice(1).map((r) => r[0]);
  const idWrites = (fake: FakeSheetsApi, sheet: string) => fake.writes().filter((c) => c.range?.startsWith(`'${sheet}'!`));

  it('строка с данными и пустым id получает id с префиксом сущности, он записан в колонку id и виден сразу', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [sampleOrder, { ...sampleOrder, id: '', number: 42, customer: 'Из таблицы' }] });
    const before = fake.values(SP, 'Заказы')[2];
    const ds = await new SheetsStore(fake, SP).load();
    const added = ds.orders.find((o) => o.number === 42);
    expect(added?.id).toMatch(/^ord_[0-9a-z]+$/);
    expect(added?.customer).toBe('Из таблицы');
    expect(idsOf(fake, 'Заказы')).toEqual(['ord_c1', added!.id]);
    // остальные ячейки строки не изменились
    expect(fake.values(SP, 'Заказы')[2].slice(1)).toEqual(before.slice(1));
    const w = idWrites(fake, 'Заказы');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ method: 'update', input: 'RAW' });
    // следующая загрузка видит тот же id и ничего не пишет
    const again = await new SheetsStore(fake, SP).load();
    expect(again.orders.map((o) => o.id)).toEqual(['ord_c1', added!.id]);
    expect(idWrites(fake, 'Заказы')).toHaveLength(1);
  });

  it('совсем пустые строки не получают id и не попадают в набор; записанная строка с id не трогается', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [sampleOrder] });
    fake.insertRow(SP, 'Заказы', 2, ['', '', '', '']);
    fake.insertRow(SP, 'Заказы', 3, ['', 43, '', 'Цех 2']);
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders).toHaveLength(2);
    const rows = fake.writtenRows(SP, 'Заказы');
    expect(rows[2]).toEqual([null, null, null, null]);
    expect(rows[3][0]).toMatch(/^ord_/);
    expect(rows[3].slice(1)).toEqual([43, null, 'Цех 2']);
    expect(rows[1][0]).toBe('ord_c1');
  });

  it('несколько листов и строк вразбивку: id пишутся одной записью на лист', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, shuffled, {
      orders: [{ ...sampleOrder, id: '', number: 1 }, sampleOrder, { ...sampleOrder, id: '', number: 3 }],
      suppliers: [{ ...sampleSupplier, id: '' }, { ...sampleSupplier, id: '', name: 'Второй' }],
      lines: [{ ...sampleLine, id: '' }],
    });
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders.map((o) => o.number).sort()).toEqual([1, 3, 41]);
    expect(ds.suppliers.map((x) => x.id)).toEqual([expect.stringMatching(/^sup_/), expect.stringMatching(/^sup_/)]);
    expect(ds.lines[0].id).toMatch(/^ln_/);
    expect(new Set([...ds.orders, ...ds.suppliers].map((x) => x.id)).size).toBe(5);
    for (const sheet of ['Заказы', 'Поставщики', 'Позиции']) expect(idWrites(fake, sheet)).toHaveLength(1);
    // пользовательская колонка и данные на месте
    const orders = fake.values(SP, 'Заказы');
    const idCol = col(fake, 'Заказы', 'id');
    expect(orders.slice(1).map((r) => r[idCol])).toEqual(ds.orders.map((o) => o.id));
    expect(orders.slice(1).map((r) => r[1])).toEqual(['моё', 'моё', 'моё']);
    const again = await new SheetsStore(fake, SP).load();
    expect(again.orders.map((o) => o.id)).toEqual(ds.orders.map((o) => o.id));
  });

  it('сбой записи id: запись всё равно возвращается с новым id, следующая загрузка повторяет запись', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [{ ...sampleOrder, id: '' }] });
    const spy = vi.spyOn(fake, 'update').mockRejectedValueOnce(new GoogleApiError(503));
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders).toHaveLength(1);
    expect(ds.orders[0].id).toMatch(/^ord_/);
    expect(idsOf(fake, 'Заказы')).toEqual(['']);
    spy.mockRestore();
    const again = await new SheetsStore(fake, SP).load();
    expect(again.orders[0].id).toMatch(/^ord_/);
    expect(idsOf(fake, 'Заказы')).toEqual([again.orders[0].id]);
  });

  /** Перед повторным чтением листа (одиночный диапазон) выполнить meddle — будто таблицу поменяли между чтением и записью id. */
  const meddleBeforeReread = (fake: FakeSheetsApi, sheet: string, meddle: () => Promise<void> | void) => {
    const orig = fake.batchGet.bind(fake);
    let done = false;
    vi.spyOn(fake, 'batchGet').mockImplementation(async (id, ranges, opts) => {
      if (!done && ranges.length === 1 && ranges[0] === `'${sheet}'`) { done = true; await meddle(); }
      return orig(id, ranges, opts);
    });
  };

  it('другое устройство успело записать id в эту строку → наш id не пишется поверх, строка получит id при следующей загрузке', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [{ ...sampleOrder, id: '' }] });
    meddleBeforeReread(fake, 'Заказы', () => fake.update(SP, "'Заказы'!A2:A2", [['ord_other']]));
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders).toHaveLength(1);
    expect(idsOf(fake, 'Заказы')).toEqual(['ord_other']);
    vi.restoreAllMocks();
    expect((await new SheetsStore(fake, SP).load()).orders.map((o) => o.id)).toEqual(['ord_other']);
  });

  it('лист отсортировали между чтением и записью → id не попадает в чужую строку и не затирает её id', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [{ ...sampleOrder, id: '', number: 7 }, { ...sampleOrder, id: 'ord_b', number: 8 }] });
    // строки поменялись местами: на месте строки без id теперь ord_b, строка без id — ниже
    meddleBeforeReread(fake, 'Заказы', () => {
      const [, a, b] = fake.values(SP, 'Заказы');
      fake.update(SP, "'Заказы'!A2:Z3", [b.concat(new Array(26 - b.length).fill('')).slice(0, 26), a.concat(new Array(26 - a.length).fill('')).slice(0, 26)]);
    });
    await new SheetsStore(fake, SP).load();
    const numCol = col(fake, 'Заказы', 'Заказ');
    expect(fake.values(SP, 'Заказы').slice(1).map((r) => [r[0], r[numCol]])).toEqual([['ord_b', 8], ['', 7]]);
    vi.restoreAllMocks();
    const again = await new SheetsStore(fake, SP).load();
    const seven = again.orders.find((o) => o.number === 7)!;
    expect(seven.id).toMatch(/^ord_/);
    expect(fake.values(SP, 'Заказы').slice(1).map((r) => [r[0], r[numCol]])).toEqual([['ord_b', 8], [seven.id, 7]]);
  });

  it('строка, где только FALSE во флажках, не получает id и не становится записью', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { orders: [sampleOrder] });
    const def = sheetFor('orders');
    const row = def.columns.map((c) => (c.type === 'bool' ? false : ''));
    fake.insertRow(SP, 'Заказы', 2, row);
    fake.insertRow(SP, 'Заказы', 3, def.columns.map((c) => (c.type === 'bool' ? 'FALSE' : '')));
    const ds = await new SheetsStore(fake, SP).load();
    expect(ds.orders.map((o) => o.id)).toEqual(['ord_c1']);
    expect(fake.writes()).toEqual([]);
  });

  it('«Настройки» и «_meta» без id не трогаются', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { settings: { vatRateDefault: '22' }, meta: { scriptId: 'x' } });
    await new SheetsStore(fake, SP).load();
    expect(fake.writes()).toEqual([]);
  });
});

describe('SheetsStore: разделитель в формулах перевода (G27)', () => {
  const enAt = (fake: FakeSheetsApi, r: number) => fake.formulaAt(SP, 'Позиции', r, col(fake, 'Позиции', 'Name EN (авто)'));

  it('русская локаль без настройки: формула пишется через «;» и вычисляется', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder);
    fake.setLocale(SP, 'ru_RU');
    const store = new SheetsStore(fake, SP);
    await store.load();
    await store.insert('lines', sampleLine);
    expect(enAt(fake, 1)).toBe('=IF(ISBLANK(E2);"";GOOGLETRANSLATE(E2;"ru";"en"))');
    expect((await store.load()).lines[0].customerNameEn).toBe('[en] Кран шаровой');
  });

  it('insert без предварительной загрузки тоже берёт разделитель по локали', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder);
    fake.setLocale(SP, 'de_DE');
    await new SheetsStore(fake, SP).insert('lines', sampleLine);
    expect(enAt(fake, 1)).toContain('GOOGLETRANSLATE(E2;"ru";"en")');
  });

  it('настройка formulaSeparator важнее локали', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { settings: { formulaSeparator: ',' } });
    fake.setLocale(SP, 'ru_RU');
    const store = new SheetsStore(fake, SP);
    await store.load();
    await store.update('lines', sampleLine).catch(() => undefined);
    await store.insert('lines', sampleLine);
    expect(enAt(fake, 1)).toBe('=IF(ISBLANK(E2),"",GOOGLETRANSLATE(E2,"ru","en"))');
  });

  it('setFormulaSeparator: настройка сохраняется, формулы всех строк «Позиций» переписываются одной записью', async () => {
    const fake = new FakeSheetsApi();
    seedFake(fake, schemaOrder, { settings: { formulaSeparator: ',' } });
    fake.setLocale(SP, 'ru_RU');
    const store = new SheetsStore(fake, SP);
    await store.load();
    await store.bulkInsert('lines', [sampleLine, { ...sampleLine, id: 'ln_c2', customerName: 'Клапан', techParams: 'DN50' }]);
    expect((await store.load()).lines[0].customerNameEn).toBe('#ERROR!');
    const before = fake.writes().length;
    await store.setFormulaSeparator(';');
    const ue = fake.writes().slice(before).filter((c) => c.input === 'USER_ENTERED');
    expect(ue).toHaveLength(1);
    const ds = await store.load();
    expect(ds.settings.formulaSeparator).toBe(';');
    expect(ds.lines.map((l) => [l.customerNameEn, l.techParamsEn])).toEqual([['[en] Кран шаровой', undefined], ['[en] Клапан', '[en] DN50']]);
    expect(enAt(fake, 2)).toBe('=IF(ISBLANK(E3);"";GOOGLETRANSLATE(E3;"ru";"en"))');
    // строка, вбитая в таблицу (без формул), получает формулы; свой текст пользователя в колонке перевода не трогается
    const techCol = col(fake, 'Позиции', 'Tech EN (авто)');
    const row = new Array(techCol + 1).fill('');
    row[col(fake, 'Позиции', 'Название от заказчика')] = 'Насос';
    row[col(fake, 'Позиции', 'Кол-во')] = 2;
    row[techCol] = 'my own text';
    fake.insertRow(SP, 'Позиции', 3, row);
    const withNew = await store.load();
    await store.setFormulaSeparator(';');
    const after = (await store.load()).lines.find((l) => l.id === withNew.lines.find((x) => x.customerName === 'Насос')!.id)!;
    expect(after.customerNameEn).toBe('[en] Насос');
    expect(after.techParamsEn).toBe('my own text');
    // своя формула пользователя с GOOGLETRANSLATE (не шаблон приложения) не трогается
    await fake.update(SP, `'Позиции'!${String.fromCharCode(65 + techCol)}2`, [['=GOOGLETRANSLATE(E2,"ru","zh")']], { valueInputOption: 'USER_ENTERED' });
    await store.setFormulaSeparator(',');
    expect(fake.formulaAt(SP, 'Позиции', 1, techCol)).toBe('=GOOGLETRANSLATE(E2,"ru","zh")');
    expect(enAt(fake, 1)).toBe('=IF(ISBLANK(E2),"",GOOGLETRANSLATE(E2,"ru","en"))');
    await store.setFormulaSeparator(';');
    // новые строки — уже с новым разделителем
    await store.insert('lines', { ...sampleLine, id: 'ln_c3' });
    expect(enAt(fake, 4)).toContain(';');
  });
});

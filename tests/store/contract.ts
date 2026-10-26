// Общий контрактный набор для реализаций Store. Используют LocalStore (таск 01) и SheetsStore (таск 08).
// Вызов: storeContract('LocalStore', (seed) => ({ store, reopen, readReport })).

import { describe, expect, it } from 'vitest';
import type { Dataset, Order, Line, Rate, Supplier, Cost } from '../../src/domain/model';
import { ENTITY_NAMES } from '../../src/domain/model';
import type { ReportRow, ReportSheet, Store } from '../../src/store/types';
import { StoreError } from '../../src/store/types';
import { sheetFor } from '../../src/store/schema';

export interface ContractHarness {
  store: Store;
  /** Новый экземпляр хранилища над теми же данными — проверка, что записи действительно сохранены. */
  reopen(): Store | Promise<Store>;
  /** Содержимое листа отчёта, как его видит пользователь. */
  readReport(sheet: ReportSheet): ReportRow[] | Promise<ReportRow[]>;
}
export type HarnessFactory = (seed?: Partial<Dataset>) => ContractHarness | Promise<ContractHarness>;

// Записи без undefined-полей и с явными bool — такой вид они имеют после круга через таблицу.
export const sampleOrder: Order = { id: 'ord_c1', number: 41, date: '2026-10-01', department: 'Цех 1', payer: 'Плательщик А', customer: 'Заказчик Б', bitrixTaskId: '1001', calcDate: '2026-10-02', costsComplete: false, comment: 'Тест', createdAt: '2026-10-01T08:00:00.000Z' };
export const sampleLine: Line = { id: 'ln_c1', orderId: 'ord_c1', supplierOrderId: 'so_c1', seq: 1, customerName: 'Кран шаровой', qty: 720, unitPrice: 60.5, purchased: true, dutyRate: 7.5, cbm: 1.25, weight: 340.2, places: 12, coef: 1.5 };
export const sampleRate: Rate = { id: 'r_c1', date: '2026-10-01', currency: 'CNY', rate: 11.45, source: 'manual' };
export const sampleSupplier: Supplier = { id: 'sup_c1', name: 'Поставщик тест', city: 'Город', province: 'Провинция' };
export const sampleCost: Cost = { id: 'cost_c1', entryDate: '2026-10-03', status: 'plan', targetType: 'order', targetId: 'ord_c1', costType: 'Доставка', amount: 500, currency: 'USD', rateManual: false };

/** Убрать формульные колонки (перевод в «Позиции»): их значение вычисляет таблица, реализация может их вернуть. */
function withoutFormulas<T extends object>(entity: Parameters<typeof sheetFor>[0], records: T[]): T[] {
  const keys = sheetFor(entity).columns.filter((c) => c.type === 'formula').map((c) => c.key);
  return records.map((r) => {
    const copy = { ...r } as Record<string, unknown>;
    for (const k of keys) delete copy[k];
    return copy as T;
  });
}

const sortById = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

async function expectStoreError(p: Promise<unknown>, kind: StoreError['kind']) {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(StoreError);
  expect((err as StoreError).kind).toBe(kind);
}

export function storeContract(name: string, make: HarnessFactory): void {
  describe(`Store contract: ${name}`, () => {
    it('пустое хранилище: все сущности — пустые массивы, settings и meta — объекты', async () => {
      const { store } = await make();
      const ds = await store.load();
      for (const e of ENTITY_NAMES) expect(ds[e]).toEqual([]);
      expect(typeof ds.settings).toBe('object');
      expect(typeof ds.meta).toBe('object');
    });

    it('load возвращает начальные данные', async () => {
      const { store } = await make({ orders: [sampleOrder], rates: [sampleRate], settings: { vatRateDefault: '22' } });
      const ds = await store.load();
      expect(ds.orders).toEqual([sampleOrder]);
      expect(ds.rates).toEqual([sampleRate]);
      expect(ds.settings.vatRateDefault).toBe('22');
    });

    it('insert сохраняет запись со всеми типами полей', async () => {
      const h = await make();
      await h.store.insert('orders', sampleOrder);
      await h.store.insert('lines', sampleLine);
      await h.store.insert('costs', sampleCost);
      const ds = await (await h.reopen()).load();
      expect(ds.orders).toEqual([sampleOrder]);
      expect(withoutFormulas('lines', ds.lines)).toEqual([sampleLine]);
      expect(ds.costs).toEqual([sampleCost]);
    });

    it('update заменяет запись по id, остальные не трогает', async () => {
      const other: Order = { ...sampleOrder, id: 'ord_c2', number: 42 };
      const h = await make({ orders: [sampleOrder, other] });
      const changed: Order = { ...sampleOrder, customer: 'Новый заказчик', costsComplete: true, calcDate: '2026-11-11' };
      await h.store.update('orders', changed);
      const ds = await (await h.reopen()).load();
      expect(sortById(ds.orders)).toEqual(sortById([changed, other]));
    });

    it('update снимает необязательные поля: после reopen ключей нет', async () => {
      const h = await make({ orders: [sampleOrder], lines: [sampleLine] });
      const { calcDate: _d, comment: _c, customer: _u, ...cleared } = sampleOrder;
      await h.store.update('orders', cleared);
      const { dutyRate: _r, cbm: _b, customerName: _n, ...lineCleared } = sampleLine;
      await h.store.update('lines', lineCleared);
      const ds = await (await h.reopen()).load();
      expect(ds.orders).toEqual([cleared]);
      for (const k of ['calcDate', 'comment', 'customer']) expect(ds.orders[0]).not.toHaveProperty(k);
      expect(withoutFormulas('lines', ds.lines)).toEqual([lineCleared]);
      for (const k of ['dutyRate', 'cbm', 'customerName']) expect(ds.lines[0]).not.toHaveProperty(k);
    });

    it('update несуществующей записи → StoreError notFound', async () => {
      const h = await make({ orders: [sampleOrder] });
      await expectStoreError(h.store.update('orders', { ...sampleOrder, id: 'ord_missing' }), 'notFound');
    });

    it('remove удаляет запись; несуществующая → StoreError notFound', async () => {
      const h = await make({ suppliers: [sampleSupplier, { ...sampleSupplier, id: 'sup_c2', name: 'Второй' }] });
      await h.store.remove('suppliers', 'sup_c1');
      const ds = await (await h.reopen()).load();
      expect(ds.suppliers.map((s) => s.id)).toEqual(['sup_c2']);
      await expectStoreError(h.store.remove('suppliers', 'sup_c1'), 'notFound');
    });

    it('bulkInsert добавляет записи после существующих в том же порядке', async () => {
      const h = await make({ rates: [sampleRate] });
      const more: Rate[] = [
        { id: 'r_c2', date: '2026-10-02', currency: 'USD', rate: 81.1, source: 'vtb' },
        { id: 'r_c3', date: '2026-10-02', currency: 'EUR', rate: 94.7, source: 'vtb', comment: 'к' },
      ];
      await h.store.bulkInsert('rates', more);
      const ds = await (await h.reopen()).load();
      expect(ds.rates).toEqual([sampleRate, ...more]);
    });

    it('setSetting добавляет и перезаписывает ключ', async () => {
      const h = await make({ settings: { vatRateDefault: '22' } });
      await h.store.setSetting('bitrixPortalUrl', 'https://portal.example');
      await h.store.setSetting('vatRateDefault', '20');
      const ds = await (await h.reopen()).load();
      expect(ds.settings).toMatchObject({ bitrixPortalUrl: 'https://portal.example', vatRateDefault: '20' });
    });

    it('writeReport очищает лист отчёта и пишет новые строки', async () => {
      const h = await make();
      await h.store.writeReport('Себестоимость', [['Дата расчёта', '2026-10-25'], ['Позиция', 'Себестоимость'], ['Кран', 1030.5], ['Лишняя', 1]]);
      const rows: ReportRow[] = [['Дата расчёта', '2026-10-26'], ['Кран', 999.99, null]];
      await h.store.writeReport('Себестоимость', rows);
      expect(await h.readReport('Себестоимость')).toEqual(rows);
    });
  });
}

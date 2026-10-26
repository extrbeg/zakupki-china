import { describe, expect, it } from 'vitest';
import { LocalStore } from '../../src/store/localStore';
import { storeContract, sampleOrder } from './contract';
import { StoreError } from '../../src/store/types';

let n = 0;
storeContract('LocalStore', (seed) => {
  const key = `zk:test:${++n}`;
  const store = new LocalStore(key, seed);
  return {
    store,
    reopen: () => new LocalStore(key),
    readReport: (sheet) => new LocalStore(key).readReport(sheet),
  };
});

describe('LocalStore', () => {
  it('kind = local; seed применяется только к пустому хранилищу', async () => {
    const first = new LocalStore('zk:test:seed', { orders: [sampleOrder] });
    expect(first.kind).toBe('local');
    await first.remove('orders', sampleOrder.id);
    const again = new LocalStore('zk:test:seed', { orders: [sampleOrder] });
    expect((await again.load()).orders).toEqual([]);
  });

  it('insert с существующим id → StoreError conflict', async () => {
    const s = new LocalStore('zk:test:dup', { orders: [sampleOrder] });
    const err = await s.insert('orders', sampleOrder).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).kind).toBe('conflict');
  });

  it('load отдаёт копию: правка результата не меняет хранилище', async () => {
    const s = new LocalStore('zk:test:copy', { orders: [sampleOrder] });
    const ds = await s.load();
    ds.orders[0].customer = 'испорчено';
    ds.orders.push({ ...sampleOrder, id: 'x' });
    expect((await s.load()).orders).toEqual([sampleOrder]);
  });

  it('повреждённые данные в localStorage → пустой набор с seed, без падения', async () => {
    localStorage.setItem('zk:test:broken', '{не json');
    const s = new LocalStore('zk:test:broken', { orders: [sampleOrder] });
    expect((await s.load()).orders).toEqual([sampleOrder]);
  });
});

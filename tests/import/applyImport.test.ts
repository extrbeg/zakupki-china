import { describe, expect, it } from 'vitest';
import { applyImport, hasUserData, mapLegacy } from '../../src/import';
import { LocalStore } from '../../src/store/localStore';
import { emptyDataset, type Dataset } from '../../src/domain/model';
import { SYNTHETIC_LEGACY } from '../../fixtures/legacy/synthetic';

let n = 0;
const store = (seed?: Partial<Dataset>) => new LocalStore(`zk:t:import${++n}`, seed);
const plan = () => mapLegacy(SYNTHETIC_LEGACY, '2026-10-25');

describe('applyImport', () => {
  it('в пустую таблицу переносит всё из плана, связи между записями сохраняются', async () => {
    const s = store();
    const p = plan();
    const result = await applyImport(p, s);
    const ds = await s.load();
    for (const [entity, count] of Object.entries(p.stats)) expect(ds[entity as keyof Dataset], entity).toHaveLength(count);
    expect(result.inserted).toEqual(p.stats);
    expect(result.skipped).toEqual([]);
    const order = ds.orders.find((o) => o.number === 1)!;
    expect(ds.costs.filter((c) => c.targetId === order.id)).toHaveLength(3);
    expect(ds.lines.filter((l) => l.orderId === order.id).every((l) => ds.supplierOrders.some((so) => so.id === l.supplierOrderId))).toBe(true);
  });

  it('добавление к существующим: без повторов списков, городов, курсов и поставщиков; заказ с занятым номером пропущен целиком', async () => {
    const s = store({
      lists: [{ id: 'l1', list: 'costType', value: 'комиссия  банка', order: 7 }],
      cities: [{ id: 'c1', city: 'ningbo', province: 'Zhejiang' }],
      rates: [{ id: 'r1', date: '2026-03-05', currency: 'CNY', rate: 12.3, source: 'manual' }],
      suppliers: [{ id: 's-old', name: 'Alpha Valve Co' }],
      orders: [{ id: 'o-old', number: 1, date: '2026-01-01', costsComplete: false }],
    });
    const result = await applyImport(plan(), s);
    const ds = await s.load();

    expect(ds.lists.filter((l) => l.list === 'costType').map((l) => [l.value, l.order])).toEqual([['комиссия  банка', 7], ['Аванс поставщику', 8]]);
    expect(ds.cities.filter((c) => c.city.toLowerCase() === 'ningbo')).toHaveLength(1);
    expect(ds.rates.filter((r) => r.date === '2026-03-05' && r.currency === 'CNY').map((r) => r.rate)).toEqual([12.3]);
    expect(ds.suppliers.filter((x) => x.name.toLowerCase().replace(/\s/g, '') === 'alphavalveco').map((x) => x.id)).toEqual(['s-old']);

    expect(ds.orders.map((o) => o.number).sort((a, b) => a - b)).toEqual([1, 3, 46039]);
    expect(ds.orders.find((o) => o.number === 1)?.id).toBe('o-old');
    expect(ds.costs.some((c) => c.targetId === 'o-old')).toBe(false);
    expect(ds.shipments).toEqual([]);
    expect(ds.batches).toEqual([]);
    const o46039 = ds.orders.find((o) => o.number === 46039)!;
    expect(ds.supplierOrders.find((so) => so.orderId === o46039.id)?.supplierId).toBe('s-old');
    expect(ds.lines.every((l) => ds.orders.some((o) => o.id === l.orderId))).toBe(true);
    expect(result.skipped).toEqual([{ sheet: 'Заказы', row: 3, message: expect.stringMatching(/заказ № 1 уже есть в таблице/i) }]);
  });
});

describe('hasUserData', () => {
  it('списки по умолчанию и настройки — не данные; заказ или поставщик — данные', () => {
    const fresh = { ...emptyDataset(), lists: [{ id: 'l', list: 'costType' as const, value: 'Аванс', order: 1 }], settings: { vatRateDefault: '22' } };
    expect(hasUserData(fresh)).toBe(false);
    expect(hasUserData({ ...fresh, orders: [{ id: 'o', number: 1, date: '2026-01-01', costsComplete: false }] })).toBe(true);
    expect(hasUserData({ ...fresh, suppliers: [{ id: 's', name: 'X' }] })).toBe(true);
  });
});

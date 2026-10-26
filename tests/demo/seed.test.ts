import { describe, expect, it } from 'vitest';
import { createDemoStore, demoSeed, DEMO_STORAGE_KEY } from '../../src/demo';
import { ENTITY_NAMES } from '../../src/domain/model';

describe('демо-набор', () => {
  it('2–3 заказа, поставщики, курсы трёх валют', () => {
    const ds = demoSeed();
    expect(ds.orders!.length).toBeGreaterThanOrEqual(2);
    expect(ds.orders!.length).toBeLessThanOrEqual(3);
    expect(ds.suppliers!.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ds.rates!.map((r) => r.currency))).toEqual(new Set(['CNY', 'USD', 'EUR']));
  });

  it('ссылки между записями целы, id уникальны', () => {
    const ds = demoSeed();
    const ids = (xs: { id: string }[] | undefined) => new Set((xs ?? []).map((x) => x.id));
    for (const e of ENTITY_NAMES) {
      const list = (ds[e] ?? []) as { id: string }[];
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    const orders = ids(ds.orders), sos = ids(ds.supplierOrders), sups = ids(ds.suppliers), lines = ids(ds.lines);
    const shipments = ids(ds.shipments), decls = ids(ds.declarations), carriers = ids(ds.carriers);
    for (const so of ds.supplierOrders!) { expect(orders.has(so.orderId)).toBe(true); expect(sups.has(so.supplierId)).toBe(true); }
    for (const l of ds.lines!) {
      expect(orders.has(l.orderId)).toBe(true);
      const so = ds.supplierOrders!.find((s) => s.id === l.supplierOrderId);
      expect(so?.orderId).toBe(l.orderId);
    }
    for (const b of ds.batches ?? []) {
      expect(shipments.has(b.shipmentId)).toBe(true);
      expect(lines.has(b.lineId)).toBe(true);
      if (b.declarationId) expect(decls.has(b.declarationId)).toBe(true);
    }
    for (const s of ds.shipments ?? []) if (s.carrierId) expect(carriers.has(s.carrierId)).toBe(true);
    const targets: Record<string, Set<string>> = { order: orders, supplierOrder: sos, shipment: shipments, declaration: decls, line: lines };
    for (const c of ds.costs ?? []) expect(targets[c.targetType].has(c.targetId)).toBe(true);
  });

  it('AD (G05): у каждого поставщика в заказе свой AD, у одной позиции — своё переопределение, отличное от AD поставщика', () => {
    const ds = demoSeed();
    for (const so of ds.supplierOrders!) expect(so.coef, so.id).toBeGreaterThan(0);
    const overrides = ds.lines!.filter((l) => l.coef !== undefined);
    expect(overrides).toHaveLength(1);
    const so = ds.supplierOrders!.find((s) => s.id === overrides[0].supplierOrderId)!;
    expect(overrides[0].coef).not.toBe(so.coef);
  });

  it('createDemoStore сидит данные один раз и хранит их в localStorage', async () => {
    const store = createDemoStore();
    expect(store.kind).toBe('local');
    const ds = await store.load();
    expect(ds.orders.length).toBeGreaterThanOrEqual(2);
    expect(localStorage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();
    await store.remove('orders', ds.orders[0].id);
    expect((await createDemoStore().load()).orders).toHaveLength(ds.orders.length - 1);
  });
});

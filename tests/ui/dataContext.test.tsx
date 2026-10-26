import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { DataProvider, useData } from '../../src/ui/DataContext';
import { LocalStore } from '../../src/store/localStore';
import { StoreError, type Store } from '../../src/store/types';
import { emptyDataset, type Order } from '../../src/domain/model';
import { computeCosting } from '../../src/domain/costing';

const order: Order = { id: 'ord_1', number: 1, date: '2026-10-01', costsComplete: false };

function setup(store: Store) {
  const wrapper = ({ children }: { children: ReactNode }) => <DataProvider store={store} today="2026-10-25">{children}</DataProvider>;
  return renderHook(() => useData(), { wrapper });
}

describe('DataContext / useData', () => {
  it('загружает данные из хранилища и отдаёт today', async () => {
    const { result } = setup(new LocalStore('zk:t:dc1', { orders: [order] }));
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.ds.orders).toEqual([order]);
    expect(result.current.today).toBe('2026-10-25');
    expect(result.current.store.kind).toBe('local');
  });

  it('save вставляет новую запись, затем обновляет существующую; ds и хранилище меняются', async () => {
    const store = new LocalStore('zk:t:dc2');
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.save('orders', order));
    expect(result.current.ds.orders).toEqual([order]);
    const changed = { ...order, customer: 'Заказчик' };
    await act(() => result.current.save('orders', changed));
    expect(result.current.ds.orders).toEqual([changed]);
    expect((await store.load()).orders).toEqual([changed]);
  });

  it('remove убирает запись из ds и хранилища', async () => {
    const store = new LocalStore('zk:t:dc3', { orders: [order] });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.remove('orders', order.id));
    expect(result.current.ds.orders).toEqual([]);
    expect((await store.load()).orders).toEqual([]);
  });

  it('ошибка сохранения пробрасывается вызывающему, ds не меняется', async () => {
    const store = new LocalStore('zk:t:dc4');
    store.insert = async () => { throw new StoreError('network'); };
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    let caught: unknown;
    await act(async () => { await result.current.save('orders', order).catch((e: unknown) => { caught = e; }); });
    expect(caught).toBeInstanceOf(StoreError);
    expect(result.current.ds.orders).toEqual([]);
  });

  it('costing — результат computeCosting по загруженным данным и today', async () => {
    const { result } = setup(new LocalStore('zk:t:dc5', { orders: [order] }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.costing).toEqual(computeCosting(result.current.ds, '2026-10-25'));
    expect(result.current.costing.orders.map((o) => o.orderId)).toEqual(['ord_1']);
  });

  it('сбой загрузки → status error с StoreError; reload повторяет', async () => {
    let fail = true;
    const base = new LocalStore('zk:t:dc6', { orders: [order] });
    const store: Store = Object.assign(Object.create(base) as Store, {
      load: () => (fail ? Promise.reject(new StoreError('network')) : base.load()),
    });
    const { result } = setup(store);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.kind).toBe('network');
    expect(result.current.ds).toEqual(emptyDataset());
    fail = false;
    await act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeUndefined();
    expect(result.current.ds.orders).toEqual([order]);
  });

  it('useData вне DataProvider — понятная ошибка', () => {
    const Probe = () => { useData(); return null; };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/DataProvider/);
    quiet.mockRestore();
  });
});

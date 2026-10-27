import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Cost, Dataset, EntityName } from '../../../src/domain/model';
import { LocalStore } from '../../../src/store/localStore';
import { renderAt, renderWithStore } from './helpers';

/** Вторая запись партии падает один раз — как сбой сети посреди «Добавить». */
class FlakyBatchStore extends LocalStore {
  batchInserts = 0;
  override async insert<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    if (entity === 'batches' && ++this.batchInserts === 2) throw new Error('сбой записи');
    return super.insert(entity, record);
  }
}

const rub = (id: string, targetType: Cost['targetType'], targetId: string, costType: string, amount: number): Cost =>
  ({ id, entryDate: '2026-10-01', paymentDate: '2026-10-01', status: 'fact', targetType, targetId, costType, amount, currency: 'RUB', rateManual: false });

// Заказ З-2026-012: кран 1000 шт (10 CBM, 500 кг), фланец 100 шт, «не в работе» 5 шт.
// Заказ З-2026-006 едет в той же поставке П-2026-001: кабель 4 CBM.
const seed: Partial<Dataset> = {
  suppliers: [{ id: 's1', name: 'Alpha Valve' }, { id: 's2', name: 'Beta Cable' }],
  orders: [
    { id: 'o12', number: 12, code: 'З-2026-012', date: '2026-09-01', costsComplete: false },
    { id: 'o6', number: 6, code: 'З-2026-006', date: '2026-08-01', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'RUB' },
    { id: 'so6', orderId: 'o6', seq: 1, supplierId: 's2', currency: 'RUB' },
  ],
  lines: [
    { id: 'l1', orderId: 'o12', supplierOrderId: 'so1', seq: 1, customerName: 'Кран шаровой', qty: 1000, unitPrice: 10, purchased: true, cbm: 10, weight: 500, places: 20 },
    { id: 'l2', orderId: 'o12', supplierOrderId: 'so1', seq: 2, customerName: 'Фланец', qty: 100, unitPrice: 1, purchased: true },
    { id: 'l3', orderId: 'o12', supplierOrderId: 'so1', seq: 3, customerName: 'Не в работе', qty: 5, unitPrice: 1, purchased: false },
    { id: 'l6', orderId: 'o6', supplierOrderId: 'so6', seq: 1, customerName: 'Кабель', qty: 100, unitPrice: 1, purchased: true },
  ],
  shipmentTypes: [{ id: 'stp_sea', name: 'Море, контейнер', basis: 'cbm' }],
  shipments: [{ id: 'sh1', number: 'П-2026-001', mode: 'sea_container', typeId: 'stp_sea', vatRate: 20, sentDate: '2026-10-05' }],
  batches: [
    { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 600, cbm: 6, weight: 300 },
    { id: 'b6', shipmentId: 'sh1', lineId: 'l6', qty: 100, cbm: 4, weight: 900 },
  ],
  costs: [rub('c1', 'shipment', 'sh1', 'Доставка', 10000)],
};

describe('поставки в карточке заказа (G30)', () => {
  it('поставка с товарами заказа, отгружено/остаток и долей затрат поставки — 60 % доставки по CBM', async () => {
    renderAt('/orders/o12', seed);
    const section = await screen.findByRole('region', { name: 'Поставки' });
    const card = within(section).getByTestId('order-shipment-sh1');
    expect(within(card).getByRole('link', { name: 'П-2026-001' }).getAttribute('href')).toBe('/shipments/sh1');
    expect(within(card).getByText(/Море, контейнер · отправка в РФ 05\.10\.2026/)).toBeTruthy();
    const row = within(card).getByText('1. Кран шаровой').closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells).toEqual(['Alpha Valve', '1. Кран шаровой', '600', '6', '300', '600 из 1000', '400']);
    expect(within(card).queryByText(/Кабель/)).toBeNull();   // чужой заказ в этой поставке не показывается
    const share = within(card).getByTestId('order-shipment-share-sh1');
    expect(share.textContent).toMatch(/Затраты поставки на заказ: 6\s000,00 ₽/);
    expect(share.textContent).toMatch(/Доставка — 60 % \(6\s000,00 ₽\)/);
  });

  it('«Отправить в поставку» → «Новая поставка»: номер сам, товары «В работе» с остатком целиком → партии', async () => {
    const { store } = renderAt('/orders/o12', seed);
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить в поставку' }));
    const form = screen.getByRole('form', { name: 'Отправить в поставку' });
    fireEvent.change(within(form).getByLabelText(/^Поставка/), { target: { value: '__new__' } });
    expect(within(form).getByRole('option', { name: 'Новая поставка (П-2026-002)' })).toBeTruthy();
    expect((within(form).getByLabelText('В поставку: Кран шаровой') as HTMLInputElement).value).toBe('400');
    expect((within(form).getByLabelText('В поставку: Фланец') as HTMLInputElement).value).toBe('100');
    expect(within(form).queryByLabelText('В поставку: Не в работе')).toBeNull();
    fireEvent.change(within(form).getByLabelText('В поставку: Кран шаровой'), { target: { value: '500' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(await within(form).findByText('В партиях 1100 из 1000 шт')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('В поставку: Кран шаровой'), { target: { value: '200' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(4));
    const saved = await store.load();
    const created = saved.shipments.find((s) => s.id !== 'sh1')!;
    expect(created).toMatchObject({ number: 'П-2026-002', typeId: 'stp_sea' });
    const added = saved.batches.filter((b) => b.shipmentId === created.id);
    expect(added.map((b) => [b.lineId, b.qty])).toEqual([['l1', 200], ['l2', 100]]);
    expect(added[0]).toMatchObject({ cbm: 2, weight: 100, places: 4 });
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Добавлено в поставку П-2026-002: товаров 2/);
    expect(await screen.findByTestId(`order-shipment-${created.id}`)).toBeTruthy();
  });

  it('в существующую поставку; всё отправлено — кнопки нет', async () => {
    const { store } = renderAt('/orders/o12', seed);
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить в поставку' }));
    const form = screen.getByRole('form', { name: 'Отправить в поставку' });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(await within(form).findByText('Выберите поставку')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/^Поставка/), { target: { value: 'sh1' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(4));
    expect((await store.load()).shipments).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отправить в поставку' })).toBeNull());
  });

  it('сбой записи партии в новую поставку: повтор пишет оставшиеся партии в ту же поставку, без дублей', async () => {
    const store = new FlakyBatchStore('zk:t:ordflaky', seed);
    renderWithStore('/orders/o12', store);
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить в поставку' }));
    const form = screen.getByRole('form', { name: 'Отправить в поставку' });
    fireEvent.change(within(form).getByLabelText(/^Поставка/), { target: { value: '__new__' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(await within(form).findByRole('alert')).toBeTruthy();
    let saved = await store.load();
    expect(saved.shipments).toHaveLength(2);
    expect(saved.batches).toHaveLength(3);
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(4));
    saved = await store.load();
    expect(saved.shipments).toHaveLength(2);
    const created = saved.shipments.find((s) => s.id !== 'sh1')!;
    const added = saved.batches.filter((b) => b.shipmentId === created.id);
    expect(added.map((b) => [b.lineId, b.qty]).sort()).toEqual([['l1', 400], ['l2', 100]]);
  });
});

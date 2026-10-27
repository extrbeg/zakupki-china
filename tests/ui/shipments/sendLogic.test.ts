import { describe, expect, it } from 'vitest';
import { emptyDataset, type Dataset } from '../../../src/domain/model';
import { newShipmentDraft, orderSearchText, planSendBatches, sendQtyErrors, sendableLines } from '../../../src/ui/screens/shipments/sendLogic';

const ds = (): Dataset => ({
  ...emptyDataset(),
  settings: { vatRateDefault: '20' },
  suppliers: [{ id: 'sA', name: 'Alpha Valve' }, { id: 'sB', name: 'Beta Cable' }],
  orders: [{ id: 'o1', number: 3, code: 'З-2026-003', date: '2026-09-01', customer: 'ТНК', costsComplete: false }],
  supplierOrders: [
    { id: 'so2', orderId: 'o1', seq: 2, supplierId: 'sB', currency: 'CNY' },
    { id: 'so1', orderId: 'o1', seq: 1, supplierId: 'sA', currency: 'CNY' },
  ],
  lines: [
    { id: 'l3', orderId: 'o1', supplierOrderId: 'so2', seq: 1, customerName: 'Кабель', qty: 50, unitPrice: 5, purchased: true },
    { id: 'l1', orderId: 'o1', supplierOrderId: 'so1', seq: 1, customerName: 'Кран', qty: 1000, unitPrice: 100, purchased: true, cbm: 10, weight: 500, places: 20 },
    { id: 'l2', orderId: 'o1', supplierOrderId: 'so1', seq: 2, customerName: 'Не в работе', qty: 5, unitPrice: 1, purchased: false },
    { id: 'l4', orderId: 'o1', supplierOrderId: 'so1', seq: 3, customerName: 'Уехал весь', qty: 10, unitPrice: 1, purchased: true },
  ],
  shipments: [{ id: 'sh1', number: 'П-2026-004', mode: 'sea_container', vatRate: 20 }],
  batches: [
    { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 400 },
    { id: 'b2', shipmentId: 'sh1', lineId: 'l4', qty: 10 },
  ],
});

describe('товары заказа для отправки в поставку', () => {
  it('только «В работе» с неотгруженным остатком, по поставщику и номеру; остаток = кол-во − партии', () => {
    const rows = sendableLines(ds(), 'o1');
    expect(rows.map((r) => r.line.id)).toEqual(['l1', 'l3']);
    expect(rows[0]).toMatchObject({ supplierName: 'Alpha Valve', title: 'Кран', shipped: 400, remaining: 600 });
    expect(rows[1]).toMatchObject({ supplierName: 'Beta Cable', remaining: 50 });
  });

  it('больше остатка — «В партиях 1100 из 1000 шт»; не число — «Введите число»; 0 и пусто — не отправляется', () => {
    const d = ds();
    const rows = sendableLines(d, 'o1');
    expect(sendQtyErrors(d, rows, { l1: 700, l3: 50 })).toEqual({ l1: 'В партиях 1100 из 1000 шт' });
    expect(sendQtyErrors(d, rows, { l1: NaN })).toEqual({ l1: 'Введите число' });
    expect(sendQtyErrors(d, rows, { l1: -1 })).toEqual({ l1: 'Количество не может быть отрицательным' });
    expect(sendQtyErrors(d, rows, { l1: 0, l3: undefined })).toEqual({ _form: 'Укажите количество хотя бы у одного товара' });
  });

  it('партии — на указанное количество, CBM/вес/места пропорционально позиции', () => {
    const d = ds();
    const batches = planSendBatches(d, 'sh9', sendableLines(d, 'o1'), { l1: 600, l3: 0 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ shipmentId: 'sh9', lineId: 'l1', qty: 600, cbm: 6, weight: 300, places: 12 });
    expect(batches[0].id).toMatch(/^bat/);
  });

  it('новая поставка: номер следующий в году, тип «Море, контейнер», НДС из настроек', () => {
    expect(newShipmentDraft(ds(), '2026-10-25')).toMatchObject({ number: 'П-2026-005', typeId: 'stp_sea', mode: 'sea_container', vatRate: 20 });
  });

  it('поиск заказа — по коду и заказчику', () => {
    const t = orderSearchText(ds().orders[0]);
    expect(t).toContain('З-2026-003');
    expect(t).toContain('ТНК');
  });
});

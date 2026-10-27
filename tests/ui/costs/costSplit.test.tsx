import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Cost, Dataset } from '../../../src/domain/model';
import CostsScreen from '../../../src/ui/screens/costs/CostsScreen';

let counter = 0;
function renderCosts(seed: Partial<Dataset>, path = '/costs') {
  const store = new LocalStore(`zk:t:split${++counter}`, seed);
  render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider store={store} today="2026-10-25"><CostsScreen /></DataProvider>
    </MemoryRouter>,
  );
  return { store };
}

const cost = (over: Partial<Cost> & Pick<Cost, 'id' | 'targetType' | 'targetId' | 'costType'>): Cost =>
  ({ entryDate: '2026-10-01', paymentDate: '2026-10-01', status: 'fact', currency: 'RUB', rateManual: false, ...over });

// П-2026-001 (море, по CBM): З-2026-012 — 6 CBM / 300 кг, З-2026-006 — 4 CBM / 900 кг.
const seed: Partial<Dataset> = {
  suppliers: [{ id: 's1', name: 'Alpha Valve' }],
  orders: [
    { id: 'o12', number: 12, code: 'З-2026-012', date: '2026-09-01', costsComplete: false },
    { id: 'o6', number: 6, code: 'З-2026-006', date: '2026-08-01', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'RUB' },
    { id: 'so6', orderId: 'o6', seq: 1, supplierId: 's1', currency: 'RUB' },
  ],
  lines: [
    { id: 'l1', orderId: 'o12', supplierOrderId: 'so1', seq: 1, customerName: 'Кран', qty: 100, unitPrice: 10, purchased: true },
    { id: 'l6', orderId: 'o6', supplierOrderId: 'so6', seq: 1, customerName: 'Кабель', qty: 100, unitPrice: 10, purchased: true },
  ],
  shipmentTypes: [{ id: 'stp_sea', name: 'Море, контейнер', basis: 'cbm' }],
  shipments: [{ id: 'sh1', number: 'П-2026-001', mode: 'sea_container', typeId: 'stp_sea', vatRate: 20 }],
  batches: [
    { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 100, cbm: 6, weight: 300 },
    { id: 'b6', shipmentId: 'sh1', lineId: 'l6', qty: 100, cbm: 4, weight: 900 },
  ],
};

const set = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('разбивка затраты поставки по заказам в форме (G31)', () => {
  it('новая затрата на поставку: до сохранения — предварительно 60 % / 40 % по CBM; СВХ — по весу', async () => {
    renderCosts(seed, '/costs?add=shipment:sh1');
    const form = await screen.findByRole('form', { name: 'Новая затрата' });
    expect(within(form).getByText(/Введите сумму/)).toBeTruthy();
    set(/^Тип затраты/, 'Доставка');
    set(/^Сумма в валюте/, '10000');
    const split = within(form).getByRole('region', { name: /Как делится по заказам/ });
    expect(split.textContent).toMatch(/предварительно/);
    expect(split.textContent).toMatch(/по объёму \(CBM\) — правило типа поставки «Море, контейнер»/);
    const items = within(split).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '));
    expect(items).toEqual(['Заказ З-2026-006 — 40 % (4 000,00 ₽)', 'Заказ З-2026-012 — 60 % (6 000,00 ₽)']);
    set(/^Тип затраты/, 'СВХ');
    const items2 = within(within(form).getByRole('region', { name: /Как делится по заказам/ })).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s/g, ' '));
    expect(items2).toEqual(['Заказ З-2026-006 — 75 % (7 500,00 ₽)', 'Заказ З-2026-012 — 25 % (2 500,00 ₽)']);
  });

  it('сохранённая затрата — без пометки «предварительно»', async () => {
    renderCosts({ ...seed, costs: [cost({ id: 'c1', targetType: 'shipment', targetId: 'sh1', costType: 'Доставка', amount: 10000, rate: 1, amountRub: 10000, comment: 'доставка' })] });
    fireEvent.click((await screen.findByText('доставка')).closest('tr')!);
    const split = screen.getByRole('region', { name: /Как делится по заказам/ });
    expect(split.textContent).not.toMatch(/предварительно/);
    expect(split.textContent).toMatch(/З-2026-012 — 60 %/);
  });

  it('поставка без партий — вся сумма «не распределена»', async () => {
    renderCosts({ ...seed, batches: [] }, '/costs?add=shipment:sh1');
    set(/^Тип затраты/, 'Доставка');
    set(/^Сумма в валюте/, '5000');
    const split = screen.getByRole('region', { name: /Как делится по заказам/ });
    expect(split.textContent?.replace(/\s/g, ' ')).toMatch(/Не распределено: 5 000,00 ₽/);
  });
});

describe('журнал по заказу — доли поставок (G31)', () => {
  const costs = [
    cost({ id: 'c1', targetType: 'shipment', targetId: 'sh1', costType: 'Доставка', amount: 10000, rate: 1, amountRub: 10000, comment: 'доставка' }),
    cost({ id: 'c2', targetType: 'order', targetId: 'o12', costType: 'Аванс', amount: 1000, rate: 1, amountRub: 1000, comment: 'аванс' }),
    cost({ id: 'c3', targetType: 'order', targetId: 'o6', costType: 'Аванс', amount: 300, rate: 1, amountRub: 300, comment: 'чужой' }),
  ];

  it('фильтр «Заказ»: прямые затраты и строка «доля поставки П-…» с рублями доли; итог включает долю', async () => {
    renderCosts({ ...seed, costs }, '/costs?order=o12');
    const row = (await screen.findByText(/доля поставки П-2026-001/)).closest('tr')!;
    expect(within(row).getByText(/60 % от 10\s000,00 ₽/)).toBeTruthy();
    expect(within(row).getByTestId('share-rub').textContent?.replace(/\s/g, ' ')).toBe('6 000,00');
    expect(screen.getByText('аванс')).toBeTruthy();
    expect(screen.queryByText('чужой')).toBeNull();
    const total = screen.getByText(/^Итого:/).closest('td')!;
    expect(total.textContent?.replace(/\s/g, ' ')).toMatch(/факт 7 000,00 ₽/);
  });

  it('без фильтра заказа долей нет — затрата поставки одной строкой', async () => {
    renderCosts({ ...seed, costs });
    await screen.findByText('доставка');
    expect(screen.queryByText(/доля поставки/)).toBeNull();
    const total = screen.getByText(/^Итого:/).closest('td')!;
    expect(total.textContent?.replace(/\s/g, ' ')).toMatch(/факт 11 300,00 ₽/);
  });

  it('затрата поставки без курса — строкой «доля поставки П-…» без суммы и в счёте «без курса»', async () => {
    const noRate = cost({ id: 'c9', targetType: 'shipment', targetId: 'sh1', costType: 'Доставка', amount: 100, currency: 'USD', comment: 'без курса' });
    renderCosts({ ...seed, costs: [...costs, noRate] }, '/costs?order=o12');
    const row = (await screen.findByText('без курса')).closest('tr')!;
    expect(within(row).getByText(/доля поставки П-2026-001/)).toBeTruthy();
    expect(within(row).queryByTestId('share-rub')).toBeNull();
    const total = screen.getByText(/^Итого:/).closest('td')!;
    expect(total.textContent?.replace(/\s/g, ' ')).toMatch(/факт 7 000,00 ₽/);
    expect(total.textContent).toMatch(/без курса: 1/);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset } from '../../../src/domain/model';
import CostingScreen from '../../../src/ui/screens/costing/CostingScreen';

afterEach(cleanup);

let counter = 0;

const seed: Partial<Dataset> = {
  rates: [{ id: 'r1', date: '2026-10-01', currency: 'CNY', rate: 10, source: 'vtb' }],
  suppliers: [{ id: 's1', name: 'Alpha Valve' }, { id: 's2', name: 'Beta Cable' }],
  orders: [
    { id: 'o12', number: 12, date: '2026-09-01', title: 'Краны', customer: 'Заказчик Север', calcDate: '2026-10-01', costsComplete: false },
    { id: 'o6', number: 6, date: '2026-08-01', title: 'Кабель', customer: 'Заказчик Юг', calcDate: '2026-10-01', costsComplete: true },
  ],
  supplierOrders: [
    { id: 'so12', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'CNY' },
    { id: 'so6', orderId: 'o6', seq: 1, supplierId: 's2', currency: 'CNY' },
  ],
  lines: [
    { id: 'l12', orderId: 'o12', supplierOrderId: 'so12', seq: 1, customerName: 'Кран DN50', qty: 100, unitPrice: 5, purchased: true, coef: 1.5 },
    { id: 'l6', orderId: 'o6', supplierOrderId: 'so6', seq: 1, customerName: 'Кабель ВВГ', qty: 10, unitPrice: 10, purchased: true, coef: 2 },
  ],
  shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container', vatRate: 22 }],
  batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l12', qty: 60 }],
  costs: [
    { id: 'c1', entryDate: '2026-10-01', status: 'fact', targetType: 'order', targetId: 'o12', costType: 'Предоплата 100 %', amount: 5000, currency: 'RUB', rateManual: false },
    { id: 'c2', entryDate: '2026-10-01', status: 'fact', targetType: 'line', targetId: 'l12', costType: 'Прочее', amount: 7500, currency: 'RUB', rateManual: false },
    { id: 'c3', entryDate: '2026-10-01', status: 'fact', targetType: 'line', targetId: 'l6', costType: 'Прочее', amount: 200, currency: 'RUB', rateManual: false },
  ],
};

async function renderCosting() {
  const store = new LocalStore(`zk:t:costing${++counter}`, seed);
  render(
    <MemoryRouter>
      <DataProvider store={store} today="2026-10-25">
        <CostingScreen />
      </DataProvider>
    </MemoryRouter>,
  );
  await screen.findByLabelText('Поиск заказа');
  return { store };
}

const pick = (name: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name }));
const norm = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

describe('экран «Себестоимость»', () => {
  it('ничего не выбрано — подсказка «Выберите заказы», таблицы нет', async () => {
    await renderCosting();
    expect(screen.getByText('Выберите заказы')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('поиск по названию сужает список заказов для выбора', async () => {
    await renderCosting();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Поиск заказа'), { target: { value: 'кабел' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: /№ 6/ })).toBeTruthy();
  });

  it('выбранный заказ — строка позиции с AD, AV, AW, отклонением и пометкой «предварительно»', async () => {
    await renderCosting();
    pick(/№ 12/);
    const row = screen.getByRole('row', { name: /Кран DN50/ });
    const text = norm(row.textContent);
    expect(text).toContain('Alpha Valve');
    expect(text).toContain('12 500,00');   // себестоимость позиции: 5000 + 7500
    expect(text).toContain('125,00');      // AV
    expect(text).toContain('2,50');        // AW = 125 / 50
    expect(text).toContain('1,50');        // AD
    expect(text).toContain('+66,7');       // отклонение, %
    expect(text).toContain('предварительно');
    expect(within(row).getByTestId('deviation').className).toContain('costing-dev--bad');
    expect(screen.queryByRole('row', { name: /Кабель ВВГ/ })).toBeNull();
  });

  it('названия коэффициентов: «Расч. коэфф.» / «Факт. коэфф.» с полным названием в подсказке; итог «Прогноз по …» — полным названием', async () => {
    await renderCosting();
    pick(/№ 12/);
    const heads = screen.getAllByRole('columnheader');
    const ad = heads.find((th) => norm(th.textContent) === 'Расч. коэфф.') as HTMLElement;
    const aw = heads.find((th) => norm(th.textContent) === 'Факт. коэфф.') as HTMLElement;
    expect(ad.title).toMatch(/^Расчётный коэффициент себестоимости доставки \(AD\)/);
    expect(aw.title).toMatch(/^Фактический коэффициент себестоимости доставки \(AW\)/);
    expect(heads.some((th) => ['AD', 'AW'].includes(norm(th.textContent)))).toBe(false);
    expect(within(screen.getByTestId('totals')).getByText('Прогноз по расчётному коэффициенту себестоимости доставки, ₽')).toBeTruthy();
    expect(within(screen.getByTestId('totals')).queryByText(/по AD/)).toBeNull();
  });

  it('закрытый заказ: AW без пометки, лучше прогноза — зелёное отклонение', async () => {
    await renderCosting();
    pick(/№ 6/);
    const row = screen.getByRole('row', { name: /Кабель ВВГ/ });
    // Y = 100 ₽, AV = 200 / 10 = 20, AW = 0,2 против AD 2 → −90 %
    expect(norm(row.textContent)).toContain('0,20');
    expect(norm(row.textContent)).not.toContain('предварительно');
    expect(norm(within(row).getByTestId('deviation').textContent)).toContain('−90,0');
    expect(within(row).getByTestId('deviation').className).toContain('costing-dev--good');
  });

  it('раскрытие позиции: партии с неотгруженным остатком и разбивка по категориям', async () => {
    await renderCosting();
    pick(/№ 12/);
    fireEvent.click(screen.getByRole('button', { name: /Раскрыть: Кран DN50/ }));
    const detail = screen.getByTestId('line-detail-l12');
    const text = norm(detail.textContent);
    expect(text).toContain('К-7');
    expect(text).toContain('Неотгруженный остаток');
    expect(text).toContain('Прямые');
    expect(text).toContain('Товар');
    expect(within(detail).getAllByRole('row', { name: /К-7|Неотгруженный остаток/ })).toHaveLength(2);
  });

  it('итоги выбора и предупреждения только выбранных заказов, со ссылкой на заказ', async () => {
    await renderCosting();
    pick(/№ 12/);
    expect(norm(screen.getByTestId('totals').textContent)).toContain('12 500,00');
    const link = screen.getByRole('link', { name: 'Заказ № 12' });
    expect(link.getAttribute('href')).toBe('/orders/o12');
    expect(screen.queryByRole('link', { name: 'Заказ № 6' })).toBeNull();
  });

  it('«Записать в таблицу» пишет лист «Себестоимость» и сообщает, что это демо-хранилище', async () => {
    const { store } = await renderCosting();
    expect((screen.getByRole('button', { name: 'Записать в таблицу' }) as HTMLButtonElement).disabled).toBe(true);
    pick(/№ 12/);
    fireEvent.click(screen.getByRole('button', { name: 'Записать в таблицу' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('демо'));
    const rows = store.readReport('Себестоимость');
    expect(rows.find((r) => r[0] === 'Дата расчёта')).toEqual(['Дата расчёта', '2026-10-25']);
    expect(rows.find((r) => r[0] === 'Заказы')).toEqual(['Заказы', '12']);
    expect(rows.some((r) => r[3] === 'Кран DN50' && r.includes(125))).toBe(true);
  });
});

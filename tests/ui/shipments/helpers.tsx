import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset } from '../../../src/domain/model';
import ShipmentsScreen from '../../../src/ui/screens/shipments/ShipmentsScreen';
import ShipmentScreen from '../../../src/ui/screens/shipments/ShipmentScreen';

let counter = 0;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

/** Экраны поставок на LocalStore с заданными данными; возвращает хранилище для проверки записанного. */
export function renderAt(path: string, seed: Partial<Dataset>) {
  const store = new LocalStore(`zk:t:ship${++counter}`, seed);
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider store={store} today="2026-10-25">
        <Routes>
          <Route path="/shipments" element={<ShipmentsScreen />} />
          <Route path="/shipments/:id" element={<ShipmentScreen />} />
        </Routes>
        <Where />
      </DataProvider>
    </MemoryRouter>,
  );
  return { store, ...utils };
}

/** Текст без пробелов (в том числе неразрывных): «1 200,00» → «1200,00». */
export const squash = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '');

export const baseSeed: Partial<Dataset> = {
  settings: { vatRateDefault: '20' },
  rates: [{ id: 'r1', date: '2026-10-25', currency: 'CNY', rate: 12, source: 'vtb' }],
  suppliers: [
    { id: 'sA', name: 'Alpha Valve' },
    { id: 'sB', name: 'Beta Cable' },
  ],
  carriers: [{ id: 'k1', name: 'Море-Транс' }],
  orders: [
    { id: 'o1', number: 12, date: '2026-09-01', costsComplete: false },
    { id: 'o2', number: 6, date: '2026-08-01', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o1', seq: 1, supplierId: 'sA', currency: 'CNY' },
    { id: 'so2', orderId: 'o2', seq: 1, supplierId: 'sB', currency: 'CNY' },
  ],
  lines: [
    { id: 'l1', orderId: 'o1', supplierOrderId: 'so1', seq: 1, customerName: 'Кран шаровой', qty: 1000, unitPrice: 100, purchased: true, dutyRate: 10, cbm: 10, weight: 500, places: 20 },
    { id: 'l4', orderId: 'o1', supplierOrderId: 'so1', seq: 2, customerName: 'Фланец', qty: 100, unitPrice: 10, purchased: true },
    { id: 'l2', orderId: 'o2', supplierOrderId: 'so2', seq: 1, customerName: 'Кабель силовой', qty: 100, unitPrice: 50, purchased: true },
    { id: 'l3', orderId: 'o1', supplierOrderId: 'so1', seq: 3, customerName: 'Не закупаем', qty: 5, unitPrice: 1, purchased: false },
  ],
};

export const shipment = (id: string, number: string, extra: object = {}) => ({ id, number, mode: 'sea_container' as const, vatRate: 20, ...extra });

export const rubCost = (id: string, targetType: 'shipment' | 'declaration', targetId: string, costType: string, amount: number) => ({
  id, entryDate: '2026-10-01', status: 'fact' as const, targetType, targetId, costType, amount, currency: 'RUB' as const, rateManual: false,
});

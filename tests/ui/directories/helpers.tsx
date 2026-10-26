import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset } from '../../../src/domain/model';
import SuppliersScreen from '../../../src/ui/screens/suppliers/SuppliersScreen';
import SupplierScreen from '../../../src/ui/screens/suppliers/SupplierScreen';
import AgentsScreen from '../../../src/ui/screens/agents/AgentsScreen';
import CarriersScreen from '../../../src/ui/screens/carriers/CarriersScreen';
import ListsScreen from '../../../src/ui/screens/lists/ListsScreen';

let counter = 0;

/** Показывает текущий маршрут — чтобы проверять переходы. */
function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

/** Рисует экраны справочников на LocalStore с заданным набором данных; возвращает хранилище для проверки записанного. */
export function renderAt(path: string, seed: Partial<Dataset>) {
  const store = new LocalStore(`zk:t:dir${++counter}`, seed);
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider store={store} today="2026-10-25">
        <Routes>
          <Route path="/suppliers" element={<SuppliersScreen />} />
          <Route path="/suppliers/:id" element={<SupplierScreen />} />
          <Route path="/agents" element={<AgentsScreen />} />
          <Route path="/carriers" element={<CarriersScreen />} />
          <Route path="/lists" element={<ListsScreen />} />
        </Routes>
        <Where />
      </DataProvider>
    </MemoryRouter>,
  );
  return { store, ...utils };
}

export const baseSeed: Partial<Dataset> = {
  cities: [
    { id: 'c1', city: 'Нинбо', province: 'Чжэцзян' },
    { id: 'c2', city: 'Вэньчжоу', province: 'Чжэцзян' },
    { id: 'c3', city: 'Гуанчжоу', province: 'Гуандун' },
  ],
  lists: [
    { id: 'l1', list: 'specialization', value: 'Краны', order: 1 },
    { id: 'l2', list: 'specialization', value: 'Кабель', order: 2 },
    { id: 'l3', list: 'direction', value: 'Арматура', order: 1 },
  ],
  suppliers: [
    { id: 's1', name: 'Alpha Valve', city: 'Нинбо', province: 'Чжэцзян', specialization: 'Краны' },
    { id: 's2', name: 'Beta Cable', city: 'Гуанчжоу', province: 'Гуандун', specialization: 'Кабель' },
    { id: 's3', name: 'Gamma Fittings', city: 'Вэньчжоу', province: 'Чжэцзян', specialization: 'Краны' },
    { id: 's4', name: 'Delta Unknown' },
  ],
  orders: [
    { id: 'o12', number: 12, date: '2026-09-01', costsComplete: false },
    { id: 'o6', number: 6, date: '2026-08-01', costsComplete: false },
    { id: 'o3', number: 3, date: '2026-07-01', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'CNY' },
    { id: 'so2', orderId: 'o6', seq: 1, supplierId: 's1', currency: 'CNY' },
    { id: 'so3', orderId: 'o3', seq: 1, supplierId: 's2', currency: 'USD' },
  ],
};

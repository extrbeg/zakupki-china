// Корень приложения: сессия → хранилище → данные → оболочка и маршруты (HashRouter — для GitHub Pages).
// Другие таски не правят этот файл: они заменяют только свои файлы в src/ui/screens/.

import { useMemo } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { DataProvider, SessionProvider, useSession } from './DataContext';
import { createDemoStore } from '../demo';
import { Layout } from './layout/Layout';
import { EntryScreen } from './layout/EntryScreen';
import { NotFound } from './layout/NotFound';
import OrdersScreen from './screens/orders/OrdersScreen';
import OrderScreen from './screens/orders/OrderScreen';
import ShipmentsScreen from './screens/shipments/ShipmentsScreen';
import ShipmentScreen from './screens/shipments/ShipmentScreen';
import CostsScreen from './screens/costs/CostsScreen';
import CostingScreen from './screens/costing/CostingScreen';
import RatesScreen from './screens/rates/RatesScreen';
import SuppliersScreen from './screens/suppliers/SuppliersScreen';
import SupplierScreen from './screens/suppliers/SupplierScreen';
import AgentsScreen from './screens/agents/AgentsScreen';
import CarriersScreen from './screens/carriers/CarriersScreen';
import ListsScreen from './screens/lists/ListsScreen';
import SettingsScreen from './screens/settings/SettingsScreen';
import ImportScreen from './screens/import/ImportScreen';
import ConnectScreen from './screens/connect/ConnectScreen';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<OrdersScreen />} />
      <Route path="/orders/:id" element={<OrderScreen />} />
      <Route path="/shipments" element={<ShipmentsScreen />} />
      <Route path="/shipments/:id" element={<ShipmentScreen />} />
      <Route path="/costs" element={<CostsScreen />} />
      <Route path="/costing" element={<CostingScreen />} />
      <Route path="/rates" element={<RatesScreen />} />
      <Route path="/suppliers" element={<SuppliersScreen />} />
      <Route path="/suppliers/:id" element={<SupplierScreen />} />
      <Route path="/agents" element={<AgentsScreen />} />
      <Route path="/carriers" element={<CarriersScreen />} />
      <Route path="/lists" element={<ListsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="/import" element={<ImportScreen />} />
      <Route path="/connect" element={<ConnectScreen />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Shell() {
  const { session } = useSession();
  const store = useMemo(
    () => (session.mode === 'demo' ? createDemoStore() : session.mode === 'sheets' ? session.store : null),
    [session],
  );
  if (!store) return <EntryScreen />;
  return (
    <DataProvider store={store}>
      <Layout>
        <AppRoutes />
      </Layout>
    </DataProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </SessionProvider>
  );
}

import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Cost, Dataset, EntityName, Line, Order, SupplierOrder } from '../../../src/domain/model';
import OrdersScreen from '../../../src/ui/screens/orders/OrdersScreen';
import OrderScreen from '../../../src/ui/screens/orders/OrderScreen';

let counter = 0;

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

/** LocalStore, у которого запись (insert/update) ждёт release() — как медленная запись в Sheets. */
export class GatedStore extends LocalStore {
  private waiting: (() => void)[] = [];
  gated = true;
  private gate(): Promise<void> {
    return this.gated ? new Promise<void>((r) => this.waiting.push(r)) : Promise.resolve();
  }
  get pending(): number { return this.waiting.length; }
  /** Пропустить ждущие записи. */
  release(): void {
    const w = this.waiting;
    this.waiting = [];
    w.forEach((f) => f());
  }
  override async insert<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    await this.gate();
    return super.insert(entity, record);
  }
  override async update<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    await this.gate();
    return super.update(entity, record);
  }
}

export const gatedStore = (seed: Partial<Dataset>) => new GatedStore(`zk:t:ord${++counter}`, seed);

/** Экраны заказов на LocalStore; возвращает хранилище для проверки записанного. */
export function renderAt(path: string, seed: Partial<Dataset>) {
  return renderWithStore(path, new LocalStore(`zk:t:ord${++counter}`, seed));
}

export function renderWithStore<S extends LocalStore>(path: string, store: S) {
  const utils = render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider store={store} today="2026-10-25">
        <Routes>
          <Route path="/" element={<OrdersScreen />} />
          <Route path="/orders/:id" element={<OrderScreen />} />
          <Route path="/import" element={<div>экран импорта</div>} />
        </Routes>
        <Where />
      </DataProvider>
    </MemoryRouter>,
  );
  return { store, ...utils };
}

export const baseSeed: Partial<Dataset> = {
  lists: [
    { id: 'l1', list: 'department', value: 'Цех', order: 1 },
    { id: 'l2', list: 'payer', value: 'ООО Плательщик', order: 1 },
    { id: 'l3', list: 'customer', value: 'Заказчик Север', order: 1 },
    { id: 'l4', list: 'customer', value: 'Заказчик Юг', order: 2 },
    { id: 'l5', list: 'paymentTerms', value: '30/70', order: 1 },
  ],
  suppliers: [
    { id: 's1', name: 'Alpha Valve' },
    { id: 's2', name: 'Beta Cable' },
  ],
  rates: [
    { id: 'r1', date: '2026-10-01', currency: 'CNY', rate: 10, source: 'vtb' },
    { id: 'r2', date: '2026-10-20', currency: 'CNY', rate: 12, source: 'vtb' },
  ],
  orders: [
    { id: 'o12', number: 12, date: '2026-09-01', customer: 'Заказчик Север', title: 'Краны', bitrixTaskId: '7001', costsComplete: false, calcDate: '2026-10-01' },
    { id: 'o6', number: 6, date: '2026-08-01', customer: 'Заказчик Юг', title: 'Кабель', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'CNY', bitrixTaskId: '8002', plannedMode: 'sea_container' },
  ],
  lines: [
    { id: 'ln1', orderId: 'o12', supplierOrderId: 'so1', seq: 1, customerName: 'Кран DN50', qty: 1000, unitPrice: 5, purchased: true, coef: 1.5 },
    { id: 'ln2', orderId: 'o12', supplierOrderId: 'so1', seq: 2, customerName: 'Кран DN25 альт.', qty: 10, unitPrice: 3, purchased: false },
  ],
};

/** Закрытые заказы с историей: каждый — одна позиция 10 × 100 ₽, затрата на позицию amount → AW = amount / 1000. */
export function closedHistory(awList: number[], supplierId = 's1'): Partial<Dataset> {
  const orders: Order[] = [];
  const supplierOrders: SupplierOrder[] = [];
  const lines: Line[] = [];
  const costs: Cost[] = [];
  awList.forEach((aw, i) => {
    orders.push({ id: `h${i}`, number: 100 + i, date: '2026-01-01', costsComplete: true });
    supplierOrders.push({ id: `hs${i}`, orderId: `h${i}`, seq: 1, supplierId, currency: 'RUB', plannedMode: 'sea_container' });
    lines.push({ id: `hl${i}`, orderId: `h${i}`, supplierOrderId: `hs${i}`, seq: 1, customerName: `Позиция истории ${i}`, qty: 10, unitPrice: 100, purchased: true, coef: 1.5 });
    costs.push({ id: `hc${i}`, entryDate: '2026-01-01', status: 'fact', targetType: 'line', targetId: `hl${i}`, costType: 'Прочее', amount: aw * 1000, currency: 'RUB', rateManual: false });
  });
  return { orders, supplierOrders, lines, costs };
}

export const merge = (a: Partial<Dataset>, b: Partial<Dataset>): Partial<Dataset> => ({
  ...a,
  orders: [...(a.orders ?? []), ...(b.orders ?? [])],
  supplierOrders: [...(a.supplierOrders ?? []), ...(b.supplierOrders ?? [])],
  lines: [...(a.lines ?? []), ...(b.lines ?? [])],
  costs: [...(a.costs ?? []), ...(b.costs ?? [])],
});

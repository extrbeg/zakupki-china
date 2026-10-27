// Экран «Заказ» (маршрут /orders/:id; id = new — создание): шапка, итоги, вкладки «Поставщики и товары» (блоки поставщиков
// с позициями) и «Сравнение цен» (?tab=compare — товары × поставщики, выбор «В работу»), поставки заказа, лента платежей.

import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../DataContext';
import { EmptyState } from '../../components';
import { OrderHeader } from './OrderHeader';
import { OrderShipments } from './OrderShipments';
import { OrderTotals } from './OrderTotals';
import { PaymentFeed } from './PaymentFeed';
import { PriceComparison } from './PriceComparison';
import { PurchasedProvider, PurchasedSaveError } from './purchasedQueue';
import { SupplierOrderBlock } from './SupplierOrderBlock';
import './orders.css';

const TABS: { key: 'suppliers' | 'compare'; label: string }[] = [
  { key: 'suppliers', label: 'Поставщики и товары' },
  { key: 'compare', label: 'Сравнение цен' },
];

export default function OrderScreen() {
  const { id } = useParams();
  const { ds, status } = useData();
  const [adding, setAdding] = useState(false);
  const [params, setParams] = useSearchParams();
  const tab: 'suppliers' | 'compare' = params.get('tab') === 'compare' ? 'compare' : 'suppliers';
  const selectTab = (t: typeof tab) => setParams(t === 'compare' ? { tab: 'compare' } : {}, { replace: true });

  const title = <h1 className="screen__title">Заказ</h1>;
  // Ошибку загрузки показывает оболочка (Layout) — здесь второго баннера нет.
  if (status === 'loading') return <section className="screen">{title}<p className="muted">Загрузка…</p></section>;

  if (id === 'new') {
    return (
      <section className="screen">
        <p className="small"><Link to="/">← К списку заказов</Link></p>
        {title}
        <OrderHeader key="new" />
      </section>
    );
  }

  const order = ds.orders.find((o) => o.id === id);
  if (!order) {
    return (
      <section className="screen">
        {title}
        <EmptyState title="Заказ не найден" text="Возможно, он был удалён." actions={[{ label: 'К списку заказов', to: '/' }]} />
      </section>
    );
  }
  const supplierOrders = ds.supplierOrders.filter((so) => so.orderId === order.id).sort((a, b) => a.seq - b.seq);

  return (
    <section className="screen">
      <p className="small"><Link to="/">← К списку заказов</Link></p>
      {title}
      <OrderHeader key={order.id} order={order} />
      <PurchasedProvider key={`purchased-${order.id}`}>
        <OrderTotals order={order} />
        <div className="order-tabs" role="tablist" aria-label="Разделы заказа">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" role="tab" id={`order-tab-${t.key}`} aria-controls={`order-panel-${t.key}`}
              aria-selected={tab === t.key} tabIndex={tab === t.key ? 0 : -1}
              className={`order-tabs__tab${tab === t.key ? ' order-tabs__tab--active' : ''}`} onClick={() => selectTab(t.key)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                const next = TABS[(TABS.findIndex((x) => x.key === tab) + 1) % TABS.length].key;
                selectTab(next);
                document.getElementById(`order-tab-${next}`)?.focus();
              }}
            >{t.label}</button>
          ))}
        </div>
        <div role="tabpanel" id={`order-panel-${tab}`} aria-labelledby={`order-tab-${tab}`}>
          {tab === 'compare' ? <PriceComparison order={order} /> : (
            <>
              <PurchasedSaveError />
              {supplierOrders.map((so) => <SupplierOrderBlock key={so.id} order={order} so={so} />)}
              {adding ? (
                <SupplierOrderBlock key="new-so" order={order} onSaved={() => setAdding(false)} />
              ) : (
                <p><button type="button" className="btn btn--primary" onClick={() => setAdding(true)}>Добавить поставщика в заказ</button></p>
              )}
            </>
          )}
        </div>
      </PurchasedProvider>
      <OrderShipments order={order} />
      <PaymentFeed order={order} />
    </section>
  );
}

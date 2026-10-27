// Экран «Заказы» (маршрут /): список с поиском по номеру, заказчику, названию и ID задачи Битрикс.

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, TextField, type DataColumn } from '../../components';
import type { Order } from '../../../domain/model';
import { formatDate } from '../../format';
import { filterOrders } from './orderLogic';
import { compareOrders, orderLabel } from '../../../domain/numbering';
import './orders.css';

export default function OrdersScreen() {
  const { ds, status } = useData();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => [...filterOrders(ds, query)].sort((a, b) => compareOrders(b, a)), [ds, query]);
  const supplierCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const so of ds.supplierOrders) m.set(so.orderId, (m.get(so.orderId) ?? 0) + 1);
    return m;
  }, [ds.supplierOrders]);
  const bitrixIds = (o: Order) => [o.bitrixTaskId, ...ds.supplierOrders.filter((so) => so.orderId === o.id).map((so) => so.bitrixTaskId)]
    .filter((v): v is string => Boolean(v)).join(', ');

  // Ошибку загрузки показывает оболочка (Layout) — здесь второго баннера нет.
  if (status === 'loading') {
    return <section className="screen"><h1 className="screen__title">Заказы</h1><p className="muted">Загрузка…</p></section>;
  }
  if (ds.orders.length === 0) {
    return (
      <section className="screen">
        <h1 className="screen__title">Заказы</h1>
        <EmptyState
          title="Заказов пока нет"
          text="Создайте первый заказ или перенесите данные из старой таблицы."
          actions={[
            { label: 'Создать заказ', onClick: () => navigate('/orders/new') },
            { label: 'Импорт из старой таблицы', to: '/import' },
          ]}
        />
      </section>
    );
  }

  const columns: DataColumn<Order>[] = [
    { key: 'number', header: '№', render: (o) => orderLabel(o), align: 'right', width: '7rem' },
    { key: 'date', header: 'Дата', render: (o) => formatDate(o.date) },
    { key: 'customer', header: 'Заказчик', render: (o) => o.customer ?? '' },
    { key: 'title', header: 'Название', render: (o) => o.title ?? '' },
    { key: 'department', header: 'Подразделение', render: (o) => o.department ?? '' },
    { key: 'suppliers', header: 'Поставщиков', render: (o) => String(supplierCount.get(o.id) ?? 0), align: 'right' },
    { key: 'bitrix', header: 'Задачи Битрикс', render: bitrixIds },
    { key: 'closed', header: 'Затраты', render: (o) => (o.costsComplete ? 'все внесены' : '') },
  ];

  return (
    <section className="screen">
      <h1 className="screen__title">Заказы</h1>
      <div className="ui-toolbar">
        <TextField label="Поиск: номер, заказчик, ID задачи Битрикс" type="search" value={query} onChange={setQuery} />
        <span className="ui-toolbar__spacer" />
        <button type="button" className="btn btn--primary" onClick={() => navigate('/orders/new')}>Создать заказ</button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          text="Измените запрос."
          actions={[{ label: 'Сбросить поиск', onClick: () => setQuery('') }]}
        />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(o) => o.id} onRowClick={(o) => navigate(`/orders/${o.id}`)} />
      )}
    </section>
  );
}

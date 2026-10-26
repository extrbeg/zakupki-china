// Экран «Поставки» (маршрут /shipments): список поставок и переход к созданию.

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Shipment } from '../../../domain/model';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, type DataColumn } from '../../components';
import { MODE_LABEL, formatDate } from '../../format';
import './shipments.css';

export default function ShipmentsScreen() {
  const { ds, costing, status } = useData();
  const navigate = useNavigate();

  const rows = useMemo(
    () => [...ds.shipments].sort((a, b) => b.number.localeCompare(a.number, 'ru', { numeric: true })),
    [ds.shipments],
  );

  // Ошибку загрузки показывает оболочка (Layout) — здесь второго баннера нет.
  if (status === 'loading') return <section className="screen"><h1 className="screen__title">Поставки</h1><p className="ship-muted">Загрузка…</p></section>;

  const batchCount = (id: string) => ds.batches.filter((b) => b.shipmentId === id).length;
  const warningCount = (id: string) => costing.warnings.filter((w) => w.refs.some((r) => r.type === 'shipment' && r.id === id)).length;

  const columns: DataColumn<Shipment>[] = [
    {
      key: 'number', header: 'Поставка',
      render: (s) => <Link to={`/shipments/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.number}</Link>,
    },
    { key: 'mode', header: 'Тип', render: (s) => MODE_LABEL[s.mode] ?? s.mode },
    { key: 'carrier', header: 'Перевозчик', render: (s) => ds.carriers.find((c) => c.id === s.carrierId)?.name ?? '' },
    { key: 'sent', header: 'Отправка в РФ', render: (s) => formatDate(s.sentDate) },
    { key: 'arrival', header: 'Прибытие на СВХ', render: (s) => formatDate(s.arrivalDate) },
    { key: 'batches', header: 'Партий', align: 'right', render: (s) => batchCount(s.id) },
    { key: 'warnings', header: 'Предупреждений', align: 'right', render: (s) => warningCount(s.id) || '' },
  ];

  return (
    <section className="screen">
      <h1 className="screen__title">Поставки</h1>
      {ds.shipments.length === 0 ? (
        <EmptyState
          title="Поставок пока нет"
          text="Поставка собирается из партий позиций разных заказов и поставщиков."
          actions={[{ label: 'Создать поставку', to: '/shipments/new' }]}
        />
      ) : (
        <>
          <div className="ui-toolbar">
            <span className="ui-toolbar__spacer" />
            <Link className="btn btn--primary" to="/shipments/new">Создать поставку</Link>
          </div>
          <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/shipments/${s.id}`)} />
        </>
      )}
    </section>
  );
}

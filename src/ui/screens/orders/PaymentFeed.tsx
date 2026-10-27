// Лента платежей заказа: затраты, привязанные к заказу, его поставщикам и позициям, — по датам; план отдельно от факта.
// Затраты на поставки и декларации (общие для нескольких заказов) сюда не входят: они видны в карточке поставки.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Cost, Order } from '../../../domain/model';
import { useData } from '../../DataContext';
import { DataTable, type DataColumn } from '../../components';
import { EMPTY, formatDate, formatMoney } from '../../format';
import { supplierOrderCode } from './orderLogic';
import { orderLabel } from '../../../domain/numbering';

const feedDate = (c: Cost) => c.paymentDate ?? c.entryDate;

export function PaymentFeed({ order }: { order: Order }) {
  const { ds, costing } = useData();
  const rows = useMemo(() => {
    const sos = new Map(ds.supplierOrders.filter((s) => s.orderId === order.id).map((s) => [s.id, s]));
    const lines = new Map(ds.lines.filter((l) => l.orderId === order.id).map((l) => [l.id, l]));
    const target = (c: Cost): string | null => {
      if (c.targetType === 'order' && c.targetId === order.id) return 'Заказ';
      if (c.targetType === 'supplierOrder') {
        const so = sos.get(c.targetId);
        return so ? `Поставщик ${supplierOrderCode(order, so)}` : null;
      }
      if (c.targetType === 'line') {
        const l = lines.get(c.targetId);
        const so = l ? sos.get(l.supplierOrderId) : undefined;
        return l ? `Позиция ${so ? supplierOrderCode(order, so) : orderLabel(order)}-${l.seq}` : null;
      }
      return null;
    };
    return ds.costs
      .map((c) => ({ cost: c, target: target(c) }))
      .filter((r): r is { cost: Cost; target: string } => r.target !== null)
      .sort((a, b) => feedDate(a.cost).localeCompare(feedDate(b.cost)));
  }, [ds, order]);

  const rubOf = (id: string) => costing.costsRub.find((r) => r.costId === id)?.rub ?? null;
  type Row = (typeof rows)[number];
  const columns: DataColumn<Row>[] = [
    { key: 'date', header: 'Дата', render: (r) => formatDate(feedDate(r.cost)) },
    { key: 'code', header: 'Номер', render: (r) => r.cost.code ?? '' },
    { key: 'type', header: 'Тип затрат', render: (r) => r.cost.costType },
    { key: 'target', header: 'Привязка', render: (r) => r.target },
    { key: 'amount', header: 'Сумма', align: 'right', render: (r) => (r.cost.amount === undefined ? EMPTY : `${formatMoney(r.cost.amount)} ${r.cost.currency}`) },
    { key: 'rub', header: 'В рублях', align: 'right', render: (r) => { const v = rubOf(r.cost.id); return v === null ? EMPTY : `${formatMoney(v)} ₽`; } },
    { key: 'comment', header: 'Комментарий', render: (r) => r.cost.comment ?? '' },
  ];
  const plan = rows.filter((r) => r.cost.status === 'plan');
  const fact = rows.filter((r) => r.cost.status === 'fact');

  return (
    <section className="ui-card" aria-label="Лента платежей">
      <h2 className="ui-card__title">Лента платежей</h2>
      {rows.length === 0 ? <p className="muted">Затрат по заказу пока нет.</p> : null}
      {plan.length > 0 ? <DataTable caption="План" columns={columns} rows={plan} rowKey={(r) => r.cost.id} /> : null}
      {fact.length > 0 ? <div style={{ marginTop: 12 }}><DataTable caption="Факт" columns={columns} rows={fact} rowKey={(r) => r.cost.id} /></div> : null}
      <div className="ui-card__actions">
        <Link className="btn btn--primary" to={`/costs?add=order:${encodeURIComponent(order.id)}`}>Добавить затрату</Link>
        <Link className="btn" to={`/costs?order=${encodeURIComponent(order.id)}`}>Все затраты</Link>
      </div>
    </section>
  );
}

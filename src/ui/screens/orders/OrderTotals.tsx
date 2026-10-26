// Итоги заказа: суммы по валютам, ₽ по курсу расчёта, прогноз (AB), себестоимость позиций — суммы тех же величин, что в строках
// таблиц поставщиков (orderRowTotals, с учётом ещё не записанных отметок «В работу»); план/факт затрат — из движка.

import { useMemo } from 'react';
import type { Currency, Order } from '../../../domain/model';
import { useData } from '../../DataContext';
import { EMPTY, formatMoney } from '../../format';
import { orderRowTotals } from './linesLogic';
import { usePurchased } from './purchasedQueue';

export function OrderTotals({ order }: { order: Order }) {
  const { ds, costing, today } = useData();
  const { isOn, version } = usePurchased();
  const rows = useMemo(
    () => orderRowTotals(ds, costing, order, today, isOn),
    [ds, costing, order, today, version],   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const t = costing.orders.find((o) => o.orderId === order.id);
  const currencies = (Object.keys(rows.sumByCurrency) as Currency[]).filter((c) => (rows.sumByCurrency[c] ?? 0) !== 0);
  const rub = (n: number | undefined) => (n === undefined ? EMPTY : `${formatMoney(n)} ₽`);
  return (
    <section className="ui-card" aria-label="Итоги заказа">
      <h2 className="ui-card__title">Итоги заказа</h2>
      <dl className="totals">
        <div className="totals__item">
          <dt>Сумма заказа</dt>
          <dd>{currencies.length === 0 ? EMPTY : currencies.map((c) => <span key={c} style={{ display: 'block' }}>{formatMoney(rows.sumByCurrency[c])} {c}</span>)}</dd>
        </div>
        <div className="totals__item"><dt>В рублях по курсу расчёта</dt><dd>{rub(rows.Z)}</dd></div>
        <div className="totals__item"><dt>Прогноз суммы в РФ</dt><dd>{rub(rows.forecast)}</dd></div>
        <div className="totals__item"><dt>Себестоимость позиций</dt><dd>{rub(rows.cost)}</dd></div>
        <div className="totals__item"><dt>Плановые затраты</dt><dd>{rub(t?.planRub)}</dd></div>
        <div className="totals__item"><dt>Фактические затраты</dt><dd>{rub(t?.factRub)}</dd></div>
        <div className="totals__item"><dt>Затраты всего</dt><dd>{rub(t?.costTotal)}</dd></div>
      </dl>
    </section>
  );
}

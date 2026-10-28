// Вкладка «Сравнение цен» (G09–G12, истории 78–80): все товары заказа строками, все поставщики колонками; в ячейке —
// кол-во, цена в валюте, ₽/шт, прогноз ₽/шт; лучший прогноз в строке подсвечен. Клик по ячейке (или чекбокс) переключает
// «В работу» (`purchased`) и сразу сохраняет. Под каждым поставщиком — итоги по выбранным и по всем предложениям.
// Очередь записей отметки — общая с таблицей товаров поставщика (purchasedQueue.tsx).

import { useMemo, useRef, type MouseEvent } from 'react';
import type { Currency, Order } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { EMPTY, formatMoney, formatNumber, formatQtyUnit, unitOf } from '../../format';
import { buildCompareMatrix, type CompareColumn, type Offer, type OfferTotals } from './compareLogic';
import { usePurchased } from './purchasedQueue';

/** «1 позиция / 2 позиции / 5 позиций». */
function positionsCount(n: number): string {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} позиция`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} позиции`;
  return `${n} позиций`;
}

export function PriceComparison({ order }: { order: Order }) {
  const data = useData();
  const { ds, today } = data;
  const latest = useRef(ds);
  latest.current = ds;
  const { isOn, toggle, setMany, version, saveError } = usePurchased();

  const matrix = useMemo(
    () => buildCompareMatrix(ds, order, today, isOn),
    [ds, order, today, version],   // eslint-disable-line react-hooks/exhaustive-deps
  );

  const columnLines = (col: CompareColumn) => latest.current.lines.filter((l) => l.supplierOrderId === col.so.id);

  if (matrix.columns.length === 0) {
    return <p className="muted">В заказе пока нет поставщиков — добавьте их на вкладке «Поставщики и товары».</p>;
  }

  const offerView = (o: Offer, col: CompareColumn, many: boolean) => (
    <label key={o.line.id} className={`cmp-offer${o.selected ? ' cmp-offer--on' : ''}${o.best ? ' cmp-offer--best' : ''}`}>
      <span className="cmp-offer__check">
        <input type="checkbox" checked={o.selected} onChange={() => toggle(o.line)} aria-label={`В работу: позиция ${col.code}-${o.line.seq}`} />
        {many ? <span className="small muted">№ {o.line.seq}</span> : null}
        {o.best ? <span className="cmp-best">лучший прогноз</span> : null}
      </span>
      <span className="cmp-offer__main">
        <span data-col="qty">{formatQtyUnit(o.line.qty, unitOf(o.line))}</span>
        {' × '}
        <span data-col="price">{formatNumber(o.line.unitPrice)} {col.so.currency}</span>
      </span>
      <span className="cmp-offer__rub"><span data-col="Y">{o.Y === null ? EMPTY : `${formatMoney(o.Y)} ₽/${unitOf(o.line)}`}</span></span>
      <span className="cmp-offer__ab">прогноз <span data-col="AB">{o.AB === null ? EMPTY : `${formatMoney(o.AB)} ₽/${unitOf(o.line)}`}</span></span>
    </label>
  );

  const onCellClick = (offers: Offer[]) => (e: MouseEvent<HTMLTableCellElement>) => {
    if (offers.length !== 1 || (e.target as HTMLElement).closest('label, button, input')) return;
    toggle(offers[0].line);
  };

  const totalsView = (t: OfferTotals, col: CompareColumn) => (t.count === 0 ? EMPTY : (
    <>
      <span className="cmp-total__count">{positionsCount(t.count)}</span>
      <span className="cmp-total__sum">{formatMoney(t.X)} {col.so.currency}</span>
      <span className="cmp-total__ab">прогноз {formatMoney(t.forecast)} ₽</span>
    </>
  ));

  const currencies = (Object.keys(matrix.order.sumByCurrency) as Currency[]).filter((c) => (matrix.order.sumByCurrency[c] ?? 0) !== 0);
  const selectedCount = matrix.columns.reduce((n, c) => n + matrix.totals[c.so.id].selected.count, 0);

  return (
    <section className="ui-card cmp" aria-label="Сравнение цен поставщиков">
      <h2 className="ui-card__title">Сравнение цен</h2>
      <p className="small muted cmp__hint">Отметьте, что берёте в работу: клик по ячейке или флажок. В себестоимость, итоги заказа и поставки идут только позиции «В работу».</p>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <div className="table-scroll cmp__scroll">
        <table className="table cmp-table" aria-label="Сравнение цен">
          <thead>
            <tr>
              <th scope="col" className="cmp-table__product">Товар</th>
              {matrix.columns.map((col) => (
                <th key={col.so.id} scope="col" className="cmp-table__supplier">
                  <span className="cmp-head__code">{col.code}</span>
                  {col.supplierName ? <span className="cmp-head__name">{col.supplierName}</span> : null}
                  <span className="cmp-head__meta">{col.so.currency}{col.rate ? '' : ' · нет курса'}</span>
                  <span className="cmp-head__actions">
                    <button type="button" className="btn btn--small" onClick={() => setMany(columnLines(col), () => true)}>Всё у этого поставщика</button>
                    <button type="button" className="btn btn--small" onClick={() => setMany(columnLines(col), () => false)}>Снять всё</button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.length === 0 ? (
              <tr><th scope="row" className="cmp-table__product muted">Товаров пока нет</th>{matrix.columns.map((c) => <td key={c.so.id} />)}</tr>
            ) : matrix.rows.map((row) => (
              <tr key={row.key}>
                <th scope="row" className="cmp-table__product">{row.title}</th>
                {matrix.columns.map((col) => {
                  const offers = row.cells[col.so.id] ?? [];
                  const on = offers.some((o) => o.selected);
                  return (
                    <td
                      key={col.so.id} onClick={onCellClick(offers)}
                      className={`cmp-cell${offers.length ? ' cmp-cell--offer' : ''}${on ? ' cmp-cell--on' : ''}${offers.some((o) => o.best) ? ' cmp-cell--best' : ''}`}
                    >
                      {offers.map((o) => offerView(o, col, offers.length > 1))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" className="cmp-table__product">В работе</th>
              {matrix.columns.map((col) => <td key={col.so.id} className="cmp-total">{totalsView(matrix.totals[col.so.id].selected, col)}</td>)}
            </tr>
            <tr>
              <th scope="row" className="cmp-table__product">Все предложения</th>
              {matrix.columns.map((col) => <td key={col.so.id} className="cmp-total muted">{totalsView(matrix.totals[col.so.id].all, col)}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="cmp-order" role="group" aria-label="Итог заказа по выбранным">
        <strong>Итог заказа по выбранным</strong>
        {selectedCount === 0 ? (
          <span className="muted">ничего не выбрано в работу</span>
        ) : (
          <>
            <span>{positionsCount(selectedCount)}</span>
            <span>{currencies.map((c) => `${formatMoney(matrix.order.sumByCurrency[c])} ${c}`).join(' + ')}</span>
            <span>{formatMoney(matrix.order.Z)} ₽ по курсу расчёта</span>
            <span>прогноз {formatMoney(matrix.order.forecast)} ₽</span>
          </>
        )}
      </div>
    </section>
  );
}

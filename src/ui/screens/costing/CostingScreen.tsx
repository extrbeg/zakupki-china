// Экран «Себестоимость» (маршрут /costing): выбираю номера заказов — вижу себестоимость каждой позиции «В работу».
// Выбор — только фильтр показа; общие затраты поставки движок делит по всем партиям (R18.1).

import { compareOrders, orderRef } from '../../../domain/numbering';
import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorBanner, TextField } from '../../components';
import { COST_CATEGORIES, COST_CATEGORY_LABEL } from '../../../domain/costing';
import { useData } from '../../DataContext';
import { F, SHORT, TIP } from '../../../domain/labels';
import { AD_LABEL, AD_SHORT, AW_SHORT, adTip, awTip } from '../orders/coefLabels';
import { EMPTY, formatMoney as money, formatPct, formatQty, formatQtyUnit, unitOf } from '../../format';
import { buildReportRows, buildRows, lineTitle, selectionTotals, selectionWarnings, type CostingRow } from './costingLogic';
import './costing.css';


/** Меньше расчётного коэффициента — лучше прогноза (зелёный), больше — хуже (красный). Разница меньше 0,05 % — без цвета. */
function devClass(pct: number): string {
  if (Math.abs(pct) < 0.05) return 'costing-dev';
  return `costing-dev ${pct < 0 ? 'costing-dev--good' : 'costing-dev--bad'}`;
}

function LineDetail({ row, shipmentNumber }: { row: CostingRow; shipmentNumber: (id: string | null) => string }) {
  const c = row.cost;
  return (
    <div className="costing-detail__grid" data-testid={`line-detail-${row.line.id}`}>
      <section>
        <h3>Разбивка по категориям</h3>
        <table>
          <tbody>
            {COST_CATEGORIES.map((k) => (
              <tr key={k}><th scope="row">{COST_CATEGORY_LABEL[k]}</th><td className="costing-num">{money(c.breakdown[k])}</td></tr>
            ))}
            <tr><th scope="row">Итого</th><td className="costing-num">{money(c.total)}</td></tr>
            <tr><th scope="row">{F.costUnit} (средневзвешенная)</th><td className="costing-num">{money(c.AV)}</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h3>Партии</h3>
        <table>
          <thead>
            <tr><th>Партия</th><th className="costing-num">Кол-во</th><th className="costing-num">Себестоимость, ₽</th><th className="costing-num">За единицу, ₽</th></tr>
          </thead>
          <tbody>
            {row.batches.map((b) => (
              <tr key={b.batchId}>
                <td>{b.virtual ? 'Неотгруженный остаток' : `Поставка ${shipmentNumber(b.shipmentId)}`}</td>
                <td className="costing-num">{formatQty(b.qty)}</td>
                <td className="costing-num">{money(b.total)}</td>
                <td className="costing-num">{money(b.unitCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {row.batches.length === 0 ? <p className="muted small">Партий нет.</p> : null}
      </section>
    </div>
  );
}

export default function CostingScreen() {
  const { ds, costing, store, today, status } = useData();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [writing, setWriting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<unknown>(null);

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...ds.orders]
      .sort((a, b) => compareOrders(b, a))
      .filter((o) => !q || `${o.number} ${o.code ?? ''} ${o.title ?? ''} ${o.customer ?? ''}`.toLowerCase().includes(q));
  }, [ds.orders, query]);

  const rows = useMemo(() => buildRows(ds, costing, selected), [ds, costing, selected]);
  const totals = useMemo(() => selectionTotals(costing, rows, selected), [costing, rows, selected]);
  const warnings = useMemo(() => selectionWarnings(ds, costing, selected), [ds, costing, selected]);
  const shipmentNumber = (id: string | null) => ds.shipments.find((s) => s.id === id)?.number ?? EMPTY;

  // Ошибку загрузки показывает оболочка (Layout) — здесь второго баннера нет.
  if (status === 'loading') return <div className="screen"><p className="muted">Загрузка…</p></div>;

  const toggle = (set: ReadonlySet<string>, id: string): ReadonlySet<string> => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };

  const write = async () => {
    setWriting(true);
    setMessage(null);
    setWriteError(null);
    try {
      await store.writeReport('Себестоимость', buildReportRows(ds, rows, selected, today));
      setMessage(store.kind === 'local'
        ? 'Записано в локальное хранилище (демо). В Google-таблицу ничего не отправлено — лист «Себестоимость» появится после входа с таблицей.'
        : 'Записано в лист «Себестоимость» таблицы.');
    } catch (e) {
      setWriteError(e);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="screen">
      <h1 className="screen__title">Себестоимость</h1>

      <section className="costing-picker" aria-label="Выбор заказов">
        <div className="costing-picker__head">
          <TextField label="Поиск заказа" type="search" value={query} onChange={setQuery} placeholder="Номер, название или заказчик" />
          <button type="button" className="btn btn--small" onClick={() => setSelected(new Set([...selected, ...orders.map((o) => o.id)]))} disabled={orders.length === 0}>Выбрать найденные</button>
          <button type="button" className="btn btn--small" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>Сбросить выбор</button>
        </div>
        {orders.length === 0 ? <p className="muted small costing-picker__count">Заказов не найдено.</p> : (
          <ul className="costing-picker__list">
            {orders.map((o) => (
              <li key={o.id}>
                <label className="checkbox">
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => setSelected(toggle(selected, o.id))} />
                  <span>{orderRef(o)}{o.title ? ` · ${o.title}` : ''}{o.customer ? ` · ${o.customer}` : ''}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small costing-picker__count">Выбрано заказов: {selected.size}</p>
      </section>

      <div className="costing-actions">
        <button type="button" className="btn btn--primary" onClick={() => void write()} disabled={writing || rows.length === 0}>Записать в таблицу</button>
        <span className="muted small">Дата расчёта: {today}</span>
      </div>
      {message ? <p className="costing-status" role="status">{message}</p> : null}
      {writeError ? <ErrorBanner error={writeError} /> : null}

      {selected.size === 0 ? (
        <EmptyState title="Выберите заказы" text="Отметьте номера заказов выше — здесь появится себестоимость каждой позиции «В работу»." />
      ) : (
        <>
          <dl className="costing-totals" data-testid="totals">
            <div><dt>Позиций в работе</dt><dd>{totals.lines}</dd></div>
            <div><dt>Себестоимость выбора, ₽</dt><dd>{money(totals.total)}</dd></div>
            <div><dt title={AD_LABEL}>Прогноз по расчётному коэффициенту себестоимости доставки, ₽</dt><dd>{money(totals.forecastRub)}</dd></div>
            {COST_CATEGORIES.filter((k) => totals.breakdown[k] !== 0).map((k) => (
              <div key={k}><dt>{COST_CATEGORY_LABEL[k]}, ₽</dt><dd>{money(totals.breakdown[k])}</dd></div>
            ))}
          </dl>

          {warnings.length > 0 ? (
            <ul className="costing-warnings" aria-label="Предупреждения">
              {warnings.map((w, i) => (
                <li key={i}>
                  {w.warning.message}
                  {w.links.map((l) => <Link key={l.to + l.label} to={l.to}>{l.label}</Link>)}
                </li>
              ))}
            </ul>
          ) : null}

          {rows.length === 0 ? (
            <p className="muted">В выбранных заказах нет позиций «В работу» — отметьте их в карточке заказа, вкладка «Сравнение цен».</p>
          ) : (
            <div className="table-scroll">
              <table className="table costing-table">
                <thead>
                  <tr>
                    <th scope="col" aria-label="Раскрыть" />
                    <th scope="col">Заказ</th><th scope="col">Поставщик</th><th scope="col">Позиция</th>
                    <th scope="col" className="costing-num">{F.qty}</th><th scope="col" className="costing-num" title={F.unitPrice}>{SHORT.unitPrice}</th>
                    <th scope="col" className="costing-num" title={`${F.priceRub}: ${TIP.priceRub.toLowerCase()}`}>{SHORT.priceRub}</th><th scope="col" className="costing-num" title={`${F.forecast}: ${TIP.forecast.toLowerCase()}`}>{SHORT.forecast}</th><th scope="col" className="costing-num costing-coef" title={adTip('прогноз цены в РФ = цена в ₽ за единицу × этот коэффициент')}>{AD_SHORT}</th>
                    <th scope="col" className="costing-num">Себестоимость, ₽</th><th scope="col" className="costing-num" title={`${F.costUnit}: ${TIP.costUnit.toLowerCase()}`}>{SHORT.costUnit}</th>
                    <th scope="col" className="costing-num costing-coef" title={awTip(TIP.coefFact.toLowerCase())}>{AW_SHORT}</th><th scope="col" className="costing-num" title={TIP.deviation}>{F.deviation}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = r.cost;
                    const isOpen = open.has(r.line.id);
                    const title = lineTitle(r.line);
                    return (
                      <Fragment key={r.line.id}>
                        <tr>
                          <td>
                            <button type="button" className="btn btn--small costing-toggle" aria-expanded={isOpen}
                              aria-label={`${isOpen ? 'Свернуть' : 'Раскрыть'}: ${title}`} onClick={() => setOpen(toggle(open, r.line.id))}>
                              {isOpen ? '−' : '+'}
                            </button>
                          </td>
                          <td>{orderRef(r.order)}</td>
                          <td>{r.supplier?.name ?? EMPTY}</td>
                          <td>{title}</td>
                          <td className="costing-num">{formatQtyUnit(r.line.qty, unitOf(r.line))}</td>
                          <td className="costing-num">{money(r.line.unitPrice)} {r.so?.currency ?? ''}</td>
                          <td className="costing-num">{money(c.Y)}</td>
                          <td className="costing-num">{money(c.AB)}</td>
                          <td className="costing-num">{money(c.AD)}</td>
                          <td className="costing-num">{money(c.total)}</td>
                          <td className="costing-num">{money(c.AV)}</td>
                          <td className={`costing-num${c.provisional ? ' costing-provisional' : ''}`}>
                            {money(c.AW)}
                            {c.provisional && c.AW !== null ? <span className="costing-note">предварительно</span> : null}
                          </td>
                          <td className="costing-num">
                            {r.deviationPct === null ? EMPTY : <span data-testid="deviation" className={devClass(r.deviationPct)}>{formatPct(r.deviationPct)}</span>}
                          </td>
                        </tr>
                        {isOpen ? (
                          <tr className="costing-detail"><td colSpan={13}><LineDetail row={r} shipmentNumber={shipmentNumber} /></td></tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

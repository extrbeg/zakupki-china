// Экран «Курсы» (маршрут /rates): история курсов по датам × USD/EUR/CNY, источник, ручной курс,
// статус автокурсов (R12, R13.1, R35i).

import { useMemo, useState } from 'react';
import type { Rate } from '../../../domain/model';
import { useData } from '../../DataContext';
import { EmptyState } from '../../components';
import { CURRENCY_LABEL, FOREIGN_CURRENCIES, formatRate, ruDate } from '../../format';
import { RateForm } from './RateForm';
import { autoRatesStale, buildRateRows, type RateCell } from './rateTable';
import './rates.css';

type Open = { mode: 'new' } | { mode: 'edit'; id: string } | null;

const PAGE = 60;

function Cell({ cell, onEdit }: { cell: RateCell; onEdit: (r: Rate) => void }) {
  const { effective, manual, vtb } = cell;
  if (!effective) return <span className="muted">—</span>;
  if (manual) {
    return (
      <button
        type="button" className="btn--link rate-cell"
        aria-label={`Изменить ручной курс ${CURRENCY_LABEL[manual.currency]} на ${ruDate(manual.date)}: ${formatRate(manual.rate)}`}
        title={manual.comment || 'Изменить ручной курс'}
        onClick={() => onEdit(manual)}
      >
        <span className="rate-cell__value">{formatRate(manual.rate)}</span>
        <span className="rate-cell__src rate-cell__src--manual">вручную</span>
        {vtb ? <span className="rate-cell__replaced" title="Курс ВТБ на эту дату заменён ручным">ВТБ {formatRate(vtb.rate)}</span> : null}
      </button>
    );
  }
  return (
    <span className="rate-cell">
      <span className="rate-cell__value">{formatRate(effective.rate)}</span>
      <span className="rate-cell__src">ВТБ</span>
    </span>
  );
}

export default function RatesScreen() {
  const { ds, today, status } = useData();
  const [open, setOpen] = useState<Open>(null);
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => buildRateRows(ds.rates), [ds.rates]);
  const auto = useMemo(() => autoRatesStale(ds.rates, today), [ds.rates, today]);
  const editing = open?.mode === 'edit' ? ds.rates.find((r) => r.id === open.id) : undefined;
  const close = () => setOpen(null);
  const addButton = <button type="button" className="btn btn--primary" onClick={() => setOpen({ mode: 'new' })}>Добавить курс</button>;

  return (
    <section className="screen">
      <h1 className="screen__title">Курсы</h1>
      {status !== 'loading' && auto.stale && auto.last ? (
        <div className="banner banner--warning" role="status">
          <span>Автокурсы не обновлялись с {ruDate(auto.last)}</span>
        </div>
      ) : null}
      {status !== 'loading' && auto.last === null && ds.rates.length > 0 ? (
        <div className="banner banner--warning" role="status">
          <span>Автокурсов ВТБ ещё нет — в таблице откройте меню «Закупки» → «Включить ежедневные курсы».</span>
        </div>
      ) : null}
      {open ? <RateForm key={open.mode === 'edit' ? open.id : 'new'} rate={editing} onClose={close} /> : null}
      {status === 'loading' ? <p className="muted">Загрузка…</p> : null}
      {status !== 'loading' && rows.length === 0 ? (
        open ? null : (
          <EmptyState
            title="Курсов пока нет"
            text="Курсы ВТБ записывает скрипт таблицы каждый день (меню «Закупки» → «Включить ежедневные курсы»). Курс на дату можно ввести и вручную."
            actions={[{ label: 'Добавить курс', onClick: () => setOpen({ mode: 'new' }) }]}
          />
        )
      ) : null}
      {status !== 'loading' && rows.length > 0 ? (
        <>
          <div className="ui-toolbar">
            <span className="muted">
              {auto.last ? `Последний курс ВТБ — ${ruDate(auto.last)}. ` : ''}Курс продажи ВТБ, рублей за единицу валюты; ручной курс на дату важнее курса ВТБ.
            </span>
            <span className="ui-toolbar__spacer" />
            {addButton}
          </div>
          <div className="table-scroll">
            <table className="table rates-table">
              <thead>
                <tr>
                  <th scope="col">Дата</th>
                  {FOREIGN_CURRENCIES.map((c) => <th key={c} scope="col" style={{ textAlign: 'right' }}>{CURRENCY_LABEL[c]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((row) => (
                  <tr key={row.date}>
                    <th scope="row">{ruDate(row.date)}</th>
                    {FOREIGN_CURRENCIES.map((c) => (
                      <td key={c} style={{ textAlign: 'right' }}>
                        <Cell cell={row.cells[c]} onEdit={(r) => setOpen({ mode: 'edit', id: r.id })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit ? (
            <p><button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE * 5)}>Показать ещё ({rows.length - limit})</button></p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

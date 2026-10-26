// Таблица товаров поставщика в заказе (G03, G04, G06, G08, G10): флажок «В работу» первой колонкой (сохраняется сразу,
// общая с «Сравнением цен» очередь записей), расчёт по каждой позиции, строка быстрого ввода внизу,
// «Подробнее» — полная форма позиции прямо под строкой, «Вставить из Excel» — пачкой.
// Ширина: второстепенные колонки (класс lines-col--minor) скрываются на ноутбуке (orders.css), чтобы таблица не уезжала вбок.

import { Fragment, useState } from 'react';
import type { Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { useData } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { EMPTY, formatCoef, formatMoney, formatNumber, formatPct, formatQty } from '../../format';
import { LineForm } from './LineForm';
import type { LineRow } from './linesLogic';
import { compact } from './orderLogic';
import { PastePanel } from './PastePanel';
import { QuickLineEntry } from './QuickLineEntry';
import { usePurchased } from './purchasedQueue';

/** Колонки таблицы по порядку (G04, G08); minor — скрывается на ширине ноутбука (≈1024 px), см. orders.css.
 *  Значения за единицу (₽/шт, прогноз, себестоимость) видны всегда; скрываются суммы «на кол-во». */
const COLUMNS: { key: string; title: string; tip?: string; num?: boolean; minor?: boolean }[] = [
  { key: 'seq', title: '№' },
  { key: 'name', title: 'Товар' },
  { key: 'qty', title: 'Кол-во', num: true },
  { key: 'price', title: 'Цена, {cur}', tip: 'Цена за единицу в валюте поставщика', num: true },
  { key: 'X', title: 'Сумма, {cur}', tip: 'X = кол-во × цена', num: true },
  { key: 'Y', title: 'Цена ₽/шт', tip: 'Y = цена × курс даты расчёта', num: true },
  { key: 'Z', title: 'Сумма ₽', tip: 'Z = Y × кол-во', num: true, minor: true },
  { key: 'AD', title: 'AD', tip: 'Коэффициент прогноза: свой у позиции (выделен) или AD поставщика', num: true },
  { key: 'AB', title: 'Прогноз ₽/шт (AB)', tip: 'AB = Y × AD — прогноз цены в РФ за единицу', num: true },
  { key: 'ABqty', title: 'Прогноз ₽ на кол-во', tip: 'AB × кол-во', num: true, minor: true },
  { key: 'AV', title: 'Себест. ₽/шт (AV)', tip: 'AV = себестоимость позиции / кол-во', num: true },
  { key: 'AVqty', title: 'Себест. ₽ на кол-во', tip: 'AV × кол-во', num: true, minor: true },
  { key: 'AW', title: 'AW', tip: 'AW = AV / Y — фактический коэффициент', num: true },
  { key: 'dev', title: 'Откл.', tip: 'Отклонение AW от AD: зелёный — фактически дешевле прогноза', num: true },
];
/** Все колонки: «В работу» + данные + «Действия». */
export const LINE_COLUMN_COUNT = COLUMNS.length + 2;
const MINOR = new Set(COLUMNS.filter((c) => c.minor).map((c) => c.key));
/** Классы ячейки колонки: число справа, второстепенная скрывается на ноутбуке. */
const colClass = (key: string, extra?: string) =>
  [COLUMNS.find((c) => c.key === key)?.num ? 'num' : '', MINOR.has(key) ? 'lines-col--minor' : '', extra ?? ''].filter(Boolean).join(' ') || undefined;

export function LinesSection({ order, so, code, rate, rows }: {
  order: Order; so: SupplierOrder; code: string; rate: RatePick | null; rows: LineRow[];
}) {
  const data = useData();
  const { toggle } = usePurchased();
  const [editing, setEditing] = useState<string | null>(null);
  const [pasting, setPasting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<unknown>(undefined);
  const nextSeq = rows.reduce((m, r) => Math.max(m, r.line.seq), 0) + 1;

  const resetAd = async (l: Line) => {
    setRowError(undefined);
    try {
      const current = data.ds.lines.find((x) => x.id === l.id) ?? l;
      await data.save('lines', compact({ ...current, coef: undefined }) as Line);
    } catch (e) {
      setRowError(e);
    }
  };

  const row = (r: LineRow) => {
    const l = r.line;
    const name = l.customerName || l.docName || l.supplierName || EMPTY;
    const isOpen = editing === l.id;
    return (
      <Fragment key={l.id}>
        <tr data-testid={`line-${l.id}`} className={r.alt ? 'is-alt-row' : undefined}>
          <td className="cell--pick">
            <label className="pick-box" title={r.alt ? 'Взять в работу' : 'Снять «В работу»'}>
              <input type="checkbox" checked={!r.alt} onChange={() => toggle(l)} aria-label={`В работу: позиция ${code}-${l.seq}`} />
            </label>
          </td>
          <td data-col="seq">{l.seq}</td>
          <td data-col="name" className="cell--name">
            <span className={r.alt ? 'is-alt' : undefined}>{name}</span>
            {r.alt ? <span className="badge">не в работе</span> : null}
            {!r.alt && r.shipped > 0 ? <small className="small-note">{`отгружено ${formatQty(r.shipped)} из ${formatQty(l.qty)}`}</small> : null}
          </td>
          <td data-col="qty" className="num">{formatQty(l.qty)}</td>
          <td data-col="price" className="num">{formatNumber(l.unitPrice)}</td>
          <td data-col="X" className="num">{formatMoney(r.X)}</td>
          <td data-col="Y" className={colClass('Y')}>{formatMoney(r.Y)}</td>
          <td data-col="Z" className={colClass('Z')}>{formatMoney(r.Z)}</td>
          <td className="num">
            {r.ownAD ? (
              <>
                <span data-col="AD"><span className="ad-own" title="Свой AD позиции">{formatCoef(r.AD)}</span></span>
                <button
                  type="button" className="btn--link ad-reset" aria-label={`AD позиции ${l.seq} как у поставщика`}
                  title="Снять свой AD — как у поставщика" onClick={() => void resetAd(l)}
                >×</button>
              </>
            ) : <span data-col="AD">{formatCoef(r.AD)}</span>}
          </td>
          <td data-col="AB" className={colClass('AB')}>{formatMoney(r.AB)}</td>
          <td data-col="ABqty" className={colClass('ABqty')}>{formatMoney(r.ABqty)}</td>
          <td data-col="AV" className={colClass('AV')}>{r.alt ? EMPTY : formatMoney(r.AV)}</td>
          <td data-col="AVqty" className={colClass('AVqty')}>{r.alt ? EMPTY : formatMoney(r.AVqty)}</td>
          <td data-col="AW" className={`num${r.provisional && r.AW !== null ? ' is-provisional' : ''}`}>
            {r.alt ? EMPTY : formatNumber(r.AW)}
            {!r.alt && r.provisional && r.AW !== null ? <small className="small-note">предварительно</small> : null}
          </td>
          <td data-col="dev" className="num">
            {r.dev !== null ? (
              <span data-testid={`dev-${l.id}`} className={`dev ${r.dev < 0 ? 'dev--better' : r.dev > 0 ? 'dev--worse' : ''}`}>{formatPct(r.dev)}</span>
            ) : EMPTY}
          </td>
          <td className="cell--actions">
            <button
              type="button" className="btn btn--small" aria-expanded={isOpen} aria-label={`Подробнее о позиции ${l.seq}`}
              onClick={() => setEditing(isOpen ? null : l.id)}
            >{isOpen ? 'Свернуть' : 'Подробнее'}</button>
          </td>
        </tr>
        {isOpen ? (
          <tr className="line-detail">
            <td colSpan={LINE_COLUMN_COUNT}>
              <div className="line-detail__inner">
                <LineForm key={l.id} order={order} so={so} line={l} nextSeq={nextSeq} rate={rate} onClose={() => setEditing(null)} />
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  };

  return (
    <div className="so-lines">
      {!rate ? <div className="banner banner--warning">Нет курса на дату расчёта — цены в ₽ и прогноз не посчитаны. Введите курс вручную в реквизитах поставщика или добавьте его на экране «Курсы».</div> : null}
      {rowError !== undefined ? <ErrorBanner error={rowError} /> : null}
      <div className="table-scroll">
        <table className="table lines-table" aria-label={`Товары ${code}`}>
          <thead>
            <tr>
              <th scope="col" className="cell--pick" title="Отметьте, что берёте в работу: в итоги и себестоимость идут только такие позиции">В работу</th>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" title={c.tip} className={colClass(c.key)}>{c.title.replace('{cur}', so.currency)}</th>
              ))}
              <th scope="col" className="cell--actions"><span className="so-lines__sr">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={LINE_COLUMN_COUNT} className="muted">Товаров пока нет — впишите первый в строку ниже или вставьте список из Excel.</td></tr>
            ) : rows.map(row)}
          </tbody>
          <tfoot>
            <QuickLineEntry order={order} so={so} nextSeq={nextSeq} rate={rate} onPasteTable={(text) => setPasting(text)} />
          </tfoot>
        </table>
      </div>
      {pasting === null ? (
        <div className="so-lines__actions">
          <button type="button" className="btn btn--small" onClick={() => setPasting('')}>Вставить из Excel</button>
          <span className="small muted">Enter в строке ввода сохраняет товар; полная форма — «Подробнее» у строки.</span>
        </div>
      ) : (
        <PastePanel key="paste" order={order} so={so} nextSeq={nextSeq} initialText={pasting} onClose={() => setPasting(null)} />
      )}
    </div>
  );
}

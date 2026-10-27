// Отправка товаров заказа в поставку (истории 99, 101): из заказа — выбор поставки (или «Новая поставка», номер сам),
// из поставки — выбор заказа (поиск по коду и заказчику); дальше — товары «В работе» с неотгруженным остатком,
// кол-во подставлено целиком (можно уменьшить, не больше остатка) → «Добавить» создаёт партии (CBM/вес/места пропорционально).

import { useMemo, useState } from 'react';
import type { Order, Shipment } from '../../../domain/model';
import { orderRef } from '../../../domain/numbering';
import { filterByQuery } from '../../../domain/search';
import { useData } from '../../DataContext';
import { ErrorBanner, Field, FormGrid, SelectField, SuggestInput, parseUserNumber } from '../../components';
import { storeDefaultTypes } from '../../directories/shipmentTypes';
import { formatQty } from '../../format';
import {
  fullQtys, newShipmentDraft, orderSearchText, planSendBatches, sendQtyErrors, sendableLines, type SendQtys, type SendRow,
} from './sendLogic';
import { proportionalDefaults } from './shipmentLogic';

const NEW_SHIPMENT = '__new__';

export interface SendResult { shipmentId: string; shipmentNumber: string; count: number }

type Props =
  | { order: Order; shipment?: undefined; onClose: () => void; onDone?: (r: SendResult) => void }
  | { shipment: Shipment; order?: undefined; onClose: () => void; onDone?: (r: SendResult) => void };

const orderText = (o: Order) => [orderRef(o), o.customer, o.title].filter(Boolean).join(' · ');

/** Таблица товаров с полем «В поставку». Поле держит введённый текст; наружу — число, NaN (не число) или undefined. */
function SendLinesTable({ rows, texts, errors, onChange }: {
  rows: SendRow[]; texts: Record<string, string>; errors: Record<string, string>; onChange: (lineId: string, text: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="table ship-send-table">
        <thead>
          <tr>
            <th scope="col">Поставщик</th>
            <th scope="col">Товар</th>
            <th scope="col" style={{ textAlign: 'right' }}>Кол-во</th>
            <th scope="col" style={{ textAlign: 'right' }}>Отгружено</th>
            <th scope="col" style={{ textAlign: 'right' }}>Остаток</th>
            <th scope="col" style={{ textAlign: 'right' }}>В поставку</th>
            <th scope="col" style={{ textAlign: 'right' }}>CBM</th>
            <th scope="col" style={{ textAlign: 'right' }}>Вес, кг</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = parseUserNumber(texts[r.line.id] ?? '');
            const d = typeof q === 'number' && q > 0 ? proportionalDefaults(r.line, q) : {};
            const err = errors[r.line.id];
            const errId = `send-err-${r.line.id}`;
            return (
              <tr key={r.line.id} data-testid={`send-row-${r.line.id}`}>
                <td>{r.supplierName || '—'}</td>
                <td className="ship-send-table__name">{r.line.seq}. {r.title}</td>
                <td style={{ textAlign: 'right' }}>{formatQty(r.line.qty)}</td>
                <td style={{ textAlign: 'right' }}>{formatQty(r.shipped)}</td>
                <td style={{ textAlign: 'right' }}>{formatQty(r.remaining)}</td>
                <td style={{ textAlign: 'right' }}>
                  <input
                    className="input input--number ship-send-table__qty" inputMode="decimal" value={texts[r.line.id] ?? ''}
                    aria-label={`В поставку: ${r.title}`} aria-invalid={err ? true : undefined} aria-describedby={err ? errId : undefined}
                    onChange={(e) => onChange(r.line.id, e.target.value)}
                  />
                  {err ? <span className="field__error ship-send-table__err" id={errId} role="alert">{err}</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}>{d.cbm === undefined ? '—' : formatQty(d.cbm)}</td>
                <td style={{ textAlign: 'right' }}>{d.weight === undefined ? '—' : formatQty(d.weight)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SendToShipment(props: Props) {
  const data = useData();
  const { ds, today } = data;
  const [shipmentChoice, setShipmentChoice] = useState<string | undefined>(() =>
    props.shipment ? props.shipment.id : ds.shipments.length === 0 ? NEW_SHIPMENT : undefined);
  const [orderId, setOrderId] = useState<string | undefined>(props.order?.id);
  const [orderQuery, setOrderQuery] = useState('');
  const rows = useMemo(() => (orderId ? sendableLines(ds, orderId) : []), [ds, orderId]);
  const [texts, setTexts] = useState<Record<string, string>>(() => textsOf(fullQtys(orderId ? sendableLines(ds, orderId) : [])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const draftShipment = useMemo(() => newShipmentDraft(ds, today), [ds, today]);
  const shipmentOptions = useMemo(() => [
    { value: NEW_SHIPMENT, label: `Новая поставка (${draftShipment.number})` },
    ...[...ds.shipments].sort((a, b) => b.number.localeCompare(a.number, 'ru', { numeric: true })).map((s) => ({ value: s.id, label: s.number })),
  ], [ds.shipments, draftShipment.number]);

  // заказы, у которых есть что отправить, — для выбора из поставки
  const orderChoices = useMemo(() => ds.orders.filter((o) => sendableLines(ds, o.id).length > 0), [ds]);
  const suggestions = filterByQuery(orderChoices, (o) => orderSearchText(o), orderQuery)
    .map((o) => ({ key: o.id, value: o.id, label: orderText(o) }));

  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = ds.orders.find((x) => x.id === id);
    setOrderQuery(o ? orderText(o) : '');
    setTexts(textsOf(fullQtys(sendableLines(ds, id))));
    setErrors({});
  };

  const qtys: SendQtys = Object.fromEntries(rows.map((r) => {
    const v = parseUserNumber(texts[r.line.id] ?? '');
    return [r.line.id, v === null ? NaN : v];
  }));

  const submit = async () => {
    const found: Record<string, string> = {};
    if (!shipmentChoice) found._shipment = 'Выберите поставку';
    if (!orderId) found._order = 'Выберите заказ';
    if (orderId) Object.assign(found, sendQtyErrors(ds, rows, qtys));
    setErrors(found);
    if (Object.keys(found).length > 0 || !shipmentChoice) return;
    setBusy(true);
    setFailure(undefined);
    try {
      let target = ds.shipments.find((s) => s.id === shipmentChoice);
      if (shipmentChoice === NEW_SHIPMENT || !target) {
        target = draftShipment;
        // справочник типов ещё пуст — записать заранее заведённые, чтобы ссылка типа легла на запись
        if (target.typeId && !ds.shipmentTypes.some((t) => t.id === target!.typeId)) await storeDefaultTypes(ds, data.save);
        await data.save('shipments', target);
        // поставка записана — повтор после сбоя пишет в неё же, а не создаёт вторую
        setShipmentChoice(target.id);
      }
      const batches = planSendBatches(ds, target.id, rows, qtys);
      for (const b of batches) {
        await data.save('batches', b);
        // записанная партия снимается из количеств — повтор не задвоит её
        setTexts((t) => ({ ...t, [b.lineId]: '' }));
      }
      setBusy(false);
      props.onDone?.({ shipmentId: target.id, shipmentNumber: target.number, count: batches.length });
    } catch (e) {
      setFailure(e);
      setBusy(false);
    }
  };

  const title = props.order ? 'Отправить в поставку' : 'Добавить из заказа';
  return (
    <form className="ship-send" aria-label={title} noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 className="ship-send__title">{title}</h3>
      {failure !== undefined ? <ErrorBanner error={failure} /> : null}
      <FormGrid>
        {props.order ? (
          <SelectField
            label="Поставка" value={shipmentChoice} options={shipmentOptions} placeholder="— выберите поставку —" required className="ui-card__wide"
            error={errors._shipment} onChange={setShipmentChoice}
            hint={shipmentChoice === NEW_SHIPMENT ? 'Номер присвоится сам; тип, перевозчика и даты — в карточке поставки' : undefined}
          />
        ) : (
          <Field label="Заказ" required error={errors._order} hint="Поиск по номеру заказа, заказчику или названию" className="ui-card__wide">
            {({ id, describedBy, invalid }) => (
              <SuggestInput
                id={id} value={orderQuery} aria-describedby={describedBy} aria-invalid={invalid || undefined}
                onChange={(t) => { setOrderQuery(t); if (orderId) { setOrderId(undefined); setTexts({}); } }}
                suggestions={suggestions} onPick={(s) => pickOrder(s.value)} openOnFocus showEmpty autoActivate
                placeholder="З-2026-… или заказчик"
              />
            )}
          </Field>
        )}
      </FormGrid>
      {props.shipment && orderChoices.length === 0 ? <p className="ship-muted">Нет заказов с неотгруженными товарами «В работе».</p> : null}
      {orderId && rows.length === 0 ? <p className="ship-muted">У заказа нет товаров «В работе» с неотгруженным остатком.</p> : null}
      {rows.length > 0 ? (
        <>
          <p className="ship-muted small">Количество подставлено целиком — можно уменьшить; 0 или пусто — товар не отправляется.</p>
          <SendLinesTable
            rows={rows} texts={texts} errors={errors}
            onChange={(lineId, text) => setTexts((t) => ({ ...t, [lineId]: text }))}
          />
        </>
      ) : null}
      {errors._form ? <p className="field__error" role="alert">{errors._form}</p> : null}
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy || rows.length === 0}>Добавить</button>
        <button type="button" className="btn" onClick={props.onClose}>Отмена</button>
      </div>
    </form>
  );
}

function textsOf(q: SendQtys): Record<string, string> {
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v === undefined ? '' : String(v).replace('.', ',')]));
}

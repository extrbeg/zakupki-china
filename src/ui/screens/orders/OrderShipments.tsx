// Раздел «Поставки» карточки заказа (история 99): поставки, в которых едут товары заказа, — с товарами (кол-во, CBM, вес),
// отгружено/остаток по товару и долей затрат поставки, легшей на заказ; «Отправить в поставку» — товары «В работе» с остатком.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { orderShipmentShares } from '../../../domain/costShares';
import type { Batch, Order, Shipment } from '../../../domain/model';
import { shipmentTypeOf } from '../../../domain/shipmentTypes';
import { useData } from '../../DataContext';
import { EMPTY, MODE_LABEL, formatDate, formatMoney, formatQty } from '../../format';
import { formatSharePct } from '../costs/splitText';
import { SendToShipment, type SendResult } from '../shipments/SendToShipment';
import { lineTitle, sendableLines } from '../shipments/sendLogic';
import { proportionalDefaults, shippedQty } from '../shipments/shipmentLogic';
import '../shipments/shipments.css';

const dates = (s: Shipment) => [
  s.consolidationDate ? `на консолидацию ${formatDate(s.consolidationDate)}` : '',
  s.sentDate ? `отправка в РФ ${formatDate(s.sentDate)}` : '',
  s.arrivalDate ? `прибытие на СВХ ${formatDate(s.arrivalDate)}` : '',
].filter(Boolean).join(' · ');

export function OrderShipments({ order }: { order: Order }) {
  const { ds, costing } = useData();
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<SendResult | undefined>(undefined);

  const lines = useMemo(() => new Map(ds.lines.filter((l) => l.orderId === order.id).map((l) => [l.id, l])), [ds.lines, order.id]);
  const shares = useMemo(() => orderShipmentShares(ds, costing, order.id), [ds, costing, order.id]);
  const sendable = useMemo(() => sendableLines(ds, order.id), [ds, order.id]);

  const shipments = useMemo(() => {
    const byShipment = new Map<string, Batch[]>();
    for (const b of ds.batches) {
      if (!lines.has(b.lineId)) continue;
      byShipment.set(b.shipmentId, [...(byShipment.get(b.shipmentId) ?? []), b]);
    }
    return [...byShipment]
      .map(([id, batches]) => ({ shipment: ds.shipments.find((s) => s.id === id), id, batches }))
      .sort((a, b) => (a.shipment?.number ?? '').localeCompare(b.shipment?.number ?? '', 'ru', { numeric: true }));
  }, [ds.batches, ds.shipments, lines]);

  const supplierName = (lineId: string) => {
    const so = ds.supplierOrders.find((s) => s.id === lines.get(lineId)?.supplierOrderId);
    return ds.suppliers.find((s) => s.id === so?.supplierId)?.name ?? lines.get(lineId)?.supplierName ?? '';
  };
  const soSeq = (lineId: string) => ds.supplierOrders.find((s) => s.id === lines.get(lineId)?.supplierOrderId)?.seq ?? 0;
  const totalShare = shares.reduce((s, x) => s + x.rub, 0);

  return (
    <section className="ui-card" aria-labelledby="order-shipments-title">
      <div className="ship-head">
        <h2 className="ui-card__title" id="order-shipments-title">Поставки</h2>
        {!adding && sendable.length > 0 ? (
          <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); setDone(undefined); }}>Отправить в поставку</button>
        ) : null}
      </div>
      {done ? (
        <p className="ship-done" role="status">
          Добавлено в поставку <Link to={`/shipments/${done.shipmentId}`}>{done.shipmentNumber}</Link>: товаров {done.count}.
        </p>
      ) : null}
      {adding ? <SendToShipment order={order} onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setDone(r); }} /> : null}
      {shipments.length === 0 ? <p className="muted">Товары заказа пока не отправлены ни в одну поставку.</p> : null}
      {shipments.map(({ shipment, id, batches }) => {
        const own = shares.filter((s) => s.shipmentId === id);
        const ownSum = own.reduce((s, x) => s + x.rub, 0);
        const rows = [...batches].sort((a, b) => soSeq(a.lineId) - soSeq(b.lineId) || (lines.get(a.lineId)?.seq ?? 0) - (lines.get(b.lineId)?.seq ?? 0));
        const typeName = shipment ? shipmentTypeOf(ds, shipment)?.name ?? MODE_LABEL[shipment.mode] : '';
        return (
          <div key={id} className="ord-ship" data-testid={`order-shipment-${id}`}>
            <div className="ord-ship__head">
              <h3>{shipment ? <Link to={`/shipments/${id}`}>{shipment.number}</Link> : 'Поставка не найдена'}</h3>
              {shipment ? (
                <span className="ord-ship__meta">
                  {[typeName, shipment.containerNo ? `контейнер ${shipment.containerNo}` : '', dates(shipment)].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Поставщик</th><th scope="col">Товар</th>
                    <th scope="col" style={{ textAlign: 'right' }}>В поставке</th>
                    <th scope="col" style={{ textAlign: 'right' }}>CBM</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Вес, кг</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Отгружено</th>
                    <th scope="col" style={{ textAlign: 'right' }}>Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const line = lines.get(b.lineId)!;
                    const d = proportionalDefaults(line, b.qty);
                    const shipped = shippedQty(ds, line.id);
                    return (
                      <tr key={b.id}>
                        <td>{supplierName(line.id) || EMPTY}</td>
                        <td className="ship-send-table__name">{line.seq}. {lineTitle(line)}</td>
                        <td style={{ textAlign: 'right' }}>{formatQty(b.qty)}</td>
                        <td style={{ textAlign: 'right' }}>{formatQty(b.cbm ?? d.cbm)}</td>
                        <td style={{ textAlign: 'right' }}>{formatQty(b.weight ?? d.weight)}</td>
                        <td style={{ textAlign: 'right' }}>{formatQty(shipped)} из {formatQty(line.qty)}</td>
                        <td style={{ textAlign: 'right' }}>{formatQty(Math.max(0, line.qty - shipped))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ord-ship__share" data-testid={`order-shipment-share-${id}`}>
              {own.length === 0 ? (
                <span className="muted">Затрат поставки на этот заказ пока нет.</span>
              ) : (
                <>
                  <strong>Затраты поставки на заказ: {formatMoney(ownSum)} ₽</strong>
                  <ul>
                    {own.map((s) => (
                      <li key={s.cost.id}>
                        {s.cost.code ? `${s.cost.code} · ` : ''}{s.cost.costType}{s.cost.targetType === 'declaration' ? ' (декларация)' : ''}
                        {s.cost.status === 'plan' ? ' · план' : ''} — {formatSharePct(s.pct)} ({formatMoney(s.rub)} ₽)
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        );
      })}
      {shipments.length > 0 && totalShare !== 0 ? (
        <p className="ord-ship__share"><strong>Всего затрат поставок на заказ: {formatMoney(totalShare)} ₽</strong></p>
      ) : null}
      {shipments.length > 0 && sendable.length > 0 ? (
        <p className="muted small">Ещё не отправлено: товаров «В работе» с остатком — {sendable.length}.</p>
      ) : null}
    </section>
  );
}

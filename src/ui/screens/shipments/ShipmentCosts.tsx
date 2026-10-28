// Затраты, привязанные к поставке и её декларациям (просмотр; вносятся на экране «Затраты» — ссылки ведут туда с привязкой и фильтром).

import { Link } from 'react-router-dom';
import { F } from '../../../domain/labels';
import type { Shipment } from '../../../domain/model';
import { useData } from '../../DataContext';
import { formatMoney } from '../../format';

export function ShipmentCosts({ shipment }: { shipment: Shipment }) {
  const { ds, costing } = useData();
  const declIds = new Set(ds.declarations.filter((d) => d.shipmentId === shipment.id).map((d) => d.id));
  const costs = ds.costs.filter((c) => (c.targetType === 'shipment' && c.targetId === shipment.id) || (c.targetType === 'declaration' && declIds.has(c.targetId)));
  const id = encodeURIComponent(shipment.id);
  return (
    <section className="ui-card" aria-labelledby="ship-costs-title">
      <h2 className="ui-card__title" id="ship-costs-title">Затраты поставки</h2>
      {costs.length === 0 ? (
        <p className="muted">Затрат на поставку пока нет.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th scope="col">{F.costType}</th><th scope="col">Привязка</th><th scope="col">Статус</th><th scope="col" style={{ textAlign: 'right' }}>Сумма</th><th scope="col" style={{ textAlign: 'right' }}>В рублях</th></tr></thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td>{c.costType}</td>
                  <td>{c.targetType === 'shipment' ? 'Поставка' : `ДТ ${ds.declarations.find((d) => d.id === c.targetId)?.number ?? ''}`.trim()}</td>
                  <td>{c.status === 'fact' ? 'факт' : 'план'}</td>
                  <td style={{ textAlign: 'right' }}>{c.amount !== undefined ? `${formatMoney(c.amount)} ${c.currency}` : ''}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(costing.costsRub.find((x) => x.costId === c.id)?.rub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ui-card__actions">
        <Link className="btn btn--primary" to={`/costs?add=shipment:${id}`}>Добавить затрату</Link>
        <Link className="btn" to={`/costs?shipment=${id}`}>Все затраты</Link>
      </div>
    </section>
  );
}

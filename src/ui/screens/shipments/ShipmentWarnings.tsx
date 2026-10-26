// Предупреждения движка по этой поставке: нет CBM, нет веса, партии без декларации (истории 40, 42).

import type { Dataset } from '../../../domain/model';
import { useData, type CostWarning } from '../../DataContext';

const CODES: CostWarning['code'][] = ['NO_CBM', 'NO_WEIGHT', 'NO_DECLARATION'];

/** Подпись партии для ссылки: «Заказ № 12 · Кран шаровой · 300 шт». */
export function batchTitle(ds: Dataset, batchId: string): string {
  const batch = ds.batches.find((b) => b.id === batchId);
  if (!batch) return 'партия';
  const line = ds.lines.find((l) => l.id === batch.lineId);
  const order = ds.orders.find((o) => o.id === line?.orderId);
  const name = line?.customerName || line?.docName || line?.supplierName || `позиция ${line?.seq ?? '?'}`;
  return `Заказ № ${order?.number ?? '?'} · ${name} · ${batch.qty} шт`;
}

export function ShipmentWarnings({ shipmentId, onPickBatch }: { shipmentId: string; onPickBatch: (batchId: string) => void }) {
  const { ds, costing } = useData();
  const warnings = costing.warnings.filter((w) => CODES.includes(w.code) && w.refs.some((r) => r.type === 'shipment' && r.id === shipmentId));
  if (warnings.length === 0) return null;
  return (
    <section className="ui-card ui-card--warning" aria-label="Предупреждения">
      <h2 className="ui-card__title">Предупреждения</h2>
      <ul className="ship-warnings">
        {warnings.map((w, i) => (
          <li key={`${w.code}-${i}`}>
            <span>{w.message}</span>
            <div className="ship-warnings__links">
              {w.refs.filter((r) => r.type === 'batch').map((r) => (
                <button key={r.id} type="button" className="btn btn--small" onClick={() => onPickBatch(r.id)}>
                  {`Партия: ${batchTitle(ds, r.id)}`}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

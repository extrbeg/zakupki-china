// «Что едет» (история 101): партии поставки по группам заказ → поставщик → товар, с себестоимостью единицы и итогами поставки;
// «Добавить из заказа» — товары заказа с остатком; форма добавления/правки одной партии (истории 14, 38, 46).

import { Link } from 'react-router-dom';
import { SHORT } from '../../../domain/labels';
import { compareOrders, orderRef } from '../../../domain/numbering';
import { useMemo, useState } from 'react';
import { newId } from '../../../domain/ids';
import type { Batch, Dataset, Line, Order, Shipment } from '../../../domain/model';
import { validateBatchQty } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { AddableSelect, ConfirmDelete, ErrorBanner, FormGrid, NumberField, isBadNumber, type DataColumn } from '../../components';
import { cleanRecord } from '../../directories/records';
import { formatMoney, formatQty, formatQtyUnit, unitOf } from '../../format';
import { lineChoices, proportionalDefaults, shippedQty } from './shipmentLogic';
import { batchTitle } from './ShipmentWarnings';
import { SendToShipment, type SendResult } from './SendToShipment';

const lineName = (line: Line | undefined) => line?.customerName || line?.docName || line?.supplierName || `позиция ${line?.seq ?? '?'}`;

interface FormProps { shipment: Shipment; batch?: Batch; onDone: () => void }

function BatchForm({ shipment, batch, onDone }: FormProps) {
  const data = useData();
  const { ds } = data;
  const [lineId, setLineId] = useState<string | undefined>(batch?.lineId);
  const [qty, setQty] = useState<number | undefined>(batch?.qty);
  // Пока поле не правили руками — в нём доля позиции пропорционально количеству.
  const [own, setOwn] = useState<{ cbm: boolean; weight: boolean; places: boolean }>({
    cbm: batch?.cbm !== undefined, weight: batch?.weight !== undefined, places: batch?.places !== undefined,
  });
  const [vals, setVals] = useState<{ cbm?: number; weight?: number; places?: number }>({ cbm: batch?.cbm, weight: batch?.weight, places: batch?.places });
  const [declarationId, setDeclarationId] = useState<string | undefined>(batch?.declarationId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const choices = useMemo(() => lineChoices(ds), [ds]);
  const line = ds.lines.find((l) => l.id === lineId);
  const defaults = proportionalDefaults(line, isBadNumber(qty) ? undefined : qty);
  const shown = {
    cbm: own.cbm ? vals.cbm : defaults.cbm,
    weight: own.weight ? vals.weight : defaults.weight,
    places: own.places ? vals.places : defaults.places,
  };
  const remaining = line ? line.qty - shippedQty(ds, line.id, batch?.id) : undefined;

  const pickLine = (id: string | undefined) => {
    setLineId(id);
    const l = ds.lines.find((x) => x.id === id);
    if (l) setQty(l.qty - shippedQty(ds, l.id, batch?.id));
    setOwn({ cbm: false, weight: false, places: false });
    setErrors({});
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (!lineId) found.lineId = 'Выберите позицию';
    if (isBadNumber(qty)) found.qty = 'Введите число';
    for (const [key, label] of [['cbm', 'CBM'], ['weight', 'Вес'], ['places', 'Количество мест']] as const) {
      const v = shown[key];
      if (isBadNumber(v)) found[key] = 'Введите число';
      else if (v !== undefined && v < 0) found[key] = `${label} не может быть отрицательным`;
    }
    const record = cleanRecord<Batch>({
      id: batch?.id ?? newId('bat'), shipmentId: shipment.id, lineId: lineId ?? '', qty: qty ?? 0,
      cbm: shown.cbm, weight: shown.weight, places: shown.places, declarationId,
    });
    if (lineId && !found.qty) Object.assign(found, validateBatchQty(ds, { ...record, qty: qty ?? 0 }));
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      await data.save('batches', record);
      onDone();
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  const declOptions = ds.declarations.filter((d) => d.shipmentId === shipment.id).map((d) => ({ value: d.id, label: d.number || d.comment || 'без номера' }));

  return (
    <form className="ship-batch-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3 className="ship-batch-form__title">{batch ? `Правка партии: ${lineName(line)}` : 'Добавить партию'}</h3>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        {batch ? null : (
          <>
            <AddableSelect
              label="Позиция" search value={lineId} placeholder="заказ, поставщик или товар" error={errors.lineId} required
              hint="Начните вводить — найдём по номеру заказа, поставщику или названию"
              options={choices.map((c) => ({ value: c.line.id, label: c.label }))} onChange={pickLine}
            />
          </>
        )}
        <NumberField
          label="Кол-во в партии" value={qty} required error={errors.qty} onChange={setQty}
          hint={remaining !== undefined ? `Остаток позиции: ${formatQtyUnit(remaining, unitOf(ds.lines.find((l) => l.id === lineId)))}` : undefined}
        />
        <NumberField label="CBM" value={shown.cbm} error={errors.cbm} onChange={(v) => { setOwn((o) => ({ ...o, cbm: true })); setVals((s) => ({ ...s, cbm: v })); }} />
        <NumberField label="Вес, кг" value={shown.weight} error={errors.weight} onChange={(v) => { setOwn((o) => ({ ...o, weight: true })); setVals((s) => ({ ...s, weight: v })); }} />
        <NumberField label="Мест" value={shown.places} error={errors.places} onChange={(v) => { setOwn((o) => ({ ...o, places: true })); setVals((s) => ({ ...s, places: v })); }} />
        <AddableSelect label="Декларация" search value={declarationId} placeholder="— без декларации —" options={declOptions} onChange={setDeclarationId} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{batch ? 'Сохранить партию' : 'Добавить партию'}</button>
        {batch ? <button type="button" className="btn" onClick={onDone}>Отмена</button> : null}
      </div>
    </form>
  );
}

/** Партии поставки по группам: заказ → поставщик → товар (по номеру заказа, поставщика в заказе, позиции). */
function groupBatches(ds: Dataset, batches: Batch[]) {
  const info = batches.map((b) => {
    const line = ds.lines.find((l) => l.id === b.lineId);
    const order = ds.orders.find((o) => o.id === line?.orderId);
    const so = ds.supplierOrders.find((s) => s.id === line?.supplierOrderId);
    const supplier = ds.suppliers.find((s) => s.id === so?.supplierId)?.name ?? line?.supplierName ?? '';
    return { b, line, order, so, supplier };
  });
  info.sort((x, y) => (x.order && y.order ? compareOrders(x.order, y.order) : (x.order ? 0 : 1) - (y.order ? 0 : 1))
    || (x.so?.seq ?? 0) - (y.so?.seq ?? 0) || (x.line?.seq ?? 0) - (y.line?.seq ?? 0));
  const groups: { key: string; order: Order | undefined; suppliers: { key: string; name: string; items: typeof info }[] }[] = [];
  for (const it of info) {
    const okey = it.order?.id ?? '?';
    let g = groups.find((x) => x.key === okey);
    if (!g) { g = { key: okey, order: it.order, suppliers: [] }; groups.push(g); }
    const skey = it.so?.id ?? '?';
    let sg = g.suppliers.find((x) => x.key === skey);
    if (!sg) { sg = { key: skey, name: it.supplier, items: [] }; g.suppliers.push(sg); }
    sg.items.push(it);
  }
  return groups;
}

export function BatchesSection({ shipment, highlightId }: { shipment: Shipment; highlightId?: string }) {
  const data = useData();
  const { ds, costing } = data;
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [rowError, setRowError] = useState<unknown>(undefined);
  const [adding, setAdding] = useState(false);
  const [done, setDone] = useState<SendResult | undefined>(undefined);

  const rows = ds.batches.filter((b) => b.shipmentId === shipment.id);
  const decls = ds.declarations.filter((d) => d.shipmentId === shipment.id);
  const editing = rows.find((b) => b.id === editId);
  const groups = groupBatches(ds, rows);

  const run = async (fn: () => Promise<void>) => {
    setRowError(undefined);
    try { await fn(); } catch (e) { setRowError(e); }
  };

  const assign = (b: Batch, declId: string) => run(async () => {
    const next: Batch = { ...b };
    if (declId) next.declarationId = declId;
    else delete next.declarationId;
    await data.save('batches', next);
  });

  /** CBM, вес, места партии: свои или доля позиции пропорционально количеству (как считает движок). */
  const measure = (b: Batch, k: 'cbm' | 'weight' | 'places') => b[k] ?? proportionalDefaults(ds.lines.find((l) => l.id === b.lineId), b.qty)[k];
  const sum = (k: 'cbm' | 'weight' | 'places') => rows.reduce((s, b) => s + (measure(b, k) ?? 0), 0);

  const columns: DataColumn<Batch>[] = [
    { key: 'line', header: 'Товар', render: (b) => lineName(ds.lines.find((l) => l.id === b.lineId)) },
    { key: 'qty', header: 'Кол-во', align: 'right', render: (b) => formatQtyUnit(b.qty, unitOf(ds.lines.find((l) => l.id === b.lineId))) },
    ...(['cbm', 'weight', 'places'] as const).map((k): DataColumn<Batch> => ({
      key: k, header: k === 'cbm' ? 'CBM' : k === 'weight' ? 'Вес, кг' : 'Мест', align: 'right',
      render: (b) => {
        if (b[k] !== undefined) return formatQty(b[k]);
        const d = proportionalDefaults(ds.lines.find((l) => l.id === b.lineId), b.qty)[k];
        return d === undefined ? '' : <span className="ship-muted" title="Из позиции пропорционально количеству">{formatQty(d)}</span>;
      },
    })),
    {
      key: 'declaration', header: 'Декларация', render: (b) => (
        <select
          className="input ship-select" value={b.declarationId ?? ''} aria-label={`Декларация для партии ${batchTitle(ds, b.id)}`}
          onChange={(e) => void assign(b, e.target.value)}
        >
          <option value="">—</option>
          {decls.map((d) => <option key={d.id} value={d.id}>{d.number || d.comment || 'без номера'}</option>)}
        </select>
      ),
    },
    {
      key: 'unit', header: SHORT.costUnit, align: 'right',
      render: (b) => <span data-testid="unit-cost">{formatMoney(costing.batches.find((x) => x.batchId === b.id)?.unitCost)}</span>,
    },
    {
      key: 'avg', header: `${SHORT.costUnit} (средняя по товару)`, align: 'right',
      render: (b) => <span data-testid="line-avg-cost">{formatMoney(costing.lines.find((x) => x.lineId === b.lineId)?.AV)}</span>,
    },
    {
      key: 'actions', header: '', render: (b) => (
        <span className="ship-row-actions">
          <button type="button" className="btn btn--small" aria-label={`Изменить партию ${batchTitle(ds, b.id)}`} onClick={() => setEditId(b.id)}>Изменить</button>{' '}
          <ConfirmDelete
            small ariaLabel={`Удалить партию ${batchTitle(ds, b.id)}`}
            onDelete={() => run(async () => { await data.remove('batches', b.id); })}
          />
        </span>
      ),
    },
  ];
  const n = columns.length;

  return (
    <section className="ui-card" aria-labelledby="ship-batches-title">
      <div className="ship-head">
        <h2 className="ui-card__title" id="ship-batches-title">Что едет</h2>
        {adding ? null : (
          <button type="button" className="btn btn--primary" onClick={() => { setAdding(true); setDone(undefined); }}>Добавить из заказа</button>
        )}
      </div>
      {done ? <p className="ship-done" role="status">Добавлено товаров: {done.count}.</p> : null}
      {adding ? (
        <SendToShipment shipment={shipment} onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setDone(r); }} />
      ) : null}
      {rowError !== undefined ? <ErrorBanner error={rowError} /> : null}
      {rows.length === 0 ? (
        <p className="ship-muted">В поставке пока нет товаров — добавьте их из заказа или по одной партии ниже.</p>
      ) : (
        // Своя таблица (а не DataTable): строке нужны id и пометка для перехода по ссылке из предупреждения, группам — свои строки.
        <div className="table-scroll">
          <table className="table ship-what">
            <thead>
              <tr>{columns.map((c) => <th key={c.key} scope="col" style={{ textAlign: c.align }}>{c.header}</th>)}</tr>
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <tr className="ship-group">
                  <th scope="rowgroup" colSpan={n}>
                    {g.order ? <>Заказ <Link to={`/orders/${g.order.id}`}>{orderRef(g.order)}</Link>{g.order.customer ? ` · ${g.order.customer}` : ''}{g.order.title ? ` · ${g.order.title}` : ''}</> : 'Заказ не найден'}
                  </th>
                </tr>
                {g.suppliers.map((sg) => [
                  <tr key={`s-${sg.key}`} className="ship-subgroup"><td colSpan={n}>Поставщик: {sg.name || '—'}</td></tr>,
                  ...sg.items.map(({ b }) => (
                    <tr
                      key={b.id} id={`batch-${b.id}`} data-testid={`batch-row-${b.id}`}
                      data-highlight={highlightId === b.id ? 'true' : undefined}
                      className={highlightId === b.id ? 'ship-row--highlight' : undefined}
                    >
                      {columns.map((c) => <td key={c.key} className={c.key === 'line' ? 'ship-item-name' : undefined} style={{ textAlign: c.align }}>{c.render(b)}</td>)}
                    </tr>
                  )),
                ])}
              </tbody>
            ))}
            <tfoot>
              <tr className="ship-totals" data-testid="shipment-totals">
                <td>Итого по поставке: заказов {groups.length}, партий {rows.length}</td>
                <td />
                <td style={{ textAlign: 'right' }} data-testid="total-cbm">{formatQty(Math.round(sum('cbm') * 10000) / 10000)}</td>
                <td style={{ textAlign: 'right' }} data-testid="total-weight">{formatQty(sum('weight'))}</td>
                <td style={{ textAlign: 'right' }} data-testid="total-places">{formatQty(sum('places'))}</td>
                <td colSpan={n - 5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {editing ? <BatchForm key={editing.id} shipment={shipment} batch={editing} onDone={() => setEditId(undefined)} /> : <BatchForm key={formKey} shipment={shipment} onDone={() => setFormKey((k) => k + 1)} />}
    </section>
  );
}

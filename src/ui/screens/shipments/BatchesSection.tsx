// Партии поставки: таблица с себестоимостью единицы и форма добавления/правки (истории 14, 38, 46).

import { useMemo, useState } from 'react';
import { newId } from '../../../domain/ids';
import type { Batch, Line, Shipment } from '../../../domain/model';
import { validateBatchQty } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { ConfirmDelete, ErrorBanner, FormGrid, NumberField, SelectField, TextField, isBadNumber, type DataColumn } from '../../components';
import { cleanRecord } from '../../directories/records';
import { formatMoney, formatQty } from '../../format';
import { lineChoices, proportionalDefaults, shippedQty } from './shipmentLogic';
import { batchTitle } from './ShipmentWarnings';

const lineName = (line: Line | undefined) => line?.customerName || line?.docName || line?.supplierName || `позиция ${line?.seq ?? '?'}`;

interface FormProps { shipment: Shipment; batch?: Batch; onDone: () => void }

function BatchForm({ shipment, batch, onDone }: FormProps) {
  const data = useData();
  const { ds } = data;
  const [search, setSearch] = useState('');
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
  const q = search.trim().toLowerCase();
  const visible = choices.filter((c) => c.line.id === lineId || !q || c.search.includes(q));
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
            <TextField label="Поиск позиции (заказ, поставщик, название)" type="search" value={search} onChange={setSearch} />
            <SelectField
              label="Позиция" value={lineId} placeholder="— выберите позицию —" error={errors.lineId} required
              options={visible.map((c) => ({ value: c.line.id, label: c.label }))} onChange={pickLine}
            />
          </>
        )}
        <NumberField
          label="Количество в партии" value={qty} required error={errors.qty} onChange={setQty}
          hint={remaining !== undefined ? `Остаток позиции: ${formatQty(remaining)} шт` : undefined}
        />
        <NumberField label="CBM" value={shown.cbm} error={errors.cbm} onChange={(v) => { setOwn((o) => ({ ...o, cbm: true })); setVals((s) => ({ ...s, cbm: v })); }} />
        <NumberField label="Вес, кг" value={shown.weight} error={errors.weight} onChange={(v) => { setOwn((o) => ({ ...o, weight: true })); setVals((s) => ({ ...s, weight: v })); }} />
        <NumberField label="Мест" value={shown.places} error={errors.places} onChange={(v) => { setOwn((o) => ({ ...o, places: true })); setVals((s) => ({ ...s, places: v })); }} />
        <SelectField label="Декларация" value={declarationId} placeholder="— без декларации —" options={declOptions} onChange={setDeclarationId} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{batch ? 'Сохранить партию' : 'Добавить партию'}</button>
        {batch ? <button type="button" className="btn" onClick={onDone}>Отмена</button> : null}
      </div>
    </form>
  );
}

export function BatchesSection({ shipment, highlightId }: { shipment: Shipment; highlightId?: string }) {
  const data = useData();
  const { ds, costing } = data;
  const [editId, setEditId] = useState<string | undefined>(undefined);
  const [formKey, setFormKey] = useState(0);
  const [rowError, setRowError] = useState<unknown>(undefined);

  const rows = ds.batches.filter((b) => b.shipmentId === shipment.id);
  const decls = ds.declarations.filter((d) => d.shipmentId === shipment.id);
  const editing = rows.find((b) => b.id === editId);

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

  const columns: DataColumn<Batch>[] = [
    {
      key: 'order', header: 'Заказ', render: (b) => {
        const line = ds.lines.find((l) => l.id === b.lineId);
        return ds.orders.find((o) => o.id === line?.orderId)?.number ?? '';
      },
    },
    {
      key: 'supplier', header: 'Поставщик', render: (b) => {
        const line = ds.lines.find((l) => l.id === b.lineId);
        const so = ds.supplierOrders.find((s) => s.id === line?.supplierOrderId);
        return ds.suppliers.find((s) => s.id === so?.supplierId)?.name ?? '';
      },
    },
    { key: 'line', header: 'Позиция', render: (b) => lineName(ds.lines.find((l) => l.id === b.lineId)) },
    { key: 'qty', header: 'Кол-во', align: 'right', render: (b) => formatQty(b.qty) },
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
      key: 'unit', header: 'Себестоимость ед., ₽', align: 'right',
      render: (b) => <span data-testid="unit-cost">{formatMoney(costing.batches.find((x) => x.batchId === b.id)?.unitCost)}</span>,
    },
    {
      key: 'avg', header: 'Средняя по позиции, ₽', align: 'right',
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

  return (
    <section className="ui-card" aria-labelledby="ship-batches-title">
      <h2 className="ui-card__title" id="ship-batches-title">Партии</h2>
      {rowError !== undefined ? <ErrorBanner error={rowError} /> : null}
      {rows.length === 0 ? (
        <p className="ship-muted">В поставке пока нет партий.</p>
      ) : (
        // Своя таблица (а не DataTable): строке нужны id и пометка для перехода по ссылке из предупреждения.
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>{columns.map((c) => <th key={c.key} scope="col" style={{ textAlign: c.align }}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.id} id={`batch-${b.id}`} data-testid={`batch-row-${b.id}`}
                  data-highlight={highlightId === b.id ? 'true' : undefined}
                  className={highlightId === b.id ? 'ship-row--highlight' : undefined}
                >
                  {columns.map((c) => <td key={c.key} style={{ textAlign: c.align }}>{c.render(b)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <BatchForm key={editing.id} shipment={shipment} batch={editing} onDone={() => setEditId(undefined)} /> : <BatchForm key={formKey} shipment={shipment} onDone={() => setFormKey((k) => k + 1)} />}
    </section>
  );
}

// Декларации поставки: добавление, правка, раскладка партий, плановые пошлина и НДС (истории 41–44).

import { useState } from 'react';
import { newId } from '../../../domain/ids';
import type { Declaration, Shipment } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, ErrorBanner, FormGrid, TextField } from '../../components';
import { cleanRecord } from '../../directories/records';
import { formatCoef, formatMoney } from '../../format';
import { declarationDeleteBlock, planDeclarationsBySupplier } from './shipmentLogic';
import { batchTitle } from './ShipmentWarnings';

function DeclarationCard({ declaration }: { declaration: Declaration }) {
  const data = useData();
  const { ds, costing } = data;
  const [draft, setDraft] = useState<Declaration>(declaration);
  const [error, setError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const forecast = costing.customsForecasts.find((f) => f.declarationId === declaration.id);
  const assigned = ds.batches.filter((b) => b.declarationId === declaration.id);
  const rate = formatCoef(forecast?.vatRate);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await data.save('declarations', cleanRecord<Declaration>({ ...draft, id: declaration.id, shipmentId: declaration.shipmentId }));
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };

  const remove = async () => {
    for (const b of assigned) {
      const next = { ...b };
      delete next.declarationId;
      await data.save('batches', next);
    }
    await data.remove('declarations', declaration.id);
  };

  return (
    <div className="ship-decl" data-testid={`declaration-${declaration.id}`}>
      {error !== undefined ? <ErrorBanner error={error} /> : null}
      <FormGrid>
        <TextField label="Номер ДТ" value={draft.number} onChange={(v) => setDraft((d) => ({ ...d, number: v }))} />
        <DateField label="Дата ДТ" value={draft.date} onChange={(v) => setDraft((d) => ({ ...d, date: v }))} />
        <TextField label="Комментарий к ДТ" value={draft.comment} onChange={(v) => setDraft((d) => ({ ...d, comment: v }))} />
      </FormGrid>
      <dl className="ship-decl__facts">
        <div><dt>Партий</dt><dd>{assigned.length}</dd></div>
        <div><dt>Таможенная стоимость</dt><dd>{formatMoney(forecast?.customsValue ?? 0)} ₽</dd></div>
        <div><dt>Плановая пошлина</dt><dd>{formatMoney(forecast?.duty ?? 0)} ₽</dd></div>
        <div><dt>{`Плановый НДС (${rate} %)`}</dt><dd>{formatMoney(forecast?.vat ?? 0)} ₽</dd></div>
      </dl>
      <p className="ship-decl__note">Прогноз по % пошлины позиций и ставке НДС поставки; в себестоимость входят только внесённые затраты.</p>
      {assigned.length > 0 ? <p className="ship-muted">{assigned.map((b) => batchTitle(ds, b.id)).join('; ')}</p> : null}
      <div className="ui-card__actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>Сохранить декларацию</button>
        <span className="ui-card__spacer" />
        <ConfirmDelete disabled={busy} blockReason={declarationDeleteBlock(ds, declaration.id)} onDelete={remove} />
      </div>
    </div>
  );
}

export function DeclarationsSection({ shipment }: { shipment: Shipment }) {
  const data = useData();
  const { ds } = data;
  const [number, setNumber] = useState('');
  const [date, setDate] = useState<string | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const decls = ds.declarations.filter((d) => d.shipmentId === shipment.id);
  const unassigned = ds.batches.filter((b) => b.shipmentId === shipment.id && !(b.declarationId && decls.some((d) => d.id === b.declarationId)));

  const guarded = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNote('');
    try { await fn(); } catch (e) { setError(e); }
    setBusy(false);
  };

  const add = () => guarded(async () => {
    await data.save('declarations', cleanRecord<Declaration>({ id: newId('dec'), shipmentId: shipment.id, number, date }));
    setNumber('');
    setDate(undefined);
  });

  const byVendor = () => guarded(async () => {
    const plan = planDeclarationsBySupplier(ds, shipment.id);
    for (const d of plan.newDeclarations) await data.save('declarations', d);
    for (const b of plan.updatedBatches) await data.save('batches', b);
    setNote(`Разложено партий: ${plan.updatedBatches.length}`);
  });

  return (
    <section className="ui-card" aria-labelledby="ship-decl-title">
      <h2 className="ui-card__title" id="ship-decl-title">Декларации</h2>
      {error !== undefined ? <ErrorBanner error={error} /> : null}
      {decls.length === 0 ? <p className="ship-muted">Деклараций пока нет. Отдельная декларация на каждого поставщика — состав задаёте вы.</p> : null}
      {decls.map((d) => <DeclarationCard key={d.id} declaration={d} />)}
      <div className="ship-new-decl">
        <TextField label="Номер новой ДТ" value={number} onChange={setNumber} />
        <DateField label="Дата новой ДТ" value={date} onChange={setDate} />
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void add()}>Добавить декларацию</button>
        <button type="button" className="btn" disabled={busy || unassigned.length === 0} onClick={() => void byVendor()}>По декларации на поставщика</button>
      </div>
      {note ? <p role="status" className="ship-muted">{note}</p> : null}
    </section>
  );
}

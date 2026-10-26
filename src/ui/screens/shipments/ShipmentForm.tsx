// Шапка поставки: тип, перевозчик, номер, даты, ставка НДС (истории 38, 44).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId } from '../../../domain/ids';
import type { Shipment } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, DirectorySelectField, ErrorBanner, FormGrid, NumberField, SelectField, TextField } from '../../components';
import { cleanRecord } from '../../directories/records';
import { MODE_OPTIONS } from '../../format';
import { defaultVatRate, shipmentDeleteBlock, shipmentNumberTaken } from './shipmentLogic';

export function ShipmentForm({ shipment }: { shipment?: Shipment }) {
  const data = useData();
  const { ds } = data;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Partial<Shipment>>(() => ({
    mode: 'sea_container', vatRate: defaultVatRate(ds), ...shipment,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Shipment>(key: K, value: Shipment[K] | undefined) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    const id = shipment?.id ?? newId('shp');
    const found: Record<string, string> = {};
    const number = (draft.number ?? '').trim();
    if (number === '') found.number = 'Введите номер поставки';
    else if (shipmentNumberTaken(ds, { id, number })) found.number = `Поставка «${number}» уже есть`;
    if (draft.vatRate === undefined || !Number.isFinite(draft.vatRate) || draft.vatRate < 0 || draft.vatRate > 100) found.vatRate = 'НДС — от 0 до 100 %';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      await data.save('shipments', cleanRecord<Shipment>({ ...draft, id, number } as Shipment));
      if (!shipment) navigate(`/shipments/${id}`, { replace: true });
      else setBusy(false);
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  const removeShipment = async () => {
    if (!shipment) return;
    // Затрат нет (запрет проверен) — партии и декларации уходят вместе с поставкой.
    for (const b of ds.batches.filter((x) => x.shipmentId === shipment.id)) await data.remove('batches', b.id);
    for (const d of ds.declarations.filter((x) => x.shipmentId === shipment.id)) await data.remove('declarations', d.id);
    await data.remove('shipments', shipment.id);
    navigate('/shipments');
  };

  return (
    <form
      className="ui-card" data-testid="shipment-form" noValidate
      onSubmit={(e) => { e.preventDefault(); void save(); }}
    >
      <h2 className="ui-card__title">{shipment ? `Поставка ${shipment.number}` : 'Новая поставка'}</h2>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        <TextField label="Номер поставки" required value={draft.number} onChange={(v) => set('number', v)} error={errors.number} />
        <SelectField label="Тип поставки" value={draft.mode} options={MODE_OPTIONS} onChange={(v) => set('mode', (v ?? 'other') as Shipment['mode'])} />
        <DirectorySelectField
          entity="carriers" label="Перевозчик" value={draft.carrierId} placeholder="— не выбран —" onChange={(v) => set('carrierId', v)}
        />
        <DateField label="Отправка на консолидацию" value={draft.consolidationDate} onChange={(v) => set('consolidationDate', v)} />
        <DateField label="Отправка в РФ" value={draft.sentDate} onChange={(v) => set('sentDate', v)} />
        <DateField label="Прибытие на СВХ" value={draft.arrivalDate} onChange={(v) => set('arrivalDate', v)} />
        <NumberField label="НДС, %" value={draft.vatRate} onChange={(v) => set('vatRate', v)} error={errors.vatRate} hint="По умолчанию — из настроек" />
        <TextField label="Комментарий" multiline value={draft.comment} onChange={(v) => set('comment', v)} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить поставку</button>
        <span className="ui-card__spacer" />
        {shipment ? <ConfirmDelete disabled={busy} blockReason={shipmentDeleteBlock(ds, shipment.id)} onDelete={removeShipment} /> : null}
      </div>
    </form>
  );
}

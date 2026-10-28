// Шапка поставки: номер (П-ГГГГ-NNN, сам), номер контейнера, тип из «Типов поставки», перевозчик, даты, ставка НДС (истории 38, 44, 97, 98).

import { useState } from 'react';
import { F } from '../../../domain/labels';
import { pastValues } from '../../directories/records';
import { useNavigate } from 'react-router-dom';
import { newId } from '../../../domain/ids';
import type { Dataset, Shipment } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, DirectorySelectField, ErrorBanner, FormGrid, NumberField, TextField } from '../../components';
import { nextShipmentCode, shipmentCodeYear } from '../../../domain/numbering';
import { modeForType, shipmentTypesOf, TYPE_ID_BY_MODE } from '../../../domain/shipmentTypes';
import { cleanRecord } from '../../directories/records';
import { ShipmentTypeField } from '../../directories/ShipmentTypeField';
import { storeDefaultTypes } from '../../directories/shipmentTypes';
import { defaultVatRate, shipmentDeleteBlock, shipmentNumberTaken } from './shipmentLogic';

/** Поставка без типа (ещё не перенесена) — тип по прежнему `mode`, если он есть среди типов. */
function legacyTypeId(ds: Dataset, s: Shipment): string | undefined {
  const id = TYPE_ID_BY_MODE[s.mode];
  return shipmentTypesOf(ds).some((t) => t.id === id) ? id : undefined;
}

export function ShipmentForm({ shipment }: { shipment?: Shipment }) {
  const data = useData();
  const { ds } = data;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Partial<Shipment>>(() => (shipment ? { ...shipment, typeId: shipment.typeId ?? legacyTypeId(ds, shipment) } : {
    mode: 'sea_container', typeId: TYPE_ID_BY_MODE.sea_container, vatRate: defaultVatRate(ds),
    number: nextShipmentCode(ds.shipments, shipmentCodeYear({}, data.today)),
  }));
  /** Номер новой поставки правили руками — он больше не следует за годом отправки в РФ (G28). */
  const [numberTouched, setNumberTouched] = useState(Boolean(shipment));
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
      // выбран заранее заведённый тип, а справочник ещё пуст — записать типы, чтобы ссылка легла на запись
      if (draft.typeId && !ds.shipmentTypes.some((t) => t.id === draft.typeId)) await storeDefaultTypes(ds, data.save);
      // прежний тип (mode) держится в лад с типом: по нему движок делит доставку, если тип пропадёт из справочника
      const mode = draft.typeId && draft.typeId !== shipment?.typeId ? modeForType(draft.typeId) : (draft.mode ?? 'other');
      await data.save('shipments', cleanRecord<Shipment>({ ...draft, id, number, mode } as Shipment));
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
        <TextField
          label="Номер поставки" required value={draft.number} error={errors.number} hint={shipment ? undefined : 'Присваивается сам: П-ГГГГ-NNN'}
          onChange={(v) => { setNumberTouched(true); set('number', v); }}
        />
        <TextField label={F.containerNo} value={draft.containerNo} onChange={(v) => set('containerNo', v)} suggestions={pastValues(ds.shipments, 'containerNo')} />
        <ShipmentTypeField value={draft.typeId} onChange={(v) => set('typeId', v)} />
        <DirectorySelectField
          entity="carriers" label="Перевозчик" value={draft.carrierId} placeholder="— не выбран —" onChange={(v) => set('carrierId', v)}
        />
        <DateField label="Отправка на консолидацию" value={draft.consolidationDate} onChange={(v) => set('consolidationDate', v)} />
        <DateField
          label="Отправка в РФ" value={draft.sentDate}
          onChange={(v) => setDraft((d) => ({
            ...d, sentDate: v,
            ...(numberTouched ? {} : { number: nextShipmentCode(ds.shipments, shipmentCodeYear({ sentDate: v }, data.today)) }),
          }))}
        />
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

// Реквизиты поставщика в заказе: поставщик, валюта, дата расчёта и ручной курс, условия оплаты, доставка, даты, Битрикс, комментарий.
// У существующего блока свёрнуты под кнопкой «Реквизиты поставщика»; у нового — открыты сразу.
// Дата расчёта у существующего поставщика сохраняется сразу (итоги пересчитываются), остальное — по кнопке.

import { useState } from 'react';
import { newId } from '../../../domain/ids';
import { calcRateFor, effectiveCalcDate } from '../../../domain/lineFigures';
import type { Currency, ISODate, Order, ShipmentMode, SupplierOrder } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, DirectorySelectField, ErrorBanner, Field, FormGrid, ListSelectField, NumberField, SelectField, TextField, isBadNumber } from '../../components';
import { CURRENCY_OPTIONS, MODE_OPTIONS, formatDate, formatRate } from '../../format';
import { compact, plannedReadyDate, supplierOrderDeleteBlock } from './orderLogic';

export const RATE_SOURCE_TEXT = { vtb: 'ВТБ', manual: 'введён вручную в «Курсах»', fixed: 'рубли' } as const;

interface Draft {
  supplierId?: string; currency: Currency; calcDate?: ISODate; calcRate?: number; paymentTerms?: string; plannedMode?: ShipmentMode;
  launchDate?: ISODate; productionDays?: number; actualReadyDate?: ISODate; bitrixTaskId: string; comment: string;
}

export function SupplierOrderForm({ order, so, seq, onSaved }: { order: Order; so?: SupplierOrder; seq: number; onSaved?: () => void }) {
  const data = useData();
  const { ds, today } = data;
  const [draft, setDraft] = useState<Draft>(() => ({
    supplierId: so?.supplierId, currency: so?.currency ?? 'CNY', calcDate: so?.calcDate, calcRate: so?.calcRate,
    paymentTerms: so?.paymentTerms, plannedMode: so?.plannedMode, launchDate: so?.launchDate, productionDays: so?.productionDays,
    actualReadyDate: so?.actualReadyDate, bitrixTaskId: so?.bitrixTaskId ?? '', comment: so?.comment ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const manualRate = draft.calcRate;
  const preview: SupplierOrder = {
    id: so?.id ?? 'new', orderId: order.id, seq, supplierId: draft.supplierId ?? '', currency: draft.currency, calcDate: draft.calcDate,
    calcRate: typeof manualRate === 'number' && manualRate > 0 ? manualRate : undefined,   // NaN > 0 — false
  };
  const rate = calcRateFor(ds, order, preview, today);
  const effDate = effectiveCalcDate(order, preview, today);
  const rateHint = (() => {
    if (preview.calcRate !== undefined) return `Курс задан вручную: ${formatRate(preview.calcRate)}`;
    if (!rate) return 'Нет курса на дату расчёта — введите курс вручную или добавьте его на экране «Курсы»';
    const base = `Курс на ${formatDate(rate.date)}: ${formatRate(rate.rate)} (${RATE_SOURCE_TEXT[rate.source]})`;
    return rate.exact ? base : `${base}; на дату расчёта ${formatDate(effDate)} курса нет — взят последний до неё`;
  })();
  const dateHint = draft.calcDate ? undefined
    : `по умолчанию — дата расчёта заказа${order.calcDate ? ` (${formatDate(order.calcDate)})` : ' (не задана — сегодня)'}`;
  const ready = plannedReadyDate({ launchDate: draft.launchDate, productionDays: isBadNumber(draft.productionDays) ? undefined : draft.productionDays });

  const quickCalcDate = async (v: ISODate | undefined) => {
    if (!so) return;
    const current = ds.supplierOrders.find((s) => s.id === so.id) ?? so;
    setSaveError(undefined);
    try {
      await data.save('supplierOrders', compact({ ...current, calcDate: v }) as SupplierOrder);
    } catch (e) {
      setSaveError(e);
    }
  };

  const save = async () => {
    const found: Record<string, string> = {};
    if (!draft.supplierId) found.supplierId = 'Выберите поставщика';
    const calcRate = draft.calcRate;
    if (isBadNumber(calcRate)) found.calcRate = 'Введите число';
    else if (calcRate !== undefined && calcRate <= 0) found.calcRate = 'Курс должен быть больше нуля';
    const days = draft.productionDays;
    if (isBadNumber(days)) found.productionDays = 'Введите число';
    else if (days !== undefined && days < 0) found.productionDays = 'Срок не может быть отрицательным';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const current = so ? ds.supplierOrders.find((s) => s.id === so.id) ?? so : undefined;
      const record = compact<SupplierOrder>({
        ...current,
        id: so?.id ?? newId('so'), orderId: order.id, seq,
        supplierId: draft.supplierId as string, currency: draft.currency, calcDate: draft.calcDate,
        calcRate, paymentTerms: draft.paymentTerms, plannedMode: draft.plannedMode,
        launchDate: draft.launchDate, productionDays: days, actualReadyDate: draft.actualReadyDate,
        bitrixTaskId: draft.bitrixTaskId, comment: draft.comment,
      });
      await data.save('supplierOrders', record);
      onSaved?.();
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="so-form" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        <DirectorySelectField entity="suppliers" label="Поставщик" required value={draft.supplierId} placeholder="— выберите —" error={errors.supplierId} onChange={(v) => patch({ supplierId: v })} />
        <SelectField label="Валюта" value={draft.currency} options={CURRENCY_OPTIONS} onChange={(v) => patch({ currency: (v ?? 'CNY') as Currency })} />
        <DateField
          label="Дата расчёта" value={draft.calcDate} hint={dateHint}
          onChange={(v) => { patch({ calcDate: v }); void quickCalcDate(v); }}
        />
        <NumberField label="Курс расчёта (вручную)" value={draft.calcRate} onChange={(v) => patch({ calcRate: v })} hint={rateHint} placeholder="авто" error={errors.calcRate} />
        <ListSelectField list="paymentTerms" label="Условия оплаты" value={draft.paymentTerms} placeholder="—" onChange={(v) => patch({ paymentTerms: v })} />
        <SelectField label="План. тип доставки" value={draft.plannedMode} options={MODE_OPTIONS} placeholder="—" onChange={(v) => patch({ plannedMode: v as ShipmentMode | undefined })} />
        <DateField label="Дата запуска" value={draft.launchDate} onChange={(v) => patch({ launchDate: v })} />
        <NumberField label="Срок изготовления, дн" value={draft.productionDays} onChange={(v) => patch({ productionDays: v })} error={errors.productionDays} />
        <Field label="Плановая готовность" hint="дата запуска + срок изготовления">
          {({ id }) => <output id={id} className="readonly-value">{formatDate(ready)}</output>}
        </Field>
        <DateField label="Факт. готовность" value={draft.actualReadyDate} onChange={(v) => patch({ actualReadyDate: v })} />
        <TextField label="ID задачи Битрикс24" value={draft.bitrixTaskId} onChange={(v) => patch({ bitrixTaskId: v })} />
        <TextField label="Комментарий" multiline value={draft.comment} onChange={(v) => patch({ comment: v })} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить поставщика</button>
        {so ? (
          <>
            <span className="ui-card__spacer" />
            <ConfirmDelete
              label="Удалить поставщика" blockReason={supplierOrderDeleteBlock(ds, so.id)}
              onDelete={async () => {
                for (const l of ds.lines.filter((x) => x.supplierOrderId === so.id)) await data.remove('lines', l.id);
                await data.remove('supplierOrders', so.id);
              }}
            />
          </>
        ) : null}
      </div>
    </form>
  );
}

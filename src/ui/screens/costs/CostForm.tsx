// Карточка затраты: привязка, тип, план/факт, даты, получатель, счёт, сумма в валюте или в рублях, курс.
// Курс подставляется сам (см. costDraft.ts), правка руками — «курс вручную».

import { useMemo, useState } from 'react';
import type { Cost, CostStatus, CostTargetType, Currency, Dataset, ISODate, PayeeType } from '../../../domain/model';
import { newId } from '../../../domain/ids';
import { costCodeTaken, nextCostCode } from '../../../domain/numbering';
import { CostSplit } from './CostSplit';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, DirectorySelectField, ErrorBanner, FormGrid, ListSelectField, NumberField, SelectField, TextField, isBadNumber, type DirectoryEntity } from '../../components';
import { CURRENCY_OPTIONS, formatRate, ruDate } from '../../format';
import {
  autoRate, buildCost, draftAmounts, draftFromCost, effectiveRate, newDraft, NO_RATE_TEXT, rateIsAuto,
  type AutoRate, type CostDraft, type CostErrors,
} from './costDraft';
import {
  PAYEE_TYPE_LABEL, PAYEE_TYPES, TARGET_TYPE_LABEL, TARGET_TYPES, costTypeOptions, targetOptions, targetSupplierOrderId,
} from './costRefs';

/** Справочник получателя по типу «Кому платим» (кроме «текстом»). */
const PAYEE_ENTITY: Record<Exclude<PayeeType, 'text'>, DirectoryEntity> = { supplier: 'suppliers', agent: 'agents', carrier: 'carriers' };

const round2 = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 100) / 100);

export interface CostFormPreset { targetType?: CostTargetType; targetId?: string }

function defaultCurrency(ds: Dataset, type: CostTargetType, id: string | undefined): Currency | undefined {
  if (!id) return undefined;
  const soId = targetSupplierOrderId(ds, type, id);
  return soId ? ds.supplierOrders.find((s) => s.id === soId)?.currency : undefined;
}

/** Подпись под курсом: откуда он взят. */
function rateNote(d: CostDraft, auto: AutoRate, today: ISODate): { text: string; warn?: boolean } {
  if (d.currency === 'RUB') return { text: 'рубли — курс 1' };
  if (d.rateMode === 'manual') return { text: 'курс вручную' };
  if (d.rateMode === 'stored' && d.status === 'fact') {
    return { text: `курс зафиксирован при сохранении${d.rateDate ? `, курс от ${ruDate(d.rateDate)}` : ''}${d.storedManual ? ' (курс вручную)' : ''}` };
  }
  if (d.status === 'fact' && !auto.date) return { text: 'укажите дату оплаты — курс подставится сам' };
  if (!auto.pick) return { text: NO_RATE_TEXT, warn: true };
  const p = auto.pick;
  const own = p.exact ? (p.source === 'manual' ? `ручной курс на ${ruDate(p.date)}` : `курс ВТБ на ${ruDate(p.date)}`) : `курс от ${ruDate(p.date)}`;
  if (d.status === 'fact') return { text: own };
  if (auto.fromSupplierCalcRate) return { text: 'план: курс расчёта поставщика в заказе (введён вручную)' };
  const basis = auto.date === today ? `план: курс на сегодня ${ruDate(auto.date)}` : `план: курс даты расчёта ${ruDate(auto.date ?? today)}`;
  return { text: p.exact ? basis : `${basis}, ${own}` };
}

export function CostForm({ cost, preset, onClose }: { cost?: Cost; preset?: CostFormPreset; onClose: () => void }) {
  const { ds, today, save, remove } = useData();
  const [d, setD] = useState<CostDraft>(() => {
    if (cost) return draftFromCost(cost);
    const draft = newDraft(today, preset);
    const cur = preset ? defaultCurrency(ds, draft.targetType, draft.targetId) : undefined;
    return cur ? { ...draft, currency: cur } : draft;
  });
  const [currencyTouched, setCurrencyTouched] = useState(Boolean(cost));
  /** Номер правили руками (или он уже был у затраты) — он больше не следует за привязкой (G33). */
  const [codeTouched, setCodeTouched] = useState(Boolean(cost?.code));
  const [errors, setErrors] = useState<CostErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const auto = useMemo(() => autoRate(ds, d, today), [ds, d, today]);
  const rate = effectiveRate(d, auto);
  const amounts = draftAmounts(d, rate);
  const note = rateNote(d, auto, today);
  const autoCode = d.targetId ? nextCostCode(ds, { targetType: d.targetType, targetId: d.targetId, entryDate: d.entryDate ?? today, paymentDate: d.paymentDate }) : null;
  const shownCode = codeTouched ? d.code ?? '' : autoCode ?? '';

  /** Смена даты оплаты или валюты: зафиксированный курс факта перестаёт действовать, ручной — остаётся. */
  const patchRateBasis = (patch: Partial<CostDraft>) =>
    setD((prev) => ({ ...prev, ...patch, rateMode: prev.rateMode === 'stored' ? 'auto' : prev.rateMode }));
  /** Смена привязки или статуса: режим курса не меняется (ручной и зафиксированный держатся). */
  const patch = (p: Partial<CostDraft>) => setD((prev) => ({ ...prev, ...p }));

  const setTargetType = (t: CostTargetType) => patch({ targetType: t, targetId: undefined });
  const setTarget = (id: string | undefined) => {
    const cur = !currencyTouched ? defaultCurrency(ds, d.targetType, id) : undefined;
    if (cur && cur !== d.currency) patchRateBasis({ targetId: id, currency: cur });
    else patch({ targetId: id });
  };

  const historyDate: ISODate | null = d.status === 'fact' ? d.paymentDate ?? null : auto.date;
  const canSaveToHistory = d.currency !== 'RUB' && d.rateMode === 'manual' && typeof d.rate === 'number' && d.rate > 0
    && historyDate !== null && !auto.pick?.exact;

  const saveToHistory = async () => {
    if (!canSaveToHistory || historyDate === null || d.currency === 'RUB') return;
    setBusy(true);
    setFailure(null);
    try {
      await save('rates', { id: newId('r'), date: historyDate, currency: d.currency, rate: d.rate!, source: 'manual', loadedAt: new Date().toISOString() });
      // теперь курс на эту дату есть в истории — он и подставляется
      patch({ rateMode: 'auto' });
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const code = shownCode.trim() || autoCode || undefined;
    const { cost: record, errors: e } = buildCost({ ...d, code }, auto);
    if (code && costCodeTaken(ds.costs, { id: d.id ?? '', code })) e.code = `Номер ${code} уже есть`;
    setErrors(e);
    if (!record || e.code) return;
    setBusy(true);
    setFailure(null);
    try {
      await save('costs', record);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!cost) return;
    setBusy(true);
    try {
      await remove('costs', cost.id);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const typeOptions = useMemo(() => costTypeOptions(ds), [ds]);
  const objOptions = useMemo(() => targetOptions(ds, d.targetType), [ds, d.targetType]);

  return (
    <form className="ui-card" aria-label={cost ? 'Затрата' : 'Новая затрата'} onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
      <h2 className="ui-card__title">{cost ? 'Затрата' : 'Новая затрата'}</h2>
      {failure ? <ErrorBanner error={failure} /> : null}
      <FormGrid>
        <TextField
          label="Номер затраты" value={shownCode} error={errors.code}
          hint={codeTouched ? undefined : 'Присваивается сам по привязке: Р-ГГГГ-<заказ>-NNN или Р-ГГГГ-П<поставка>-NNN'}
          onChange={(v) => { setCodeTouched(true); patch({ code: v }); }}
        />
        <SelectField
          label="Статус" value={d.status}
          options={[{ value: 'fact', label: 'Факт (оплачено)' }, { value: 'plan', label: 'План' }]}
          onChange={(v) => patch({ status: (v as CostStatus | undefined) ?? 'fact' })}
          hint={d.status === 'plan' ? 'План считается по курсу даты расчёта; курс фиксируется при переводе в факт' : undefined}
        />
        <DateField label="Дата заполнения" value={d.entryDate} onChange={(v) => patch({ entryDate: v })} error={errors.entryDate} required />
        <DateField
          label="Дата оплаты" value={d.paymentDate} onChange={(v) => patchRateBasis({ paymentDate: v })}
          error={errors.paymentDate} required={d.status === 'fact'}
        />
        <SelectField
          label="Привязка" value={d.targetType}
          options={TARGET_TYPES.map((t) => ({ value: t, label: TARGET_TYPE_LABEL[t] }))}
          onChange={(v) => setTargetType((v as CostTargetType | undefined) ?? 'order')}
        />
        <SelectField
          label="Объект привязки" value={d.targetId} options={objOptions} placeholder="— выберите —"
          onChange={setTarget} error={errors.targetId} required className="ui-card__wide"
        />
        <ListSelectField
          list="costType" label="Тип затраты" value={d.costType} options={typeOptions} placeholder="— выберите —"
          onChange={(v) => patch({ costType: v })} error={errors.costType} required
        />
        <SelectField
          label="Кому платим" value={d.payeeType} placeholder="—"
          options={PAYEE_TYPES.map((t) => ({ value: t, label: PAYEE_TYPE_LABEL[t] }))}
          onChange={(v) => patch({ payeeType: v as PayeeType | undefined, payeeId: undefined })}
        />
        {d.payeeType === 'text' ? (
          <TextField label="Получатель (текстом)" value={d.payeeText} onChange={(v) => patch({ payeeText: v })} />
        ) : d.payeeType ? (
          <DirectorySelectField
            key={d.payeeType} entity={PAYEE_ENTITY[d.payeeType]} label="Получатель" value={d.payeeId} placeholder="— выберите —"
            onChange={(v) => patch({ payeeId: v })}
          />
        ) : null}
        <TextField label="Исполнитель операции" value={d.executor} onChange={(v) => patch({ executor: v })} />
        <TextField label="Номер счёта" value={d.invoiceNumber} onChange={(v) => patch({ invoiceNumber: v })} />
        <DateField label="Дата счёта" value={d.invoiceDate} onChange={(v) => patch({ invoiceDate: v })} />
      </FormGrid>

      <h3 className="ui-card__section">Сумма и курс</h3>
      <FormGrid>
        <SelectField
          label="Валюта" value={d.currency}
          options={CURRENCY_OPTIONS}
          onChange={(v) => { setCurrencyTouched(true); patchRateBasis({ currency: (v as Currency | undefined) ?? 'RUB' }); }}
        />
        <NumberField
          label="Сумма в валюте"
          value={d.amountSource === 'currency' ? d.amount : round2(amounts.amount)}
          onChange={(v) => patch({ amount: v, amountSource: 'currency' })}
          error={errors.amount}
          hint={d.amountSource === 'rub' && amounts.amount !== undefined ? 'досчитана из суммы в рублях' : undefined}
        />
        <div>
          <NumberField
            label="Курс" value={d.currency === 'RUB' ? 1 : isBadNumber(d.rate) ? d.rate : rate} disabled={d.currency === 'RUB'}
            onChange={(v) => patch({ rate: v, rateMode: 'manual' })} error={errors.rate}
          />
          <p className={`rate-note${note.warn ? ' rate-note--warn' : ''}`}>{note.text}</p>
          {d.currency !== 'RUB' && !rateIsAuto(d) ? (
            <button type="button" className="btn btn--small" onClick={() => patch({ rateMode: 'auto' })}>Подставить курс из истории</button>
          ) : null}
          {canSaveToHistory ? (
            <button type="button" className="btn btn--small" disabled={busy} onClick={() => void saveToHistory()}>Сохранить этот курс в историю</button>
          ) : null}
        </div>
        <NumberField
          label="Сумма в рублях"
          value={d.amountSource === 'rub' ? d.amountRub : round2(amounts.amountRub)}
          onChange={(v) => patch({ amountRub: v, amountSource: 'rub' })}
          hint={d.amountSource === 'currency' && amounts.amountRub !== undefined && d.currency !== 'RUB' ? `= сумма × ${formatRate(rate)}` : undefined}
        />
        <TextField label="Комментарий" value={d.comment} onChange={(v) => patch({ comment: v })} multiline className="ui-card__full" />
      </FormGrid>
      {d.targetType === 'shipment' || d.targetType === 'declaration' ? (
        <CostSplit saved={cost} draft={{ id: d.id, entryDate: d.entryDate, targetType: d.targetType, targetId: d.targetId, costType: d.costType }} rub={amounts.amountRub} />
      ) : null}

      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <span className="ui-card__spacer" />
        {cost ? <ConfirmDelete question="Удалить затрату?" onDelete={drop} disabled={busy} /> : null}
      </div>
    </form>
  );
}

// Полная форма позиции («Подробнее» у строки): все поля истории 11, свой AD с подсказкой и «как у поставщика», живой прогноз AB
// по действующему AD; ошибки у полей, введённое не теряется.

import { useState } from 'react';
import { suggestCoef } from '../../../domain/costing';
import { newId } from '../../../domain/ids';
import { lineFigures } from '../../../domain/lineFigures';
import type { Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { validateLine } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { CheckboxField, ConfirmDelete, ErrorBanner, FormGrid, NumberField, TextField, isBadNumber } from '../../components';
import { formatCoef, formatMoney } from '../../format';
import { compact, lineDeleteBlock, suggestionBasis, suggestionText } from './orderLogic';

type NumKey = 'qty' | 'unitPrice' | 'dutyRate' | 'cbm' | 'weight' | 'places' | 'coef';
const NUM_KEYS: NumKey[] = ['qty', 'unitPrice', 'dutyRate', 'cbm', 'weight', 'places', 'coef'];
type TextKey = 'customerName' | 'techParams' | 'docName' | 'supplierName' | 'hsCode' | 'packaging' | 'packageSize' | 'comment';

/** Числа — как отдаёт NumberField: пусто — undefined, не число — NaN. */
interface Draft { nums: Record<NumKey, number | undefined>; texts: Record<TextKey, string>; purchased: boolean }

const parseDraft = (d: Draft): { values: Partial<Record<NumKey, number | undefined>>; errors: Record<string, string> } => {
  const values: Partial<Record<NumKey, number | undefined>> = {};
  const errors: Record<string, string> = {};
  for (const k of NUM_KEYS) {
    const n = d.nums[k];
    if (isBadNumber(n)) errors[k] = 'Введите число';
    else values[k] = n;
  }
  return { values, errors };
};

export function LineForm({ order, so, line, nextSeq, rate, onClose }: {
  order: Order; so: SupplierOrder; line?: Line; nextSeq: number; rate: RatePick | null; onClose: () => void;
}) {
  const data = useData();
  const { ds, costing } = data;
  const [draft, setDraft] = useState<Draft>(() => ({
    nums: Object.fromEntries(NUM_KEYS.map((k) => [k, line?.[k]])) as Record<NumKey, number | undefined>,
    texts: {
      customerName: line?.customerName ?? '', techParams: line?.techParams ?? '', docName: line?.docName ?? '', supplierName: line?.supplierName ?? '',
      hsCode: line?.hsCode ?? '', packaging: line?.packaging ?? '', packageSize: line?.packageSize ?? '', comment: line?.comment ?? '',
    },
    purchased: line?.purchased ?? false,   // новая позиция — запрос цены, не в работе
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const num = (key: NumKey, label: string, extra?: { hint?: string }) => (
    <NumberField label={label} value={draft.nums[key]} error={errors[key]} hint={extra?.hint} onChange={(v) => setDraft((d) => ({ ...d, nums: { ...d.nums, [key]: v } }))} />
  );
  const text = (key: TextKey, label: string, multiline = false) => (
    <TextField label={label} multiline={multiline} value={draft.texts[key]} onChange={(v) => setDraft((d) => ({ ...d, texts: { ...d.texts, [key]: v } }))} />
  );

  const suggestion = suggestCoef(ds, costing, so.supplierId, so.plannedMode);
  const basis = suggestionBasis(suggestion);

  // живой прогноз по введённым числам
  const live = parseDraft(draft).values;
  const preview = (() => {
    if (typeof live.qty !== 'number' || typeof live.unitPrice !== 'number') return null;
    const f = lineFigures({ qty: live.qty, unitPrice: live.unitPrice, coef: live.coef } as Line, rate, so);
    if (f.Y === null) return 'Нет курса на дату расчёта — прогноз не посчитан';
    return `Y = ${formatMoney(f.Y)} ₽${f.AB === null ? '' : `, AB = ${formatMoney(f.AB)} ₽ за единицу`}`;
  })();

  const save = async () => {
    const { values, errors: parseErrors } = parseDraft(draft);
    const found = { ...validateLine({ ...values } as Partial<Line>), ...parseErrors };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const { nums: _n, ...rest } = draft; void _n;
      const record = compact<Line>({
        ...line,
        id: line?.id ?? newId('ln'), orderId: order.id, supplierOrderId: so.id, seq: line?.seq ?? nextSeq,
        ...rest.texts, ...values, purchased: draft.purchased,
      } as Line);
      await data.save('lines', record);
      onClose();
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  const enHint = data.store.kind === 'local' ? 'перевод появится в Google-таблице' : '';
  return (
    <form className="line-form" aria-label="Позиция" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h4 style={{ margin: '0 0 8px' }}>{line ? `Позиция ${order.number}-${so.seq}-${line.seq}` : 'Новая позиция'}</h4>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        {text('customerName', 'Название от заказчика')}
        {text('techParams', 'Тех. параметры', true)}
        {text('docName', 'Название в документах')}
        {text('supplierName', 'Название у поставщика (EN)')}
        <TextField label="Name EN (авто)" value={line?.customerNameEn ?? ''} onChange={() => undefined} disabled placeholder={enHint} />
        <TextField label="Tech EN (авто)" value={line?.techParamsEn ?? ''} onChange={() => undefined} disabled placeholder={enHint} />
        {num('qty', 'Кол-во')}
        {num('unitPrice', 'Цена в валюте')}
        <CheckboxField label="В работу" checked={draft.purchased} onChange={(c) => setDraft((d) => ({ ...d, purchased: c }))} />
        {text('hsCode', 'HS-код')}
        {num('dutyRate', 'Пошлина, %')}
        {text('packaging', 'Упаковка')}
        {text('packageSize', 'Размер упаковки')}
        {num('cbm', 'CBM')}
        {num('weight', 'Вес, кг')}
        {num('places', 'Мест')}
        <div>
          {num('coef', 'Коэффициент AD', {
            hint: so.coef === undefined ? 'свой AD позиции; у поставщика AD не задан' : `свой AD позиции; пусто — как у поставщика (${formatCoef(so.coef)})`,
          })}
          <div className="coef-hint muted">
            {draft.nums.coef !== undefined ? (
              <button type="button" className="btn btn--small" onClick={() => setDraft((d) => ({ ...d, nums: { ...d.nums, coef: undefined } }))}>
                как у поставщика
              </button>
            ) : null}
            {suggestion.value === null ? (
              suggestionText(suggestion)
            ) : (
              <button
                type="button" className="btn btn--small" title={`Медиана AW закрытых позиций ${basis}`}
                onClick={() => setDraft((d) => ({ ...d, nums: { ...d.nums, coef: suggestion.value ?? undefined } }))}
              >
                {suggestionText(suggestion)}
              </button>
            )}
          </div>
        </div>
        {text('comment', 'Комментарий', true)}
      </FormGrid>
      {!draft.purchased ? <p className="line-form__preview">Не в работе — позиция остаётся предложением поставщика: в себестоимость и поставки не попадает.</p> : null}
      {preview ? <p className="line-form__preview">{preview}</p> : null}
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить позицию</button>
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        {line ? (
          <>
            <span className="ui-card__spacer" />
            <ConfirmDelete
              label="Удалить позицию" blockReason={lineDeleteBlock(ds, line.id)}
              onDelete={async () => { await data.remove('lines', line.id); onClose(); }}
            />
          </>
        ) : null}
      </div>
    </form>
  );
}

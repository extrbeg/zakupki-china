// Полная форма позиции («Подробнее» у строки): все поля истории 11, свой расчётный коэффициент (AD) с подсказкой и «как у поставщика», живой прогноз AB
// по действующему коэффициенту; ошибки у полей, введённое не теряется.
// «Название от заказчика» подсказывается из прошлых позиций (история 93): выбор подставляет в пустые поля HS-код, пошлину, упаковку,
// название у поставщика, вес и CBM на единицу × кол-во; вес и CBM, подставленные так, пересчитываются при смене кол-ва, пока их не правили.
// Как и в строке быстрого ввода, то же делает точно набранное название прошлого товара; ручная правка названия снимает пересчёт по прежнему товару.

import { useRef, useState } from 'react';
import { suggestCoef } from '../../../domain/costing';
import { newId } from '../../../domain/ids';
import { lineFigures } from '../../../domain/lineFigures';
import { exactProductHint, productFill, type ProductHint } from '../../../domain/productHints';
import type { Line, Order, SupplierOrder } from '../../../domain/model';
import type { RatePick } from '../../../domain/rates';
import { validateLine } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { CheckboxField, ConfirmDelete, ErrorBanner, Field, FormGrid, NumberField, TextField, isBadNumber } from '../../components';
import { formatCoef, formatMoney } from '../../format';
import { AD_LABEL } from './coefLabels';
import { compact, lineDeleteBlock, suggestionBasis, suggestionText, supplierOrderCode } from './orderLogic';
import { ProductNameInput, fillNote, useProductHints } from './ProductNameInput';

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

  const hints = useProductHints(line?.id);
  /** Подсказка, из которой подставлены вес и CBM, и какие из них ещё не правили руками — их пересчитывает смена кол-ва. */
  const auto = useRef<{ hint: ProductHint; keys: Set<'weight' | 'cbm'> } | null>(null);

  const setNum = (key: NumKey, v: number | undefined) => setDraft((d) => {
    const nums = { ...d.nums, [key]: v };
    if (key === 'weight' || key === 'cbm') auto.current?.keys.delete(key);
    if (key === 'qty' && auto.current) {
      const fill = productFill(auto.current.hint, typeof v === 'number' && !Number.isNaN(v) ? v : undefined);
      for (const k of auto.current.keys) nums[k] = fill[k];
    }
    return { ...d, nums };
  });
  const num = (key: NumKey, label: string, extra?: { hint?: string }) => (
    <NumberField label={label} value={draft.nums[key]} error={errors[key]} hint={extra?.hint} onChange={(v) => setNum(key, v)} />
  );

  /** Выбор товара из подсказки (или точно набранное название — `typed`): подставляет только пустые поля. */
  const pickHint = (hint: ProductHint, typed?: string) => setDraft((d) => {
    const qty = typeof d.nums.qty === 'number' && !Number.isNaN(d.nums.qty) ? d.nums.qty : undefined;
    const fill = productFill(hint, qty);
    const texts = { ...d.texts, customerName: typed ?? hint.name };
    for (const k of ['hsCode', 'packaging', 'packageSize', 'supplierName'] as const) {
      if (!texts[k].trim() && fill[k] !== undefined) texts[k] = fill[k] as string;
    }
    const nums = { ...d.nums };
    if (nums.dutyRate === undefined && fill.dutyRate !== undefined) nums.dutyRate = fill.dutyRate;
    const keys = new Set<'weight' | 'cbm'>();
    if (nums.weight === undefined && hint.weightPerUnit !== undefined) { keys.add('weight'); nums.weight = fill.weight; }
    if (nums.cbm === undefined && hint.cbmPerUnit !== undefined) { keys.add('cbm'); nums.cbm = fill.cbm; }
    auto.current = keys.size ? { hint, keys } : null;
    return { ...d, texts, nums };
  });
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
    return `Цена ${formatMoney(f.Y)} ₽/шт${f.AB === null ? '' : `, прогноз ${formatMoney(f.AB)} ₽ за единицу`}`;
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
      <h4 style={{ margin: '0 0 8px' }}>{line ? `Позиция ${supplierOrderCode(order, so)}-${line.seq}` : 'Новая позиция'}</h4>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        <Field label="Название от заказчика" hint={fillNote(exactProductHint(hints, draft.texts.customerName)) || 'Начните вводить — подскажем товар из прошлых позиций'}>
          {({ id, describedBy }) => (
            <ProductNameInput
              id={id} aria-describedby={describedBy} hints={hints} value={draft.texts.customerName}
              onChange={(v) => {
                auto.current = null;   // название правят руками — вес и CBM больше не пересчитываются по прежнему товару
                const exact = exactProductHint(hints, v);
                if (exact) pickHint(exact, v);
                else setDraft((d) => ({ ...d, texts: { ...d.texts, customerName: v } }));
              }}
              onPickHint={pickHint}
            />
          )}
        </Field>
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
          {num('coef', AD_LABEL, {
            hint: so.coef === undefined ? 'свой у позиции; у поставщика не задан' : `свой у позиции; пусто — как у поставщика (${formatCoef(so.coef)})`,
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
                type="button" className="btn btn--small" title={`Медиана фактических коэффициентов (AW) закрытых позиций ${basis}`}
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

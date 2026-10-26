// Карточка ручного курса: добавить новый или поправить существующий ручной.
// Ручной курс на ту же дату и валюту один: добавление поверх существующего обновляет его.

import { useState } from 'react';
import type { ISODate, Rate } from '../../../domain/model';
import { newId } from '../../../domain/ids';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, ErrorBanner, FormGrid, NumberField, SelectField, TextField } from '../../components';
import { CURRENCY_LABEL, FOREIGN_CURRENCIES } from '../../format';
import { manualRateOn } from './rateTable';

type Foreign = Rate['currency'];
type Errors = Partial<Record<'date' | 'rate', string>>;

export function RateForm({ rate, initial, onClose }: { rate?: Rate; initial?: { date?: ISODate; currency?: Foreign }; onClose: () => void }) {
  const { ds, today, save, remove } = useData();
  const [date, setDate] = useState<ISODate | undefined>(rate?.date ?? initial?.date ?? today);
  const [currency, setCurrency] = useState<Foreign>(rate?.currency ?? initial?.currency ?? 'CNY');
  const [value, setValue] = useState<number | undefined>(rate?.rate);
  const [comment, setComment] = useState(rate?.comment ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const submit = async () => {
    const e: Errors = {};
    if (!date) e.date = 'Укажите дату';
    if (value === undefined || !(value > 0)) e.rate = 'Введите курс больше нуля';
    setErrors(e);
    if (Object.keys(e).length > 0 || !date || value === undefined) return;
    const existing = rate ?? manualRateOn(ds.rates, date, currency);
    const record: Rate = {
      id: existing?.id ?? newId('r'),
      date, currency, rate: value, source: 'manual',
      loadedAt: new Date().toISOString(),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    setBusy(true);
    setFailure(null);
    try {
      await save('rates', record);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const drop = async () => {
    if (!rate) return;
    setBusy(true);
    try {
      await remove('rates', rate.id);
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ui-card" onSubmit={(ev) => { ev.preventDefault(); void submit(); }} aria-label={rate ? 'Ручной курс' : 'Новый курс'}>
      <h2 className="ui-card__title">{rate ? 'Ручной курс' : 'Добавить курс'}</h2>
      {failure ? <ErrorBanner error={failure} /> : null}
      <FormGrid>
        <DateField label="Дата" value={date} onChange={setDate} error={errors.date} required />
        <SelectField
          label="Валюта" value={currency} onChange={(v) => setCurrency((v as Foreign | undefined) ?? 'CNY')}
          options={FOREIGN_CURRENCIES.map((c) => ({ value: c, label: CURRENCY_LABEL[c] }))}
        />
        <NumberField label="Курс, ₽" value={value} onChange={setValue} error={errors.rate} required />
        <TextField label="Комментарий" value={comment} onChange={setComment} className="ui-card__full" />
      </FormGrid>
      <p className="rate-note">Ручной курс на дату важнее курса ВТБ на ту же дату.</p>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <span className="ui-card__spacer" />
        {rate ? <ConfirmDelete question="Удалить ручной курс?" onDelete={drop} disabled={busy} /> : null}
      </div>
    </form>
  );
}

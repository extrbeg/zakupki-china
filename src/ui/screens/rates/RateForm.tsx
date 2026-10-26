// Карточка правки существующего ручного курса (новые курсы вводятся формой «Курсы на дату»).
// Ручной курс на (дату, валюту) один: перенос правкой на дату/валюту, где ручной уже есть, — только после подтверждения.

import { useState } from 'react';
import type { ISODate, Rate } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, DateField, ErrorBanner, FormGrid, NumberField, SelectField, TextField } from '../../components';
import { CURRENCY_LABEL, FOREIGN_CURRENCIES, formatRate, ruDate } from '../../format';
import { manualRateOn } from './rateTable';

type Foreign = Rate['currency'];
type Errors = Partial<Record<'date' | 'rate', string>>;

export function RateForm({ rate, onClose }: { rate: Rate; onClose: () => void }) {
  const { ds, save, remove } = useData();
  const [date, setDate] = useState<ISODate | undefined>(rate.date);
  const [currency, setCurrency] = useState<Foreign>(rate.currency);
  const [value, setValue] = useState<number | undefined>(rate.rate);
  const [comment, setComment] = useState(rate.comment ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [clash, setClash] = useState<Rate | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const write = async (day: ISODate, other: Rate | undefined) => {
    if (value === undefined) return;
    const record: Rate = {
      id: rate.id, date: day, currency, rate: value, source: 'manual',
      loadedAt: new Date().toISOString(),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };
    setBusy(true);
    setFailure(null);
    try {
      if (other) {
        // Занятое место обновляем, правимую строку убираем: остаётся одна запись на (дата, валюта).
        await save('rates', { ...record, id: other.id });
        await remove('rates', rate.id);
      } else {
        await save('rates', record);
      }
      onClose();
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const e: Errors = {};
    if (!date) e.date = 'Укажите дату';
    if (value === undefined || !(value > 0)) e.rate = 'Введите курс больше нуля';
    setErrors(e);
    if (Object.keys(e).length > 0 || !date || value === undefined) return;
    const other = manualRateOn(ds.rates, date, currency);
    if (other && other.id !== rate.id) { setClash(other); return; }
    await write(date, undefined);
  };

  const drop = async () => {
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

  const editing = () => setClash(null);

  return (
    <form className="ui-card" onSubmit={(ev) => { ev.preventDefault(); if (!clash) void submit(); }} aria-label="Ручной курс">
      <h2 className="ui-card__title">Ручной курс</h2>
      {failure ? <ErrorBanner error={failure} /> : null}
      <FormGrid>
        <DateField label="Дата" value={date} onChange={(v) => { editing(); setDate(v); }} error={errors.date} required />
        <SelectField
          label="Валюта" value={currency} onChange={(v) => { editing(); setCurrency((v as Foreign | undefined) ?? 'CNY'); }}
          options={FOREIGN_CURRENCIES.map((c) => ({ value: c, label: CURRENCY_LABEL[c] }))}
        />
        <NumberField label="Курс, ₽" value={value} onChange={(v) => { editing(); setValue(v); }} error={errors.rate} required />
        <TextField label="Комментарий" value={comment} onChange={setComment} className="ui-card__full" />
      </FormGrid>
      <p className="rate-note">Ручной курс на дату важнее курса ВТБ на ту же дату.</p>
      {clash && date ? (
        <div className="banner banner--warning" role="alert">
          <span>{`На ${ruDate(date)} уже есть курс ${CURRENCY_LABEL[currency]} ${formatRate(clash.rate)} — перезаписать?`}</span>{' '}
          <span className="muted">новый курс {formatRate(value)}</span>
        </div>
      ) : null}
      <div className="ui-card__actions">
        {clash && date ? (
          <>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void write(date, clash)}>Перезаписать</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setClash(null)}>Не перезаписывать</button>
          </>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        )}
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <span className="ui-card__spacer" />
        <ConfirmDelete question="Удалить ручной курс?" onDelete={drop} disabled={busy} />
      </div>
    </form>
  );
}

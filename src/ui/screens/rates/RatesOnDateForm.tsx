// Форма «Курсы на дату»: дата + USD, EUR, юань за один раз. Дата после сохранения остаётся введённой,
// пустое поле ничего не удаляет, перезапись ручного курса с другим значением — только после подтверждения.

import { useState } from 'react';
import type { ISODate, Rate } from '../../../domain/model';
import { newId } from '../../../domain/ids';
import { useData } from '../../DataContext';
import { DateField, ErrorBanner, FormGrid, NumberField, isBadNumber } from '../../components';
import { CURRENCY_LABEL, FOREIGN_CURRENCIES, formatRate, ruDate } from '../../format';
import { manualRateOn } from './rateTable';

type Foreign = Rate['currency'];
type Values = Record<Foreign, number | undefined>;
type Errors = Partial<Record<'date' | Foreign, string>>;
interface Change { currency: Foreign; value: number; existing?: Rate }

/** Ручные курсы на дату — стартовые значения полей. */
function valuesOn(rates: Rate[], date: ISODate | undefined): Values {
  const out: Values = { USD: undefined, EUR: undefined, CNY: undefined };
  if (!date) return out;
  for (const c of FOREIGN_CURRENCIES) out[c] = manualRateOn(rates, date, c)?.rate;
  return out;
}

export function RatesOnDateForm({ initialDate, onClose }: { initialDate?: ISODate; onClose: () => void }) {
  const { ds, today, save } = useData();
  const [date, setDate] = useState<ISODate | undefined>(initialDate ?? today);
  const [values, setValues] = useState<Values>(() => valuesOn(ds.rates, initialDate ?? today));
  const [errors, setErrors] = useState<Errors>({});
  const [confirm, setConfirm] = useState<Change[] | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const touched = () => { setConfirm(null); setNotice(''); setErrors({}); };

  const changeDate = (d: ISODate | undefined) => {
    touched();
    setDate(d);
    setValues(valuesOn(ds.rates, d));
  };
  const changeValue = (c: Foreign, v: number | undefined) => {
    touched();
    setValues((prev) => ({ ...prev, [c]: v }));
  };

  const write = async (day: ISODate, changes: Change[]) => {
    setBusy(true);
    setFailure(null);
    try {
      for (const ch of changes) {
        const record: Rate = {
          ...(ch.existing ?? {}),
          id: ch.existing?.id ?? newId('r'),
          date: day, currency: ch.currency, rate: ch.value, source: 'manual',
          loadedAt: new Date().toISOString(),
        };
        await save('rates', record);
      }
      setConfirm(null);
      setNotice(`Сохранено на ${ruDate(day)}: ${changes.map((c) => CURRENCY_LABEL[c.currency]).join(', ')}`);
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setNotice('');
    const e: Errors = {};
    if (!date) e.date = 'Укажите дату';
    for (const c of FOREIGN_CURRENCIES) {
      const v = values[c];
      if (isBadNumber(v)) e[c] = 'Введите число';
      else if (v !== undefined && !(v > 0)) e[c] = 'Введите курс больше нуля';
    }
    setErrors(e);
    if (Object.keys(e).length > 0 || !date) return;

    const filled = FOREIGN_CURRENCIES.filter((c) => values[c] !== undefined);
    if (filled.length === 0) { setNotice('Введите курс хотя бы одной валюты'); return; }
    // Только новые и изменённые: то же значение, что уже записано, не пишется и не спрашивается.
    const changes: Change[] = [];
    for (const c of filled) {
      const existing = manualRateOn(ds.rates, date, c);
      if (existing && existing.rate === values[c]) continue;
      changes.push({ currency: c, value: values[c] as number, existing });
    }
    if (changes.length === 0) { setNotice('Эти курсы уже сохранены'); return; }
    if (changes.some((ch) => ch.existing)) { setConfirm(changes); return; }
    await write(date, changes);
  };

  const overwrites = confirm?.filter((ch) => ch.existing) ?? [];

  return (
    <form className="ui-card" onSubmit={(ev) => { ev.preventDefault(); if (!confirm) void submit(); }} aria-label="Курсы на дату">
      <h2 className="ui-card__title">Курсы на дату</h2>
      {failure ? <ErrorBanner error={failure} /> : null}
      <FormGrid>
        <DateField label="Дата" value={date} onChange={changeDate} error={errors.date} required />
        {FOREIGN_CURRENCIES.map((c) => (
          <NumberField
            key={c} label={CURRENCY_LABEL[c]} value={values[c]} onChange={(v) => changeValue(c, v)}
            error={errors[c]} hint="рублей за единицу"
          />
        ))}
      </FormGrid>
      <p className="rate-note">Пустое поле курс не удаляет. Ручной курс на дату важнее курса ВТБ на ту же дату.</p>
      {notice ? <p className="rate-note" role="status">{notice}</p> : null}
      {confirm && date ? (
        <div className="banner banner--warning" role="alert">
          <ul className="rate-confirm">
            {overwrites.map((ch) => (
              <li key={ch.currency}>
                <span>{`На ${ruDate(date)} уже есть курс ${CURRENCY_LABEL[ch.currency]} ${formatRate(ch.existing?.rate)} — перезаписать?`}</span>{' '}
                <span className="muted">новый курс {formatRate(ch.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="ui-card__actions">
        {confirm && date ? (
          <>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void write(date, confirm)}>Перезаписать</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(null)}>Не перезаписывать</button>
          </>
        ) : (
          <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        )}
        <button type="button" className="btn" onClick={onClose}>Закрыть</button>
      </div>
    </form>
  );
}

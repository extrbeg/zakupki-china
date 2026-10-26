// Экран «Настройки» (маршрут /settings): раздел «Google-таблица» (всегда; GoogleSheetSection),
// параметры листа «Настройки» (портал Битрикс24, ставка НДС по умолчанию, источник курсов), выход.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSession } from '../../DataContext';
import { ErrorBanner, FormGrid, NumberField, TextField, isBadNumber } from '../../components';
import { signOut } from '../../../google/auth';
import { GoogleSheetSection } from './GoogleSheetSection';
import { ruDate } from '../../format';

interface Form { bitrixPortalUrl: string; vatRateDefault: number | undefined; ratesSourceUrl: string }
type Errors = Partial<Record<keyof Form, string>>;

// Отметка «Сохранено» переживает перезагрузку данных (экран на это время размонтируется).
let savedFlash = false;

function toForm(settings: Record<string, string>): Form {
  const vat = settings.vatRateDefault?.trim().replace(',', '.');
  const n = vat ? Number(vat) : NaN;
  return {
    bitrixPortalUrl: settings.bitrixPortalUrl ?? '',
    vatRateDefault: Number.isFinite(n) ? n : undefined,
    ratesSourceUrl: settings.ratesSourceUrl ?? '',
  };
}

function validate(f: Form): Errors {
  const e: Errors = {};
  const url = (v: string) => v.trim() === '' || /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(v.trim());
  if (!url(f.bitrixPortalUrl)) e.bitrixPortalUrl = 'Адрес вида https://портал.bitrix24.ru';
  if (f.vatRateDefault === undefined) e.vatRateDefault = 'Укажите ставку НДС';
  else if (isBadNumber(f.vatRateDefault)) e.vatRateDefault = 'Введите число';
  else if (f.vatRateDefault < 0 || f.vatRateDefault > 100) e.vatRateDefault = 'От 0 до 100 %';
  if (!url(f.ratesSourceUrl)) e.ratesSourceUrl = 'Адрес вида https://…';
  return e;
}


export default function SettingsScreen() {
  const { ds, store, reload } = useData();
  const { session, endSession } = useSession();
  const [form, setForm] = useState<Form>(() => toForm(ds.settings));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(() => { const v = savedFlash; savedFlash = false; return v; });

  // Данные пришли или перечитаны — показать их, пока пользователь ничего не правил.
  useEffect(() => {
    if (!dirty) setForm(toForm(ds.settings));
  }, [ds.settings, dirty]);

  const lastAutoRate = useMemo(
    () => ds.rates.filter((r) => r.source === 'vtb').reduce<string | null>((m, r) => (m === null || r.date > m ? r.date : m), null),
    [ds.rates],
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    const e = validate(form);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const next: Record<string, string> = {
      bitrixPortalUrl: form.bitrixPortalUrl.trim().replace(/\/+$/, ''),
      vatRateDefault: String(form.vatRateDefault),
      ratesSourceUrl: form.ratesSourceUrl.trim(),
    };
    setSaving(true);
    setSaveError(null);
    try {
      for (const [k, v] of Object.entries(next)) {
        if ((ds.settings[k] ?? '') !== v) await store.setSetting(k, v);
      }
      savedFlash = true;
      setSaved(true);
      await reload();
      setDirty(false);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    signOut();
    endSession();
  };

  return (
    <section className="screen">
      <h1 className="screen__title">Настройки</h1>
      <p><Link to="/changelog">Что нового</Link></p>

      <GoogleSheetSection />

      <section aria-labelledby="settings-params">
        <h2 id="settings-params">Параметры</h2>
        {saveError ? <ErrorBanner error={saveError} onRetry={() => void save()} /> : null}
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <FormGrid>
            <TextField
              label="Адрес портала Битрикс24" type="url" value={form.bitrixPortalUrl} placeholder="https://company.bitrix24.ru"
              hint="Тогда ID задачи в заказе станет ссылкой на задачу" error={errors.bitrixPortalUrl}
              onChange={(v) => set('bitrixPortalUrl', v)}
            />
            <NumberField
              label="Ставка НДС по умолчанию, %" value={form.vatRateDefault} required error={errors.vatRateDefault}
              hint="Подставляется в новые поставки" onChange={(v) => set('vatRateDefault', v)}
            />
            <TextField
              label="Адрес источника курсов" type="url" value={form.ratesSourceUrl} error={errors.ratesSourceUrl}
              hint="Страница, с которой скрипт таблицы берёт курсы ВТБ; пусто — страница обмена валют ВТБ" onChange={(v) => set('ratesSourceUrl', v)}
            />
          </FormGrid>
          <p>
            <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
            {saved ? <span className="muted" role="status"> Сохранено</span> : null}
          </p>
        </form>
        <p className="muted small">
          {lastAutoRate ? `Последний автокурс ВТБ: ${ruDate(lastAutoRate)}` : 'Автокурсов ВТБ ещё нет — включите ежедневные курсы в меню таблицы «Закупки».'}
        </p>
      </section>

      <section aria-labelledby="settings-account">
        <h2 id="settings-account">Аккаунт</h2>
        {session.mode === 'sheets' ? (
          <p>
            Вы вошли как <strong>{session.email}</strong>.{' '}
            <button type="button" className="btn" onClick={logout}>Выйти</button>
          </p>
        ) : (
          <p>
            Демо-режим: данные только в этом браузере.{' '}
            <button type="button" className="btn" onClick={endSession}>Выйти из демо</button>
          </p>
        )}
      </section>
    </section>
  );
}

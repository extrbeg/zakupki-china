// Экран «Импорт из старой таблицы» (маршрут /import): выбор таблицы в Picker (или по ссылке — окно сразу с этим файлом) →
// предпросмотр количества и проблем →
// перенос в подключённую таблицу. В непустую таблицу — только с явным «Добавить к существующим данным».

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData, useSession } from '../../DataContext';
import { CheckboxField, EmptyState, ErrorBanner } from '../../components';
import { applyImport, hasUserData, LEGACY_SHEETS, mapLegacy, readLegacy, type ImportPlan, type ImportResult, type LegacyRaw } from '../../../import';
import { pickSpreadsheet, type PickOptions } from '../../../google/picker';
import { SheetLinkField } from '../connect/SheetLinkField';
import { AuthError, GoogleApiError } from '../../../google/errors';
import { googleSheetsApi } from '../../../setup/connect';
import { StoreError, STORE_ERROR_TEXT } from '../../../store/types';
import './import.css';

export interface ImportDeps {
  /** Выбор таблицы (Picker); с fileId — окно с этим файлом. Отмена — null. */
  pick(options?: PickOptions): Promise<{ id: string; name: string } | null>;
  /** Чтение видимых листов старой таблицы. */
  read(spreadsheetId: string): Promise<LegacyRaw>;
  /** Подключённая таблица — из неё импортировать нельзя. */
  currentSpreadsheetId?: string;
}

const STAT_LABEL: [key: string, label: string][] = [
  ['orders', 'Заказы'], ['supplierOrders', 'Поставщики в заказах'], ['lines', 'Позиции'], ['suppliers', 'Поставщики'],
  ['costs', 'Затраты'], ['rates', 'Курсы'], ['cities', 'Города'], ['lists', 'Значения списков'],
  ['agents', 'Платёжные агенты'], ['carriers', 'Перевозчики'], ['shipments', 'Поставки'], ['batches', 'Партии'],
];

function errorText(e: unknown): string {
  if (e instanceof StoreError) return STORE_ERROR_TEXT[e.kind];
  if (e instanceof AuthError) return 'Нужно войти в Google заново';
  if (e instanceof GoogleApiError) {
    if (e.status === 403 || e.status === 404) return 'Нет доступа к выбранной таблице — выберите её ещё раз в окне выбора файла';
    if (e.status === 0) return STORE_ERROR_TEXT.network;
    return 'Не удалось прочитать таблицу — попробуйте ещё раз';
  }
  if (e instanceof Error && /[а-яё]/i.test(e.message)) return e.message;
  return 'Не удалось прочитать таблицу — проверьте связь и попробуйте ещё раз';
}

type Step =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'preview'; name: string; plan: ImportPlan }
  | { kind: 'importing'; name: string; plan: ImportPlan }
  | { kind: 'done'; name: string; result: ImportResult };

function StatsTable({ counts, caption }: { counts: Record<string, number>; caption: string }) {
  return (
    <div className="table-scroll import-stats">
      <table className="table" aria-label={caption}>
        <thead><tr><th>Что</th><th className="num">Записей</th></tr></thead>
        <tbody>
          {STAT_LABEL.filter(([k]) => counts[k] !== undefined).map(([k, label]) => (
            <tr key={k}><td>{label}</td><td className="num">{counts[k]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProblemsTable({ problems, caption }: { problems: ImportPlan['problems']; caption: string }) {
  return (
    <div className="table-scroll import-problems">
      <table className="table" aria-label={caption}>
        <thead><tr><th>Лист</th><th className="num">Строка</th><th>Что не так</th></tr></thead>
        <tbody>
          {problems.map((p, i) => (
            <tr key={i}><td>{p.sheet}</td><td className="num">{p.row || '—'}</td><td className="import-problems__msg">{p.message}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Сам сценарий импорта; зависимости Google подменяются в тестах. */
export function ImportFlow({ deps }: { deps: ImportDeps }) {
  const { ds, store, today, reload, status } = useData();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [append, setAppend] = useState(false);
  const nonEmpty = hasUserData(ds);
  const busy = step.kind === 'reading' || step.kind === 'importing';

  const choose = async (fileId?: string) => {
    setError(null);
    setAppend(false);
    let picked: { id: string; name: string } | null;
    try {
      picked = await (fileId ? deps.pick({ fileId }) : deps.pick());
    } catch (e) {
      setError(errorText(e));
      return;
    }
    if (!picked) return;
    if (picked.id === deps.currentSpreadsheetId) {
      setError('Это подключённая таблица приложения — выберите старую таблицу «Закупки Китай AREC»');
      return;
    }
    setStep({ kind: 'reading', name: picked.name });
    try {
      const raw = await deps.read(picked.id);
      setStep({ kind: 'preview', name: picked.name, plan: mapLegacy(raw, today) });
    } catch (e) {
      setError(errorText(e));
      setStep({ kind: 'idle' });
    }
  };

  const run = async () => {
    if (step.kind !== 'preview') return;
    if (nonEmpty && !append) return;
    const { name, plan } = step;
    setError(null);
    setStep({ kind: 'importing', name, plan });
    try {
      const result = await applyImport(plan, store);
      setStep({ kind: 'done', name, result });
      await reload();
    } catch (e) {
      setError(`Импорт прерван: ${errorText(e)}. Часть записей могла уже записаться — проверьте таблицу перед повтором.`);
      setStep({ kind: 'preview', name, plan });
    }
  };

  const plan = step.kind === 'preview' || step.kind === 'importing' ? step.plan : null;
  const total = (counts: Record<string, number>) => Object.values(counts).reduce((s, v) => s + v, 0);

  return (
    <section className="screen import">
      <h1 className="screen__title">Импорт из старой таблицы</h1>
      <p className="import__intro">
        Перенесёт заказы, позиции, затраты, поставщиков, платёжных агентов, перевозчиков, списки, города и курсы
        из старой таблицы «Закупки Китай AREC» в подключённую таблицу. Читаются только видимые листы:
        {' '}{LEGACY_SHEETS.map((s) => `«${s}»`).join(', ')}. Старая таблица не меняется.
      </p>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="ui-toolbar import__actions">
        <button type="button" className={`btn${step.kind === 'idle' ? ' btn--primary' : ''}`} onClick={() => void choose()} disabled={busy || status === 'loading'}>
          Выбрать старую таблицу
        </button>
        <SheetLinkField
          label="Ссылка на старую таблицу" button="Открыть по ссылке" disabled={busy || status === 'loading'}
          hint="Или вставьте ссылку на старую таблицу — откроется окно Google с ней, нажмите «Выбрать»"
          onSubmit={(fileId) => void choose(fileId)}
        />
      </div>

      {step.kind === 'reading' ? <p className="muted">Читаю таблицу «{step.name}»…</p> : null}

      {plan ? (
        <div className="import__preview">
          <h2 className="import__h2">Предпросмотр: «{step.kind === 'preview' || step.kind === 'importing' ? step.name : ''}»</h2>
          <StatsTable counts={plan.stats} caption="Что будет перенесено" />

          <h3 className="import__h3">Проблемы данных ({plan.problems.length})</h3>
          {plan.problems.length > 0 ? (
            <>
              <p className="muted small">Строки без номера заказа не переносятся; поставщики, которых нет в справочнике, создаются по имени. Остальное переносится как есть — поправьте после импорта.</p>
              <ProblemsTable problems={plan.problems} caption="Проблемы данных" />
            </>
          ) : <p className="muted">Проблем не найдено.</p>}

          {nonEmpty ? (
            <div className="banner banner--warning import__warning" role="status">
              <div>
                <strong>В таблице уже есть данные</strong>
                <p className="small">Импорт добавит записи к существующим. Повторов не будет: заказы с уже занятыми номерами пропускаются целиком,
                  а совпадающие поставщики, списки, города и курсы не дублируются.</p>
                <CheckboxField label="Добавить к существующим данным" checked={append} onChange={setAppend} disabled={busy} />
              </div>
            </div>
          ) : null}

          <div className="ui-toolbar import__actions">
            <button type="button" className="btn btn--primary" onClick={run} disabled={busy || (nonEmpty && !append) || total(plan.stats) === 0}>
              {nonEmpty ? 'Добавить' : 'Импортировать'}
            </button>
            {step.kind === 'importing' ? <span className="muted">Переношу данные…</span> : null}
          </div>
        </div>
      ) : null}

      {step.kind === 'done' ? (
        <div className="import__done" role="status">
          <h2 className="import__h2">Перенесено из «{step.name}»</h2>
          <StatsTable counts={step.result.inserted} caption="Перенесено" />
          {step.result.skipped.length > 0 ? (
            <>
              <h3 className="import__h3">Пропущено ({step.result.skipped.length})</h3>
              <ProblemsTable problems={step.result.skipped} caption="Пропущено" />
            </>
          ) : null}
          <div className="ui-toolbar import__actions">
            <Link className="btn btn--primary" to="/">К заказам</Link>
            <Link className="btn" to="/costing">Себестоимость</Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function ImportScreen() {
  const { session } = useSession();
  const spreadsheetId = session.mode === 'sheets' ? session.spreadsheetId : undefined;
  const deps = useMemo<ImportDeps>(() => ({
    pick: pickSpreadsheet,
    read: (id) => readLegacy(googleSheetsApi(), id),
    currentSpreadsheetId: spreadsheetId,
  }), [spreadsheetId]);

  if (session.mode !== 'sheets') {
    return (
      <section className="screen import">
        <h1 className="screen__title">Импорт из старой таблицы</h1>
        <EmptyState
          title="Нужна подключённая таблица Google"
          text="Импорт переносит данные старой таблицы в вашу таблицу Google. Войдите через Google и подключите таблицу — в демо-режиме переносить некуда."
        />
      </section>
    );
  }
  return <ImportFlow deps={deps} />;
}

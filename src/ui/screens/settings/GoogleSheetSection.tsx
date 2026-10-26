// Раздел «Google-таблица» в настройках (G14, G15; истории 81, 82) — виден всегда.
// Подключена таблица: название, «Открыть таблицу», «Сменить таблицу», «Ваши таблицы приложения» (касание — привязка без окна
// Google, G19), поле «Ссылка на таблицу» (есть доступ — привязка сразу; нет — окно Google с этим файлом → «Выбрать»; привязка
// с теми же проверками, что на экране подключения), «Импорт из старой таблицы», переустановка скрипта.
// После привязки другой таблицы — шаг «Разделитель аргументов в формулах» (G27), выбор пишется в её «Настройки» при «Начать работу».
// Окно Google, закрывшееся без ответа, не держит поле в ожидании: подсказка, поле снова активно, поздний ответ принимается.
// Демо: пояснение, где настроить вход (docs/setup.md), и «Войти и подключить», если Google настроен.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { AuthError } from '../../../google/errors';
import { pickSpreadsheet, type PickOptions } from '../../../google/picker';
import type { AppSpreadsheet } from '../../../google/driveApi';
import { SheetsStore } from '../../../store/sheetsStore';
import { StoreError } from '../../../store/types';
import { bindSpreadsheet, googleSheetsApi, openLinkedSpreadsheet, spreadsheetUrl } from '../../../setup/connect';
import { installScript, type ScriptInstallResult } from '../../../setup/installScript';
import { applyFormulaSeparator } from '../../../setup/formulaSeparator';
import type { FormulaSeparator } from '../../../store/schema';
import { FormulaSeparatorChoice } from '../connect/FormulaSeparatorChoice';
import { AppSpreadsheetList, PICKER_STALL_TEXT } from '../connect/AppSpreadsheetList';
import { ScriptStatus } from '../connect/ScriptStatus';
import { SheetLinkField } from '../connect/SheetLinkField';
import { setupDocsUrl } from './settingsLogic';

type LinkPhase =
  | { k: 'idle' }
  | { k: 'busy'; text: string }
  | { k: 'same' }
  | { k: 'done'; spreadsheetId: string; name: string; script: ScriptInstallResult; localeSep: FormulaSeparator; sep: FormulaSeparator };

function failureText(e: unknown): string | undefined {
  if (e instanceof AuthError) return `Вход не выполнен: ${e.message}`;
  if (e instanceof StoreError) return undefined;   // ErrorBanner возьмёт текст по виду ошибки
  return e instanceof Error ? e.message : undefined;
}

export function GoogleSheetSection() {
  const { session } = useSession();
  return (
    <section aria-labelledby="settings-table">
      <h2 id="settings-table">Google-таблица</h2>
      {session.mode === 'sheets'
        ? <Connected key={session.spreadsheetId} email={session.email} spreadsheetId={session.spreadsheetId} />
        : <NotConnected />}
    </section>
  );
}

function NotConnected() {
  const { googleConfigured } = useSession();
  const docs = typeof window === 'undefined' ? null : setupDocsUrl(window.location);
  return (
    <>
      <p>
        Сейчас демо-режим: данные хранятся только в этом браузере. Подключение появится после входа через Google;
        как настроить — {docs ? <a href={docs} target="_blank" rel="noopener noreferrer">docs/setup.md</a> : <><code>docs/setup.md</code> в репозитории приложения</>}.
      </p>
      {googleConfigured ? <p><Link className="btn btn--primary" to="/connect">Войти и подключить</Link></p> : null}
    </>
  );
}

function Connected({ email, spreadsheetId }: { email: string; spreadsheetId: string }) {
  const { startSheets } = useSession();
  const [title, setTitle] = useState<string | null>(null);
  const [phase, setPhase] = useState<LinkPhase>({ k: 'idle' });
  const [failure, setFailure] = useState<{ error: unknown; retry: () => void } | null>(null);
  const [script, setScript] = useState<ScriptInstallResult | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [stalled, setStalled] = useState(false);
  const op = useRef(0);
  const url = spreadsheetUrl(spreadsheetId);

  useEffect(() => {
    let live = true;
    googleSheetsApi().getMeta(spreadsheetId)
      .then((m) => { if (live) setTitle(m.title); })
      .catch(() => { /* название не обязательно — остаётся ссылка «Открыть таблицу» */ });
    return () => { live = false; };
  }, [spreadsheetId]);

  /** Получить таблицу (по ссылке или из списка) и привязать. Поздний ответ окна Google не перебивает начатое после него действие. */
  const connect = (text: string, obtain: (pick: Pick<PickOptions, 'onStall'>) => Promise<{ id: string; name: string } | null>) => {
    const attempt = async () => {
      const mine = ++op.current;
      const isCurrent = () => op.current === mine;
      setFailure(null);
      setStalled(false);
      setPhase({ k: 'busy', text });
      try {
        const picked = await obtain({ onStall: () => { if (isCurrent()) { setPhase({ k: 'idle' }); setStalled(true); } } });
        if (!isCurrent()) return;
        setStalled(false);
        if (!picked) { setPhase({ k: 'idle' }); return; }
        if (picked.id === spreadsheetId) { setPhase({ k: 'same' }); return; }
        setPhase({ k: 'busy', text: `Настраиваю таблицу «${picked.name}»…` });
        const res = await bindSpreadsheet(googleSheetsApi(), email, picked.id);
        const localeSep = res.formulaSeparator.locale;
        setPhase({ k: 'done', spreadsheetId: res.spreadsheetId, name: picked.name, script: res.script, localeSep, sep: localeSep });
      } catch (e) {
        if (!isCurrent()) return;
        setPhase({ k: 'idle' });
        setFailure({ error: e, retry: () => void attempt() });
      }
    };
    void attempt();
  };

  const markSame = () => {
    op.current += 1;
    setFailure(null);
    setStalled(false);
    setPhase({ k: 'same' });
  };

  const connectByLink = (fileId: string) => {
    if (fileId === spreadsheetId) { markSame(); return; }
    connect('Открываю таблицу…', (pick) => openLinkedSpreadsheet(fileId, { getMeta: (id) => googleSheetsApi().getMeta(id), pick: pickSpreadsheet }, pick));
  };

  const connectFromList = (file: AppSpreadsheet) => {
    if (file.id === spreadsheetId) { markSame(); return; }
    connect(`Настраиваю таблицу «${file.name}»…`, async () => file);
  };

  const open = (id: string) => startSheets(new SheetsStore(googleSheetsApi(), id), { email, spreadsheetId: id });

  /** «Начать работу»: выбранный разделитель — в «Настройки» новой таблицы, затем работа с ней. Сбой — баннер с повтором. */
  const [startError, setStartError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const start = async (p: Extract<LinkPhase, { k: 'done' }>) => {
    setStarting(true);
    setStartError(null);
    try {
      await applyFormulaSeparator(googleSheetsApi(), p.spreadsheetId, p.sep);
      open(p.spreadsheetId);
    } catch (e) {
      setStartError(e);
    } finally {
      setStarting(false);
    }
  };

  const retryNewScript = async (p: Extract<LinkPhase, { k: 'done' }>) => {
    setScriptBusy(true);
    try {
      setPhase({ ...p, script: await installScript(googleSheetsApi(), p.spreadsheetId) });
    } finally {
      setScriptBusy(false);
    }
  };

  const reinstall = async () => {
    setScriptBusy(true);
    try {
      setScript(await installScript(googleSheetsApi(), spreadsheetId));
    } finally {
      setScriptBusy(false);
    }
  };

  const busy = phase.k === 'busy';
  return (
    <>
      <p>
        Подключена таблица {title ? <strong>{title}</strong> : null}
        <span className="muted small"> (аккаунт {email})</span>
      </p>
      <p>
        <a className="btn" href={url} target="_blank" rel="noopener noreferrer">Открыть таблицу</a>{' '}
        <Link className="btn" to="/connect">Сменить таблицу</Link>{' '}
        <Link className="btn" to="/import">Импорт из старой таблицы</Link>{' '}
        <button type="button" className="btn" onClick={() => void reinstall()} disabled={scriptBusy}>
          {scriptBusy && phase.k !== 'done' ? 'Устанавливаю скрипт…' : 'Переустановить скрипт'}
        </button>
      </p>
      {script ? (
        <>
          {script.ok ? <p role="status">Скрипт таблицы обновлён.</p> : null}
          <ScriptStatus result={script} spreadsheetUrl={url} busy={scriptBusy} onRetry={() => void reinstall()} />
        </>
      ) : null}

      {phase.k === 'done' ? (
        <div className="ui-card">
          <p><strong>Таблица «{phase.name}» подключена.</strong> Листы и колонки созданы.</p>
          <ScriptStatus result={phase.script} spreadsheetUrl={spreadsheetUrl(phase.spreadsheetId)} busy={scriptBusy} onRetry={() => void retryNewScript(phase)} />
          <FormulaSeparatorChoice value={phase.sep} locale={phase.localeSep} disabled={starting} onChange={(sep) => setPhase({ ...phase, sep })} />
          {startError ? <ErrorBanner error={startError} message={failureText(startError)} onRetry={() => void start(phase)} /> : null}
          <p>
            <button type="button" className="btn btn--primary" disabled={starting} onClick={() => void start(phase)}>
              {phase.script.ok ? 'Начать работу' : 'Продолжить без скрипта'}
            </button>
          </p>
        </div>
      ) : (
        <>
          {failure ? <ErrorBanner error={failure.error} message={failureText(failure.error)} onRetry={failure.retry} /> : null}
          {stalled ? <p className="banner banner--warning" role="status">{PICKER_STALL_TEXT}</p> : null}
          <AppSpreadsheetList currentId={spreadsheetId} disabled={busy} onSelect={connectFromList} />
          <SheetLinkField
            disabled={busy}
            hint="Подключить другую таблицу: вставьте ссылку — если доступа ещё нет, откроется окно Google с этим файлом, нажмите «Выбрать»"
            onSubmit={connectByLink}
          />
          {busy ? <p className="muted" role="status">{phase.text}</p> : null}
          {phase.k === 'same' ? <p className="muted" role="status">Эта таблица уже подключена</p> : null}
        </>
      )}
    </>
  );
}

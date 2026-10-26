// Раздел «Google-таблица» в настройках (G14, G15; истории 81, 82) — виден всегда.
// Подключена таблица: название, «Открыть таблицу», «Сменить таблицу», поле «Ссылка на таблицу» (окно Google с этим файлом →
// «Выбрать» → привязка с теми же проверками, что на экране подключения), «Импорт из старой таблицы», переустановка скрипта.
// Демо: пояснение, где настроить вход (docs/setup.md), и «Войти и подключить», если Google настроен.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { AuthError } from '../../../google/errors';
import { pickSpreadsheet } from '../../../google/picker';
import { SheetsStore } from '../../../store/sheetsStore';
import { StoreError } from '../../../store/types';
import { bindSpreadsheet, googleSheetsApi, spreadsheetUrl } from '../../../setup/connect';
import { installScript, type ScriptInstallResult } from '../../../setup/installScript';
import { ScriptStatus } from '../connect/ScriptStatus';
import { SheetLinkField } from '../connect/SheetLinkField';
import { setupDocsUrl } from './settingsLogic';

type LinkPhase =
  | { k: 'idle' }
  | { k: 'busy'; text: string }
  | { k: 'same' }
  | { k: 'done'; spreadsheetId: string; name: string; script: ScriptInstallResult };

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
  const url = spreadsheetUrl(spreadsheetId);

  useEffect(() => {
    let live = true;
    googleSheetsApi().getMeta(spreadsheetId)
      .then((m) => { if (live) setTitle(m.title); })
      .catch(() => { /* название не обязательно — остаётся ссылка «Открыть таблицу» */ });
    return () => { live = false; };
  }, [spreadsheetId]);

  const connectByLink = (fileId: string) => {
    const attempt = async () => {
      setFailure(null);
      if (fileId === spreadsheetId) { setPhase({ k: 'same' }); return; }
      setPhase({ k: 'busy', text: 'Открываю таблицу в окне Google…' });
      try {
        const picked = await pickSpreadsheet({ fileId });
        if (!picked) { setPhase({ k: 'idle' }); return; }
        if (picked.id === spreadsheetId) { setPhase({ k: 'same' }); return; }
        setPhase({ k: 'busy', text: `Настраиваю таблицу «${picked.name}»…` });
        const res = await bindSpreadsheet(googleSheetsApi(), email, picked.id);
        setPhase({ k: 'done', spreadsheetId: res.spreadsheetId, name: picked.name, script: res.script });
      } catch (e) {
        setPhase({ k: 'idle' });
        setFailure({ error: e, retry: () => void attempt() });
      }
    };
    void attempt();
  };

  const open = (id: string) => startSheets(new SheetsStore(googleSheetsApi(), id), { email, spreadsheetId: id });

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
          <p>
            <button type="button" className="btn btn--primary" onClick={() => open(phase.spreadsheetId)}>
              {phase.script.ok ? 'Начать работу' : 'Продолжить без скрипта'}
            </button>
          </p>
        </div>
      ) : (
        <>
          {failure ? <ErrorBanner error={failure.error} message={failureText(failure.error)} onRetry={failure.retry} /> : null}
          <SheetLinkField
            disabled={busy}
            hint="Подключить другую таблицу: вставьте ссылку — откроется окно Google с этим файлом, нажмите «Выбрать»"
            onSubmit={connectByLink}
          />
          {busy ? <p className="muted" role="status">{phase.text}</p> : null}
          {phase.k === 'same' ? <p className="muted" role="status">Эта таблица уже подключена</p> : null}
        </>
      )}
    </>
  );
}

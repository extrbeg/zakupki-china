// Экран «Подключение таблицы» (маршрут /connect и блок на экране входа).
// Вход Google → запомненная таблица открывается сразу; иначе — «Создать новую таблицу», «Выбрать существующую»
// или поле «Ссылка на таблицу» (окно Google открывается сразу с этим файлом, привязка — после «Выбрать»).
// При привязке таблица приводится к схеме и в неё ставится скрипт; итог скрипта показывается с инструкцией.

import { useCallback, useRef, useState } from 'react';
import { useSession } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { AuthError, lastEmail, signIn } from '../../../google/auth';
import { pickSpreadsheet } from '../../../google/picker';
import { SheetsStore } from '../../../store/sheetsStore';
import { StoreError } from '../../../store/types';
import { bindSpreadsheet, createAndBind, googleSheetsApi, restoreBinding, spreadsheetUrl } from '../../../setup/connect';
import { installScript, type ScriptInstallResult } from '../../../setup/installScript';
import { ScriptStatus } from './ScriptStatus';
import { SheetLinkField } from './SheetLinkField';

type Phase =
  | { k: 'signedOut' }
  | { k: 'busy'; text: string }
  | { k: 'choose'; email: string }
  | { k: 'done'; email: string; spreadsheetId: string; script: ScriptInstallResult };

interface Failure { error: unknown; message?: string; retry: () => void }

function failureText(e: unknown): string | undefined {
  if (e instanceof AuthError) return `Вход не выполнен: ${e.message}`;
  if (e instanceof StoreError) return undefined;   // ErrorBanner возьмёт текст по виду ошибки
  return e instanceof Error ? e.message : undefined;
}

export default function ConnectScreen() {
  const { session, googleConfigured, startSheets } = useSession();
  const embedded = session.mode === 'none';
  const [phase, setPhase] = useState<Phase>(() => (session.mode === 'sheets' ? { k: 'choose', email: session.email } : { k: 'signedOut' }));
  const [failure, setFailure] = useState<Failure | null>(null);
  const [scriptBusy, setScriptBusy] = useState(false);
  const before = useRef<Phase>(phase);

  const run = useCallback((text: string, action: () => Promise<void>) => {
    const attempt = async () => {
      setFailure(null);
      setPhase((p) => { if (p.k !== 'busy') before.current = p; return { k: 'busy', text }; });
      try {
        await action();
      } catch (e) {
        setPhase(before.current);
        setFailure({ error: e, message: failureText(e), retry: () => void attempt() });
      }
    };
    void attempt();
  }, []);

  const open = (email: string, spreadsheetId: string) => {
    startSheets(new SheetsStore(googleSheetsApi(), spreadsheetId), { email, spreadsheetId });
  };

  const onSignIn = () => run('Вход в Google…', async () => {
    const { email } = await signIn();
    setPhase({ k: 'busy', text: 'Открываю таблицу…' });
    const id = await restoreBinding(googleSheetsApi(), email);
    if (id) open(email, id);
    else setPhase({ k: 'choose', email });
  });

  const onCreate = (email: string) => run('Создаю таблицу и настраиваю листы…', async () => {
    const res = await createAndBind(googleSheetsApi(), email);
    setPhase({ k: 'done', email, spreadsheetId: res.spreadsheetId, script: res.script });
  });

  const onPick = (email: string, fileId?: string) => run(fileId ? 'Открываю таблицу в окне Google…' : 'Открываю выбор таблицы…', async () => {
    const picked = await pickSpreadsheet(fileId ? { fileId } : undefined);
    if (!picked) {
      setPhase({ k: 'choose', email });
      return;
    }
    setPhase({ k: 'busy', text: `Настраиваю таблицу «${picked.name}»…` });
    const res = await bindSpreadsheet(googleSheetsApi(), email, picked.id);
    setPhase({ k: 'done', email, spreadsheetId: res.spreadsheetId, script: res.script });
  });

  const retryScript = async (p: Extract<Phase, { k: 'done' }>) => {
    setScriptBusy(true);
    try {
      const script = await installScript(googleSheetsApi(), p.spreadsheetId);
      setPhase({ ...p, script });
    } finally {
      setScriptBusy(false);
    }
  };

  const Title = embedded ? 'h2' : 'h1';
  if (!googleConfigured) {
    return (
      <section className="screen">
        <Title className="screen__title">Подключение таблицы</Title>
        <p className="muted">Вход Google не настроен: при сборке не задан идентификатор клиента (VITE_GOOGLE_CLIENT_ID). Пока доступен демо-режим.</p>
      </section>
    );
  }

  const remembered = lastEmail();
  return (
    <section className="screen">
      <Title className="screen__title">Подключение таблицы</Title>
      {failure ? <ErrorBanner error={failure.error} message={failure.message} onRetry={failure.retry} /> : null}

      {phase.k === 'signedOut' ? (
        <div>
          <p className="muted">Войдите своим Google-аккаунтом: данные хранятся в вашей Google-таблице.</p>
          <button type="button" className="btn btn--primary" onClick={onSignIn}>Войти через Google</button>
          {remembered ? <p className="muted small">Последний вход: {remembered}</p> : null}
        </div>
      ) : null}

      {phase.k === 'busy' ? <p className="muted" role="status">{phase.text}</p> : null}

      {phase.k === 'choose' ? (
        <div>
          <p>Аккаунт: <strong>{phase.email}</strong></p>
          {session.mode === 'sheets' ? (
            <p className="muted small">
              Сейчас подключена <a href={spreadsheetUrl(session.spreadsheetId)} target="_blank" rel="noopener noreferrer">эта таблица</a>.
            </p>
          ) : (
            <p className="muted">Подключите таблицу: создайте новую или выберите существующую. В ней сами создадутся листы, колонки и скрипт курсов.</p>
          )}
          <div className="empty-state__actions">
            <button type="button" className="btn btn--primary" onClick={() => onCreate(phase.email)}>Создать новую таблицу</button>
            <button type="button" className="btn" onClick={() => onPick(phase.email)}>Выбрать существующую</button>
          </div>
          <SheetLinkField onSubmit={(fileId) => onPick(phase.email, fileId)} />
        </div>
      ) : null}

      {phase.k === 'done' ? (
        <div>
          <p><strong>Таблица подключена.</strong> Листы и колонки созданы.</p>
          <ScriptStatus result={phase.script} spreadsheetUrl={spreadsheetUrl(phase.spreadsheetId)} busy={scriptBusy} onRetry={() => void retryScript(phase)} />
          <p>
            <button type="button" className="btn btn--primary" onClick={() => open(phase.email, phase.spreadsheetId)}>
              {phase.script.ok ? 'Начать работу' : 'Продолжить без скрипта'}
            </button>
          </p>
        </div>
      ) : null}
    </section>
  );
}

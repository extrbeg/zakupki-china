// Экран «Подключение таблицы» (маршрут /connect и блок на экране входа).
// Вход Google → запомненная таблица открывается сразу; иначе — «Ваши таблицы приложения» (касание — привязка без окна Google,
// так подключается на телефоне таблица, созданная на компьютере), «Создать новую таблицу», «Выбрать существующую»
// или поле «Ссылка на таблицу» (есть доступ — привязка сразу; нет — окно Google с этим файлом, привязка после «Выбрать»).
// Окно Google, закрывшееся без ответа, не держит экран в ожидании: развилка возвращается с подсказкой, поздний ответ принимается.
// При привязке таблица приводится к схеме и в неё ставится скрипт; итог скрипта показывается с инструкцией.
// Там же — выбор «Разделитель аргументов в формулах» (отмечен по локали таблицы); выбор пишется в «Настройки» при «Начать работу».

import { useCallback, useRef, useState } from 'react';
import { useSession } from '../../DataContext';
import { ErrorBanner } from '../../components';
import { AuthError, lastEmail, signIn } from '../../../google/auth';
import { pickSpreadsheet } from '../../../google/picker';
import type { AppSpreadsheet } from '../../../google/driveApi';
import { SheetsStore } from '../../../store/sheetsStore';
import { StoreError } from '../../../store/types';
import { bindSpreadsheet, createAndBind, googleSheetsApi, openLinkedSpreadsheet, restoreBinding, spreadsheetUrl } from '../../../setup/connect';
import { installScript, type ScriptInstallResult } from '../../../setup/installScript';
import { applyFormulaSeparator } from '../../../setup/formulaSeparator';
import type { FormulaSeparator } from '../../../store/schema';
import type { BindResult } from '../../../setup/connect';
import { FormulaSeparatorChoice } from './FormulaSeparatorChoice';
import { AppSpreadsheetList, PICKER_STALL_TEXT } from './AppSpreadsheetList';
import { ScriptStatus } from './ScriptStatus';
import { SheetLinkField } from './SheetLinkField';

type Phase =
  | { k: 'signedOut' }
  | { k: 'busy'; text: string }
  | { k: 'choose'; email: string }
  | { k: 'done'; email: string; spreadsheetId: string; script: ScriptInstallResult; localeSep: FormulaSeparator; sep: FormulaSeparator };

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
  const [stalled, setStalled] = useState(false);
  const before = useRef<Phase>(phase);
  const op = useRef(0);

  /** Действие экрана; isCurrent() — после него не начато другое (поздний ответ окна Google не перебивает новое действие). */
  const run = useCallback((text: string, action: (isCurrent: () => boolean) => Promise<void>) => {
    const attempt = async () => {
      const mine = ++op.current;
      const isCurrent = () => op.current === mine;
      setFailure(null);
      setStalled(false);
      setPhase((p) => { if (p.k !== 'busy') before.current = p; return { k: 'busy', text }; });
      try {
        await action(isCurrent);
      } catch (e) {
        if (!isCurrent()) return;
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

  const doneOf = (email: string, res: BindResult): Phase => ({
    k: 'done', email, spreadsheetId: res.spreadsheetId, script: res.script, localeSep: res.formulaSeparator.locale, sep: res.formulaSeparator.locale,
  });

  const onCreate = (email: string) => run('Создаю таблицу и настраиваю листы…', async () => {
    setPhase(doneOf(email, await createAndBind(googleSheetsApi(), email)));
  });

  /** «Начать работу»: выбранный разделитель — в «Настройки» (формулы перевода переписываются), затем приложение. */
  const onStart = (p: Extract<Phase, { k: 'done' }>) => run('Сохраняю разделитель формул…', async () => {
    await applyFormulaSeparator(googleSheetsApi(), p.spreadsheetId, p.sep);
    open(p.email, p.spreadsheetId);
  });

  const bindPicked = async (email: string, picked: { id: string; name: string }) => {
    setPhase({ k: 'busy', text: `Настраиваю таблицу «${picked.name}»…` });
    setPhase(doneOf(email, await bindSpreadsheet(googleSheetsApi(), email, picked.id)));
  };

  /** Окно Google (весь список или файл по ссылке без доступа). Закрылось без ответа — развилка с подсказкой. */
  const onPick = (email: string, fileId?: string) => run(fileId ? 'Открываю таблицу…' : 'Открываю выбор таблицы…', async (isCurrent) => {
    const onStall = () => {
      if (!isCurrent()) return;
      setPhase({ k: 'choose', email });
      setStalled(true);
    };
    const picked = fileId
      ? await openLinkedSpreadsheet(fileId, { getMeta: (id) => googleSheetsApi().getMeta(id), pick: pickSpreadsheet }, { onStall })
      : await pickSpreadsheet({ onStall });
    if (!isCurrent()) return;
    if (!picked) {
      setPhase({ k: 'choose', email });
      return;
    }
    setStalled(false);
    await bindPicked(email, picked);
  });

  /** «Ваши таблицы приложения»: доступ уже есть — привязка без окна Google. */
  const onList = (email: string, file: AppSpreadsheet) => run(`Настраиваю таблицу «${file.name}»…`, () => bindPicked(email, file));

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
          {stalled ? <p className="banner banner--warning" role="status">{PICKER_STALL_TEXT}</p> : null}
          <AppSpreadsheetList
            currentId={session.mode === 'sheets' ? session.spreadsheetId : undefined}
            onSelect={(file) => onList(phase.email, file)}
          />
          <div className="empty-state__actions">
            <button type="button" className="btn btn--primary" onClick={() => onCreate(phase.email)}>Создать новую таблицу</button>
            <button type="button" className="btn" onClick={() => onPick(phase.email)}>Выбрать существующую</button>
          </div>
          <SheetLinkField
            hint="Ссылка из адресной строки таблицы или её id — если доступа ещё нет, откроется окно Google, нажмите «Выбрать»"
            onSubmit={(fileId) => onPick(phase.email, fileId)}
          />
        </div>
      ) : null}

      {phase.k === 'done' ? (
        <div>
          <p><strong>Таблица подключена.</strong> Листы и колонки созданы.</p>
          <ScriptStatus result={phase.script} spreadsheetUrl={spreadsheetUrl(phase.spreadsheetId)} busy={scriptBusy} onRetry={() => void retryScript(phase)} />
          <FormulaSeparatorChoice value={phase.sep} locale={phase.localeSep} onChange={(sep) => setPhase({ ...phase, sep })} />
          <p>
            <button type="button" className="btn btn--primary" onClick={() => onStart(phase)}>
              {phase.script.ok ? 'Начать работу' : 'Продолжить без скрипта'}
            </button>
          </p>
        </div>
      ) : null}
    </section>
  );
}

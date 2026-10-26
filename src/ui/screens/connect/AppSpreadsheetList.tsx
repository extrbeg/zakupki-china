// «Ваши таблицы приложения» (G19, история 88): таблицы, доступные приложению по drive.file, — созданные им или выбранные
// в окне Google на любом устройстве. На телефоне окно Google часто не возвращает выбор, а этот список открывает таблицу
// одним касанием. Касание — onSelect: экран привязывает таблицу с теми же проверками, что и при выборе в окне.
// Используют экран подключения и раздел «Google-таблица» в настройках.

import { useCallback, useEffect, useId, useState } from 'react';
import { ErrorBanner } from '../../components';
import { listAppSpreadsheets, type AppSpreadsheet } from '../../../google/driveApi';
import { ruDate } from '../../format';
import './connect.css';

export const APP_SPREADSHEETS_TITLE = 'Ваши таблицы приложения';
export const APP_SPREADSHEETS_EMPTY_TEXT = 'Таблиц пока нет: создайте новую или вставьте ссылку';
/** Подсказка, когда окно Google закрылось без ответа (фокус вернулся в приложение). */
export const PICKER_STALL_TEXT = 'Окно выбора не вернуло таблицу — выберите её из списка или вставьте ссылку';

const MSK_OFFSET_MS = 3 * 3600_000;

/** Дата изменения по Москве (как и остальные даты приложения): ISO 8601 → дд.мм.гггг; не дата — пусто. */
function modifiedDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : ruDate(new Date(t + MSK_OFFSET_MS).toISOString().slice(0, 10));
}

export interface AppSpreadsheetListProps {
  /** Привязанная сейчас таблица — помечается «подключена». */
  currentId?: string;
  disabled?: boolean;
  onSelect(file: AppSpreadsheet): void;
}

type ListState = { k: 'loading' } | { k: 'failed' } | { k: 'ready'; files: AppSpreadsheet[] };

export function AppSpreadsheetList({ currentId, disabled, onSelect }: AppSpreadsheetListProps) {
  const [state, setState] = useState<ListState>({ k: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const titleId = useId();

  useEffect(() => {
    let live = true;
    setState({ k: 'loading' });
    listAppSpreadsheets()
      .then((files) => { if (live) setState({ k: 'ready', files }); })
      .catch(() => { if (live) setState({ k: 'failed' }); });
    return () => { live = false; };
  }, [attempt]);

  return (
    <div className="app-sheets">
      <h3 className="app-sheets__title" id={titleId}>{APP_SPREADSHEETS_TITLE}</h3>
      {state.k === 'loading' ? <p className="muted small" role="status">Загружаю список таблиц…</p> : null}
      {state.k === 'failed' ? <ErrorBanner message="Не удалось загрузить список таблиц — проверьте связь" onRetry={retry} /> : null}
      {state.k === 'ready' && state.files.length === 0 ? <p className="muted">{APP_SPREADSHEETS_EMPTY_TEXT}</p> : null}
      {state.k === 'ready' && state.files.length > 0 ? (
        <ul className="app-sheets__list" aria-labelledby={titleId}>
          {state.files.map((f) => {
            const current = f.id === currentId;
            const date = modifiedDate(f.modifiedTime);
            return (
              <li key={f.id}>
                <button
                  type="button" className="app-sheets__item" disabled={disabled}
                  aria-current={current ? 'true' : undefined} onClick={() => onSelect(f)}
                >
                  <span className="app-sheets__name">{f.name || 'Без названия'}</span>
                  <span className="muted small">
                    {date ? `изменена ${date}` : null}
                    {current ? <strong className="app-sheets__current">{date ? ' · ' : ''}подключена</strong> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

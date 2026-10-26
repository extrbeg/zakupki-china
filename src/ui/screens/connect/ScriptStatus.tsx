// Итог установки скрипта таблицы: инструкция по ежедневным курсам, либо как включить Apps Script API.

import type { ScriptInstallResult } from '../../../setup/installScript';
import { APPS_SCRIPT_SETTINGS_URL } from '../../../google/scriptApi';

export function DailyRatesHint({ spreadsheetUrl }: { spreadsheetUrl: string }) {
  return (
    <div data-testid="daily-rates-hint">
      <p>Чтобы курсы ВТБ загружались каждый день, один раз разрешите это в таблице:</p>
      <ol>
        <li><a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer">Откройте таблицу</a>.</li>
        <li>В меню выберите «Закупки» → «Включить ежедневные курсы».</li>
        <li>Google попросит разрешение — разрешите.</li>
      </ol>
      <p className="muted small">Без этого приложение работает, курсы можно вносить вручную.</p>
    </div>
  );
}

export function ScriptStatus({ result, spreadsheetUrl, onRetry, busy }: {
  result: ScriptInstallResult; spreadsheetUrl: string; onRetry: () => void; busy?: boolean;
}) {
  if (result.ok) return <DailyRatesHint spreadsheetUrl={spreadsheetUrl} />;
  if (result.reason === 'API_DISABLED') {
    return (
      <div className="banner banner--warning" role="alert" data-testid="script-api-disabled">
        <div>
          <p><strong>Скрипт таблицы не установлен: у вашего аккаунта выключен Apps Script API.</strong></p>
          <ol>
            <li>Откройте <a href={APPS_SCRIPT_SETTINGS_URL} target="_blank" rel="noopener noreferrer">{APPS_SCRIPT_SETTINGS_URL}</a>.</li>
            <li>Включите переключатель «Google Apps Script API».</li>
            <li>Вернитесь сюда и нажмите «Повторить».</li>
          </ol>
          <p className="muted small">Без скрипта приложение работает, курсы — вручную.</p>
          <button type="button" className="btn btn--primary" onClick={onRetry} disabled={busy}>Повторить</button>
        </div>
      </div>
    );
  }
  return (
    <div className="banner banner--warning" role="alert">
      <span>{result.message}</span>
      <button type="button" className="btn btn--small" onClick={onRetry} disabled={busy}>Повторить</button>
    </div>
  );
}

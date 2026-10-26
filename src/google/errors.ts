// Ошибки слоя Google. Тексты — для журнала и интерфейса; значения токенов и ключей сюда не попадают.

/** Ответ Google API с ошибкой. status 0 — запрос не дошёл (нет сети, CORS, обрыв). */
export class GoogleApiError extends Error {
  readonly status: number;
  constructor(status: number, message?: string, options?: { cause?: unknown }) {
    super(message ?? (status === 0 ? 'Нет связи с Google' : `Ошибка Google API (${status})`));
    this.name = 'GoogleApiError';
    this.status = status;
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Не удалось получить или обновить токен доступа — нужно войти заново. */
export class AuthError extends Error {
  constructor(message = 'Нужно войти в Google заново', options?: { cause?: unknown }) {
    super(message);
    this.name = 'AuthError';
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Apps Script API выключен в настройках пользователя (https://script.google.com/home/usersettings). */
export class ScriptApiDisabledError extends Error {
  constructor(message = 'Apps Script API выключен в настройках Google-аккаунта') {
    super(message);
    this.name = 'ScriptApiDisabledError';
  }
}

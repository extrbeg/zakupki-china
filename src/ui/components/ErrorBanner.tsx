import { STORE_ERROR_TEXT, StoreError } from '../../store/types';

export interface ErrorBannerProps {
  /** Ошибка хранилища — текст берётся по её виду. */
  error?: unknown;
  /** Свой текст вместо стандартного. */
  message?: string;
  onRetry?: () => void;
}

function textFor(error: unknown): string {
  if (error instanceof StoreError) return STORE_ERROR_TEXT[error.kind];
  return STORE_ERROR_TEXT.network;
}

/** Баннер ошибки: по умолчанию «Нет связи с таблицей — Повторить». */
export function ErrorBanner({ error, message, onRetry }: ErrorBannerProps) {
  return (
    <div className="banner banner--error" role="alert">
      <span>{message ?? textFor(error)}</span>
      {onRetry ? <> {' — '}<button type="button" className="btn btn--small" onClick={onRetry}>Повторить</button></> : null}
    </div>
  );
}

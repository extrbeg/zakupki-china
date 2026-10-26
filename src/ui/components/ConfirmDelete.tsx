// Удаление с подтверждением — один компонент для всех экранов: «Удалить» → «Да, удалить» / «Не удалять».
// Если запись используется (blockReason) — вместо подтверждения причина отказа. Без системного confirm().

import { useState } from 'react';
import { ErrorBanner } from './ErrorBanner';

export interface ConfirmDeleteProps {
  /** Текст кнопки; по умолчанию «Удалить». */
  label?: string;
  /** Доступное имя кнопки, если текста мало (например, «Удалить партию …» в строке таблицы). */
  ariaLabel?: string;
  /** Вопрос рядом с кнопками подтверждения («Удалить затрату?»). */
  question?: string;
  /** Причина, по которой удалять нельзя; null/undefined — можно. */
  blockReason?: string | null;
  /** Удаление; ошибка показывается баннером под кнопкой. */
  onDelete: () => Promise<void> | void;
  disabled?: boolean;
  /** Маленькие кнопки (в строке таблицы). */
  small?: boolean;
}

export function ConfirmDelete({ label = 'Удалить', ariaLabel, question, blockReason, onDelete, disabled, small }: ConfirmDeleteProps) {
  const [step, setStep] = useState<'idle' | 'blocked' | 'confirm'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const size = small ? ' btn--small' : '';

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onDelete();
      setStep('idle');
    } catch (e) {
      setError(e);
      setStep('idle');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {step === 'confirm' ? (
        <span className="confirm-delete" role="group" aria-label={question ?? ariaLabel ?? label}>
          {question ? <span>{question}</span> : null}
          <button type="button" className={`btn btn--danger${size}`} disabled={busy || disabled} onClick={() => void run()}>Да, удалить</button>
          <button type="button" className={`btn${size}`} disabled={busy} onClick={() => setStep('idle')}>Не удалять</button>
        </span>
      ) : (
        <button
          type="button" className={`btn btn--danger${size}`} disabled={disabled || busy} aria-label={ariaLabel}
          onClick={() => { setError(undefined); setStep(blockReason ? 'blocked' : 'confirm'); }}
        >
          {label}
        </button>
      )}
      {step === 'blocked' && blockReason ? <ErrorBanner message={blockReason} /> : null}
      {error !== undefined ? <ErrorBanner error={error} /> : null}
    </>
  );
}

// Обёртка поля формы: подпись, элемент, подсказка и ошибка под полем (по-русски).

import { useId, type ReactNode } from 'react';

export interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Рендер элемента управления с готовыми id и aria-атрибутами. */
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={`field${error ? ' field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? <span className="field__required" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <div className="field__error" id={errorId}>{error}</div>
      ) : hint ? (
        <div className="field__hint" id={hintId}>{hint}</div>
      ) : null}
    </div>
  );
}

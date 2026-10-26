import { useId } from 'react';

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function CheckboxField({ label, checked, onChange, error, disabled, className }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className={`field field--checkbox${error ? ' field--invalid' : ''}${className ? ` ${className}` : ''}`}>
      <label className="checkbox" htmlFor={id}>
        <input
          id={id} type="checkbox" checked={checked} disabled={disabled}
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {error ? <div className="field__error" id={`${id}-error`}>{error}</div> : null}
    </div>
  );
}

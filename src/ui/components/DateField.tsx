import type { ISODate } from '../../domain/model';
import { Field } from './Field';

export interface DateFieldProps {
  label: string;
  value: ISODate | undefined;
  onChange: (value: ISODate | undefined) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DateField({ label, value, onChange, error, hint, required, disabled, className }: DateFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id} className="input" type="date" value={value ?? ''} disabled={disabled}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        />
      )}
    </Field>
  );
}

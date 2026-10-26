import { Field } from './Field';

export interface TextFieldProps {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'email' | 'tel' | 'url' | 'search';
  disabled?: boolean;
  className?: string;
}

export function TextField({ label, value, onChange, error, hint, required, placeholder, multiline, type = 'text', disabled, className }: TextFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) =>
        multiline ? (
          <textarea
            id={id} className="input" rows={3} value={value ?? ''} placeholder={placeholder} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={id} className="input" type={type} value={value ?? ''} placeholder={placeholder} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

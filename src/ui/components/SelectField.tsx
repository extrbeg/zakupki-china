import { Field } from './Field';

export interface SelectOption { value: string; label: string; /** Пояснение серым справа в поле с поиском (провинция у города). */ hint?: string }

export interface SelectFieldProps {
  label: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (value: string | undefined) => void;
  /** Текст пустого варианта; без него пустой вариант не показывается. */
  placeholder?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SelectField({ label, value, options, onChange, placeholder, error, hint, required, disabled, className }: SelectFieldProps) {
  const known = value === undefined || value === '' || options.some((o) => o.value === value);
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id} className="input" value={value ?? ''} disabled={disabled}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        >
          {placeholder !== undefined || !value ? <option value="">{placeholder ?? ''}</option> : null}
          {/* значение не из списка (например, удалённое из справочника) не теряется */}
          {!known ? <option value={value}>{value}</option> : null}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

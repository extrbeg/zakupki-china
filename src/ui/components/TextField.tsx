// Текстовое поле. С `suggestions` (однострочное) — поиск при вводе по прежним значениям этого поля (правило полей без списка,
// AGENTS.md): подсказки по подстроке, выбор подставляет значение; вписать новое можно как обычно.

import { SUGGESTION_LIMIT, filterByQuery, searchKey } from '../../domain/search';
import { Field } from './Field';
import { SuggestInput } from './SuggestInput';

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
  /** Прежние значения поля для подсказок (`pastValues`). */
  suggestions?: readonly string[];
}

export function TextField({ label, value, onChange, error, hint, required, placeholder, multiline, type = 'text', disabled, className, suggestions }: TextFieldProps) {
  const text = value ?? '';
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) =>
        multiline ? (
          <textarea
            id={id} className="input" rows={3} value={text} placeholder={placeholder} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : suggestions ? (
          <SuggestInput
            id={id} value={text} placeholder={placeholder} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            suggestions={filterByQuery(suggestions.filter((s) => searchKey(s) !== searchKey(text)), (s) => s, text, SUGGESTION_LIMIT)
              .map((s) => ({ key: s, value: s }))}
            onChange={onChange} onPick={(s) => onChange(s.value)}
          />
        ) : (
          <input
            id={id} className="input" type={type} value={text} placeholder={placeholder} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

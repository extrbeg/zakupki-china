// Выпадающий список с пунктом «+ Добавить…» в конце: выбор пункта открывает поле ввода под списком.
// Enter или «Добавить» передаёт название наружу (onAdd), Esc или «Отмена» закрывает ввод; пустое — ошибка у поля.
// Сам ничего не сохраняет: что делать с названием, решает обёртка (ListSelectField, DirectorySelectField).

import { useEffect, useRef, useState } from 'react';
import { Field } from './Field';
import type { SelectOption } from './SelectField';
import './AddableSelect.css';

/** Значение служебного пункта «+ Добавить…»; наружу через onChange не уходит. */
export const ADD_OPTION_VALUE = '\u0000add';

export interface AddableSelectProps {
  label: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (value: string | undefined) => void;
  /** Получает обрезанное непустое название. */
  onAdd: (name: string) => void;
  /** Текст последнего пункта: «+ Добавить…», «+ Новый поставщик…». */
  addLabel: string;
  /** Подпись поля ввода нового названия (для чтения с экрана). */
  inputLabel: string;
  placeholder?: string;
  error?: string;
  /** Ошибка записи нового значения — под полем. */
  addError?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export const EMPTY_NAME_ERROR = 'Введите название';

export function AddableSelect(props: AddableSelectProps) {
  const { label, value, options, onChange, onAdd, addLabel, inputLabel, placeholder, error, addError, hint, required, disabled, className } = props;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const known = value === undefined || value === '' || options.some((o) => o.value === value);
  const close = () => { setAdding(false); setText(''); setInputError(''); };
  const submit = () => {
    const name = text.trim();
    if (!name) { setInputError(EMPTY_NAME_ERROR); return; }
    close();
    onAdd(name);
  };

  return (
    <Field label={label} error={error ?? addError} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <>
          <select
            id={id} className="input" value={value ?? ''} disabled={disabled}
            aria-invalid={invalid || undefined} aria-describedby={describedBy}
            onChange={(e) => {
              const v = e.target.value;
              if (v === ADD_OPTION_VALUE) { setAdding(true); return; }
              onChange(v === '' ? undefined : v);
            }}
          >
            {placeholder !== undefined || !value ? <option value="">{placeholder ?? ''}</option> : null}
            {/* значение не из списка (например, удалённое из справочника) не теряется */}
            {!known ? <option value={value}>{value}</option> : null}
            {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {disabled ? null : <option value={ADD_OPTION_VALUE}>{addLabel}</option>}
          </select>
          {adding ? (
            <div className="select-add">
              <input
                ref={inputRef} className="input select-add__input" type="text" value={text}
                aria-label={inputLabel} aria-invalid={inputError ? true : undefined}
                onChange={(e) => { setText(e.target.value); if (inputError) setInputError(''); }}
                onKeyDown={(e) => {
                  // Enter не должен отправлять форму, в которой стоит поле
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
                }}
              />
              <button type="button" className="btn btn--small" onClick={submit}>Добавить</button>
              <button type="button" className="btn btn--small" onClick={close}>Отмена</button>
              {inputError ? <div className="field__error select-add__error">{inputError}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </Field>
  );
}

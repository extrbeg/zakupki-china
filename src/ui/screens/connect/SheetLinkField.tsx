// Поле «Ссылка на таблицу» (G14): вставил ссылку (или id) — сразу onSubmit(id), дальше экран открывает окно Google
// с этим файлом; набранное руками — по кнопке или Enter. Неверная ссылка — ошибка у поля, onSubmit не вызывается.
// Используют экран подключения, «Настройки» и «Импорт из старой таблицы».

import { useState, type ClipboardEvent, type FormEvent } from 'react';
import { Field } from '../../components';
import { parseSheetLink, SheetLinkError } from '../../sheetLink';
import './connect.css';

export interface SheetLinkFieldProps {
  /** Подпись поля; по умолчанию «Ссылка на таблицу». */
  label?: string;
  /** Текст кнопки; по умолчанию «Подключить». */
  button?: string;
  hint?: string;
  disabled?: boolean;
  /** id таблицы из ссылки. */
  onSubmit(fileId: string): void;
}

export function SheetLinkField({ label = 'Ссылка на таблицу', button = 'Подключить', hint, disabled, onSubmit }: SheetLinkFieldProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = (value: string) => {
    let id: string;
    try {
      id = parseSheetLink(value);
    } catch (e) {
      if (!(e instanceof SheetLinkError)) throw e;
      setError(e.message);
      return;
    }
    setError(undefined);
    onSubmit(id);
  };

  const onForm = (e: FormEvent) => {
    e.preventDefault();
    if (!disabled) submit(text);
  };

  // Вставка целиком в пустое (или выделенное целиком) поле — сразу открыть окно; ошибку покажем только при явном «Подключить».
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const whole = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    if (disabled || !whole) return;
    const pasted = e.clipboardData.getData('text');
    try {
      parseSheetLink(pasted);
    } catch {
      return;
    }
    e.preventDefault();
    setText(pasted.trim());
    submit(pasted);
  };

  return (
    <form className="sheet-link" onSubmit={onForm} noValidate>
      <Field label={label} error={error} hint={error ? undefined : hint ?? 'Ссылка из адресной строки таблицы или её id — откроется окно Google, нажмите «Выбрать»'}>
        {({ id, describedBy, invalid }) => (
          <div className="sheet-link__row">
            <input
              id={id} className="input sheet-link__input" type="text" inputMode="url" autoComplete="off" spellCheck={false}
              placeholder="https://docs.google.com/spreadsheets/d/…" value={text} disabled={disabled}
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              onChange={(e) => { setText(e.target.value); if (error) setError(undefined); }}
              onPaste={onPaste}
            />
            <button type="submit" className="btn" disabled={disabled}>{button}</button>
          </div>
        )}
      </Field>
    </form>
  );
}

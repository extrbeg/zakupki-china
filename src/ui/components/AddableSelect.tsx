// Выпадающий список с пунктом «+ Добавить…» в конце: выбор пункта открывает поле ввода под списком.
// Enter или «Добавить» передаёт название наружу (onAdd), Esc или «Отмена» закрывает ввод; пустое — ошибка у поля.
// Сам ничего не сохраняет: что делать с названием, решает обёртка (ListSelectField, DirectorySelectField).
// Без onAdd — выбор из записей, которые здесь не заводятся (позиции, заказы, поставки): поиск при вводе без «+ Добавить…».
// addExtra — доп. поля строки нового значения (правило деления доставки у типа поставки).
// С `search` вместо выпадающего списка — поле с поиском при вводе (история 93): подсказки по подстроке (до 10), Enter выбирает подсвеченную,
// «Нет совпадений» и «+ Добавить…» последним пунктом (откроет ввод нового названия с уже введённым текстом). Точно совпавшее название
// выбирается сразу; ушли из поля, ничего не выбрав, — показывается выбранное раньше, стёрли текст — выбор снимается.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SUGGESTION_LIMIT, filterByQuery, searchKey } from '../../domain/search';
import { Field } from './Field';
import type { SelectOption } from './SelectField';
import { SuggestInput } from './SuggestInput';
import './AddableSelect.css';

/** Значение служебного пункта «+ Добавить…»; наружу через onChange не уходит. */
export const ADD_OPTION_VALUE = '\u0000add';

export interface AddableSelectProps {
  label: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (value: string | undefined) => void;
  /** Получает обрезанное непустое название; нет — пункта «+ Добавить…» нет. */
  onAdd?: (name: string) => void;
  /** Текст последнего пункта: «+ Добавить…», «+ Новый поставщик…». */
  addLabel?: string;
  /** Подпись поля ввода нового названия (для чтения с экрана). */
  inputLabel?: string;
  /** Доп. поля в строке ввода нового значения. */
  addExtra?: ReactNode;
  placeholder?: string;
  error?: string;
  /** Ошибка записи нового значения — под полем. */
  addError?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Поле с поиском при вводе вместо выпадающего списка. */
  search?: boolean;
}

export const EMPTY_NAME_ERROR = 'Введите название';

export function AddableSelect(props: AddableSelectProps) {
  const { label, value, options, onChange, onAdd, addLabel = '+ Добавить…', inputLabel, placeholder, error, addError, hint, required, disabled, className, search, addExtra } = props;
  const canAdd = Boolean(onAdd) && !disabled;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [inputError, setInputError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  /** Набранный в поле поиска текст; null — поле показывает выбранное значение. */
  const [typed, setTyped] = useState<string | null>(null);
  const known = value === undefined || value === '' || options.some((o) => o.value === value);
  const close = () => { setAdding(false); setText(''); setInputError(''); };
  const submit = () => {
    const name = text.trim();
    if (!name) { setInputError(EMPTY_NAME_ERROR); return; }
    close();
    onAdd?.(name);
  };

  return (
    <Field label={label} error={error ?? addError} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <>
          {search ? (
            <SearchInput
              id={id} describedBy={describedBy} invalid={invalid} value={value} options={options} placeholder={placeholder} disabled={disabled}
              typed={typed} setTyped={setTyped} onChange={onChange} addLabel={addLabel}
              onAdd={canAdd ? (q) => { setText(q); setInputError(''); setAdding(true); } : undefined}
            />
          ) : <select
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
            {canAdd ? <option value={ADD_OPTION_VALUE}>{addLabel}</option> : null}
          </select>}
          {adding ? (
            <div className="select-add">
              <input
                ref={inputRef} className="input select-add__input" type="text" value={text}
                aria-label={inputLabel ?? `Новое значение: ${label}`} aria-invalid={inputError ? true : undefined}
                onChange={(e) => { setText(e.target.value); if (inputError) setInputError(''); }}
                onKeyDown={(e) => {
                  // Enter не должен отправлять форму, в которой стоит поле
                  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); submit(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
                }}
              />
              {addExtra}
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

const selectedLabel = (options: SelectOption[], value: string | undefined) => options.find((o) => o.value === value)?.label ?? value ?? '';

function SearchInput({ id, describedBy, invalid, value, options, placeholder, disabled, typed, setTyped, onChange, addLabel, onAdd }: {
  id: string; describedBy?: string; invalid: boolean; value: string | undefined; options: SelectOption[]; placeholder?: string; disabled?: boolean;
  typed: string | null; setTyped: (t: string | null) => void; onChange: (v: string | undefined) => void; addLabel: string; onAdd?: (query: string) => void;
}) {
  const query = typed ?? '';
  const all = filterByQuery(options, (o) => o.label, query, Number.POSITIVE_INFINITY);
  const shown = all.slice(0, SUGGESTION_LIMIT);
  const exact = (text: string) => options.find((o) => searchKey(o.label) === searchKey(text));
  return (
    <SuggestInput
      id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} placeholder={placeholder} disabled={disabled}
      value={typed ?? selectedLabel(options, value)} query={query} data-value={value ?? ''}
      suggestions={shown.map((o) => ({ key: o.value, value: o.value, label: o.label, hint: o.hint }))}
      moreText={all.length > shown.length ? `Ещё ${all.length - shown.length} — уточните поиск` : undefined}
      showEmpty openOnFocus autoActivate
      action={disabled || !onAdd ? undefined : { label: addLabel, onPick: () => { setTyped(null); onAdd(query.trim()); } }}
      onChange={(text) => {
        setTyped(text);
        const hit = text.trim() ? exact(text) : undefined;
        if (hit && hit.value !== value) onChange(hit.value);
      }}
      onPick={(s) => { setTyped(null); onChange(s.value); }}
      onKeyDown={(e) => {
        // Enter без подсвеченной подсказки — не отправка формы, в которой стоит поле (точное совпадение уже выбрано при вводе)
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); }
        if (e.key === 'Escape' && typed !== null) { e.preventDefault(); e.stopPropagation(); setTyped(null); }
      }}
      onBlur={() => {
        if (typed === null) return;
        if (typed.trim() === '') { if (value !== undefined) onChange(undefined); }
        else { const hit = exact(typed); if (hit && hit.value !== value) onChange(hit.value); }
        setTyped(null);
      }}
    />
  );
}

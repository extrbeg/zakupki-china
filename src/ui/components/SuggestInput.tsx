// Поле ввода с подсказками при вводе (история 93) — combobox: стрелки ↑/↓ выбирают подсказку, Enter подставляет, Esc закрывает список;
// мышью и касанием — нажатием на подсказку. Совпадение с введённым подсвечено. Сам не фильтрует: подсказки (до 10) готовит вызывающий
// (`filterByQuery` из `domain/search`). Enter и Esc, не занятые списком, уходят в onKeyDown вызывающего (например, Enter — сохранить строку).
// Список позиционируется `fixed` от поля, чтобы его не обрезала прокручиваемая таблица.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { matchRange } from '../../domain/search';
import './SuggestInput.css';

export interface Suggestion {
  key: string;
  /** Что подставить (и что отдаётся в onPick). */
  value: string;
  /** Видимый текст; по умолчанию — value. */
  label?: string;
  /** Пояснение справа серым (провинция у города, HS-код у товара). */
  hint?: string;
}

export const NO_MATCHES_TEXT = 'Нет совпадений';

export interface SuggestInputProps {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  suggestions: Suggestion[];
  onPick: (s: Suggestion) => void;
  /** Что подсвечивать; по умолчанию — введённый текст. */
  query?: string;
  /** Последний пункт списка («+ Добавить…»), доступен и с клавиатуры. */
  action?: { label: string; onPick: () => void };
  /** Подпись под подсказками, когда их больше показанных. */
  moreText?: string;
  /** Показывать «Нет совпадений», когда по непустому вводу ничего нет. */
  showEmpty?: boolean;
  /** Открывать список при фокусе (выбор из справочника), а не только при вводе. */
  openOnFocus?: boolean;
  /** Подсвечивать первую подсказку по непустому вводу — Enter сразу подставит её. */
  autoActivate?: boolean;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  inputMode?: 'text' | 'decimal';
  inputRef?: Ref<HTMLInputElement>;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'data-value'?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
  onBlur?: () => void;
  onFocus?: () => void;
}

/** Текст с подсвеченным совпадением. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const r = matchRange(text, query);
  if (!r) return <>{text}</>;
  return <>{text.slice(0, r[0])}<mark className="suggest__mark">{text.slice(r[0], r[1])}</mark>{text.slice(r[1])}</>;
}

export function SuggestInput(props: SuggestInputProps) {
  const { id, value, onChange, suggestions, onPick, action, moreText, showEmpty, openOnFocus, autoActivate, inputRef } = props;
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<CSSProperties>({});
  const own = useRef<HTMLInputElement | null>(null);
  const query = props.query ?? value;

  const count = suggestions.length + (action ? 1 : 0);
  const empty = showEmpty && suggestions.length === 0 && query.trim() !== '';
  // без ввода список показывается только у выбора из справочника (openOnFocus): пустая строка товара не закрывает таблицу подсказками
  const visible = open && !props.disabled && (openOnFocus || value.trim() !== '') && (count > 0 || empty);

  // список меняется при вводе — подсвеченный пункт не должен указывать за его конец
  useEffect(() => { if (active >= count) setActive(count - 1); }, [active, count]);

  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const el = own.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const width = Math.min(Math.max(r.width, 240), Math.max(vw - 16, 0));
      const left = Math.max(8, Math.min(r.left, vw - width - 8));
      const below = vh - r.bottom;
      const up = below < 180 && r.top > below;
      setPos(up ? { left, width, bottom: vh - r.top + 2, maxHeight: Math.max(r.top - 8, 120) }
        : { left, width, top: r.bottom + 2, maxHeight: Math.max(below - 8, 120) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [visible, value, count]);

  const setRef = (el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  const choose = (i: number) => {
    setOpen(false);
    setActive(-1);
    if (i < suggestions.length) onPick(suggestions[i]);
    else action?.onPick();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (count === 0) return;
      e.preventDefault();
      if (!open) { setOpen(true); setActive(e.key === 'ArrowDown' ? 0 : count - 1); return; }
      setActive((a) => (e.key === 'ArrowDown' ? Math.min(a + 1, count - 1) : Math.max(a - 1, 0)));
      return;
    }
    if (e.key === 'Enter' && visible && active >= 0 && active < count) {
      e.preventDefault(); e.stopPropagation();
      choose(active);
      return;
    }
    if (e.key === 'Escape' && visible) {
      e.preventDefault(); e.stopPropagation();
      setOpen(false); setActive(-1);
      return;
    }
    if (e.key === 'Tab') { setOpen(false); setActive(-1); }
    props.onKeyDown?.(e);
  };

  const optionId = (i: number) => `${listId}-${i}`;
  const item = (i: number, content: ReactNode, extra: { className?: string; dataValue?: string; key: string; name: string }) => (
    <li
      // имя для чтения с экрана — цельным текстом: подсветка совпадения не должна дробить его на части
      key={extra.key} id={optionId(i)} role="option" aria-selected={i === active} aria-label={extra.name} data-value={extra.dataValue}
      className={`suggest__item${i === active ? ' suggest__item--active' : ''}${extra.className ? ` ${extra.className}` : ''}`}
      // фокус остаётся в поле: иначе blur закроет список раньше нажатия (и на телефоне тоже)
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setActive(i)}
      onClick={() => choose(i)}
    >
      {content}
    </li>
  );

  return (
    <div className="suggest">
      <input
        id={id} ref={setRef} type="text" autoComplete="off" className={props.className ?? 'input'} value={value}
        placeholder={props.placeholder} disabled={props.disabled} inputMode={props.inputMode}
        role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
        aria-label={props['aria-label']} aria-invalid={props['aria-invalid']} aria-describedby={props['aria-describedby']}
        data-value={props['data-value']}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(autoActivate && e.target.value.trim() !== '' ? 0 : -1);
        }}
        onKeyDown={onKeyDown}
        onPaste={props.onPaste}
        onFocus={() => { if (openOnFocus) setOpen(true); props.onFocus?.(); }}
        onClick={() => { if (openOnFocus && !open) setOpen(true); }}
        onBlur={() => { setOpen(false); setActive(-1); props.onBlur?.(); }}
      />
      {visible ? (
        <div className="suggest__popup" style={pos}>
          {empty ? <div className="suggest__note">{NO_MATCHES_TEXT}</div> : null}
          {count > 0 ? (
            <ul className="suggest__list" role="listbox" id={listId} aria-label={props['aria-label'] ? `Подсказки: ${props['aria-label']}` : 'Подсказки'}>
              {suggestions.map((s, i) => item(i, (
                <>
                  <span className="suggest__label"><Highlight text={s.label ?? s.value} query={query} /></span>
                  {s.hint ? <span className="suggest__hint">{s.hint}</span> : null}
                </>
              ), { key: s.key, dataValue: s.value, name: s.hint ? `${s.label ?? s.value}, ${s.hint}` : (s.label ?? s.value) }))}
              {action ? item(suggestions.length, action.label, { key: '\u0000action', className: 'suggest__item--action', name: action.label }) : null}
            </ul>
          ) : null}
          {moreText && suggestions.length > 0 ? <div className="suggest__note">{moreText}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

// Числовое поле: принимает запятую и пробелы-разделители; нечисловой ввод остаётся в поле с ошибкой,
// а форма получает NaN — и не сохраняет (см. isBadNumber), вместо того чтобы молча держать прежнее число.

import { useEffect, useRef, useState } from 'react';
import { Field } from './Field';

export interface NumberFieldProps {
  label: string;
  /** NaN — в поле введено не число (так его отдаёт onChange). */
  value: number | undefined;
  /** Число; пусто — undefined; не число — NaN. */
  onChange: (value: number | undefined) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** Разбор числа, введённого человеком: «1 234,5» → 1234.5; пусто → undefined; мусор → null. */
export function parseUserNumber(text: string): number | undefined | null {
  const s = text.replace(/[\s ]/g, '').replace(',', '.');
  if (s === '') return undefined;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Значение из NumberField — неверный ввод (NaN): форма показывает ошибку и не сохраняет. */
export const isBadNumber = (v: unknown): boolean => typeof v === 'number' && Number.isNaN(v);

const show = (v: number | undefined) => (v === undefined || v === null || Number.isNaN(v) ? '' : String(v).replace('.', ','));

export function NumberField({ label, value, onChange, error, hint, required, placeholder, disabled, className }: NumberFieldProps) {
  const [text, setText] = useState(() => show(value));
  const [badInput, setBadInput] = useState(false);
  const lastEmitted = useRef<number | undefined>(value);

  // Значение сменили снаружи (не наш ввод) — показать его.
  useEffect(() => {
    if (!Object.is(value, lastEmitted.current)) {
      lastEmitted.current = value;
      setText(show(value));
      setBadInput(false);
    }
  }, [value]);

  return (
    <Field label={label} error={badInput ? 'Введите число' : error} hint={hint} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id} className="input input--number" type="text" inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            const n = parseUserNumber(t);
            const next = n === null ? Number.NaN : n;
            setBadInput(n === null);
            if (Object.is(next, lastEmitted.current)) return;
            lastEmitted.current = next;
            onChange(next);
          }}
        />
      )}
    </Field>
  );
}

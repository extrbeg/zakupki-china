// Шаг привязки «Разделитель аргументов в формулах» (G27, история 96): отмечено значение по локали таблицы, выбор — в «Настройки».

import { useId } from 'react';
import type { FormulaSeparator } from '../../../store/schema';
import { FORMULA_SEPARATOR_OPTIONS } from '../../../setup/formulaSeparator';
import './connect.css';

export const FORMULA_SEPARATOR_LABEL = 'Разделитель аргументов в формулах';

interface Props {
  value: FormulaSeparator;
  /** Разделитель по локали таблицы — подсказка рядом с вариантом. */
  locale: FormulaSeparator;
  disabled?: boolean;
  onChange: (sep: FormulaSeparator) => void;
}

export function FormulaSeparatorChoice({ value, locale, disabled, onChange }: Props) {
  const name = useId();
  return (
    <fieldset className="separator-choice" disabled={disabled}>
      <legend>{FORMULA_SEPARATOR_LABEL}</legend>
      <p className="muted small">
        Нужен для формул перевода в листе «Позиции». В таблице с русским языком (десятичная запятая) — точка с запятой,
        с английским — запятая. Отмечено по языку этой таблицы; поменять можно потом в «Настройках».
      </p>
      {FORMULA_SEPARATOR_OPTIONS.map((o) => (
        <label key={o.value} className="checkbox">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}{o.value === locale ? <span className="muted small"> — по языку таблицы</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

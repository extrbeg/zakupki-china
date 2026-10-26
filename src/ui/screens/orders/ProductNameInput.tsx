// Название товара с подсказками из прошлых позиций (история 93): строка быстрого ввода и полная форма позиции.
// Подсказки — «названия от заказчика» всех позиций, уникальные, свежие первыми (domain/productHints); справа серым — HS-код.

import { useMemo, type ClipboardEvent, type KeyboardEvent, type Ref } from 'react';
import { findProductHints, productHints, type ProductHint } from '../../../domain/productHints';
import { useData } from '../../DataContext';
import { SuggestInput } from '../../components';

/** Все подсказки товаров набора — для выбора и для поиска точного совпадения; `excludeLineId` — позиция, которую правят (не подсказывает сама себе). */
export function useProductHints(excludeLineId?: string): ProductHint[] {
  const { ds } = useData();
  return useMemo(
    () => productHints(excludeLineId ? { ...ds, lines: ds.lines.filter((l) => l.id !== excludeLineId) } : ds),
    [ds, excludeLineId],
  );
}

const FIELD_NAMES: [keyof ProductHint, string][] = [
  ['hsCode', 'HS-код'], ['dutyRate', 'пошлина'], ['packaging', 'упаковка'], ['packageSize', 'размер упаковки'],
  ['supplierName', 'название у поставщика'], ['weightPerUnit', 'вес'], ['cbmPerUnit', 'CBM'],
];

/** «Из прошлой позиции: HS-код, вес, CBM» — что подставится; нечего — пусто. */
export function fillNote(hint: ProductHint | undefined): string {
  const parts = hint ? FIELD_NAMES.filter(([k]) => hint[k] !== undefined).map(([, name]) => name) : [];
  return parts.length ? `Из прошлой позиции: ${parts.join(', ')}` : '';
}

export interface ProductNameInputProps {
  id?: string;
  value: string;
  onChange: (text: string) => void;
  onPickHint: (hint: ProductHint) => void;
  hints: ProductHint[];
  className?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void;
}

export function ProductNameInput({ hints, value, onPickHint, ...rest }: ProductNameInputProps) {
  const found = useMemo(() => findProductHints(hints, value), [hints, value]);
  return (
    <SuggestInput
      {...rest} value={value}
      suggestions={found.map((h) => ({ key: h.lineId, value: h.name, hint: h.hsCode ? `HS ${h.hsCode}` : undefined }))}
      onPick={(s) => { const h = found.find((x) => x.lineId === s.key); if (h) onPickHint(h); }}
    />
  );
}

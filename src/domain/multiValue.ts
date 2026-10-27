// Несколько значений в одной ячейке листа (специализации поставщика): «Мебель; Свет; Текстиль».
// Делим только по «;» — запятая остаётся частью значения («Краски, лаки»).

import { searchKey } from './search';

export const MULTI_VALUE_SEPARATOR = '; ';

/** Значения ячейки: без пустых и без повторов (без учёта регистра), в исходном порядке. */
export function splitMultiValue(cell: string | undefined): string[] {
  const seen = new Set<string>();
  return (cell ?? '').split(';').map((v) => v.trim()).filter((v) => v && !seen.has(searchKey(v)) && seen.add(searchKey(v)));
}

/** Ячейка из значений; пусто — undefined (поле не пишется). */
export function joinMultiValue(values: string[]): string | undefined {
  const cell = splitMultiValue(values.join(';')).join(MULTI_VALUE_SEPARATOR);
  return cell || undefined;
}

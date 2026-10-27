// Список поставщиков: поиск по тексту в выбранных полях (ни одно не выбрано — во всех), сортировка по названию.

import type { Supplier } from '../../domain/model';
import { compareRu, normalizeName } from './cityLookup';

export type SupplierSearchField =
  | 'name' | 'country' | 'province' | 'city' | 'companyType' | 'direction' | 'specialization' | 'products' | 'contactPerson';

/** Поля поиска в порядке кнопок на экране. */
export const SUPPLIER_SEARCH_FIELDS: readonly { key: SupplierSearchField; label: string }[] = [
  { key: 'name', label: 'Название' },
  { key: 'country', label: 'Страна' },
  { key: 'province', label: 'Провинция' },
  { key: 'city', label: 'Город' },
  { key: 'companyType', label: 'Тип компании' },
  { key: 'direction', label: 'Направление' },
  { key: 'specialization', label: 'Специализация' },
  { key: 'products', label: 'Продукция' },
  { key: 'contactPerson', label: 'Контактное лицо' },
];

export interface SupplierSearch { text: string; fields: SupplierSearchField[] }
export const NO_SEARCH: SupplierSearch = { text: '', fields: [] };

/**
 * Поставщики, у которых текст встречается (частью слова, без учёта регистра и «ё») хотя бы в одном из полей поиска.
 * `countryOf` — страна записи (у старых строк без страны — Китай, `placeCountry`).
 */
export function searchSuppliers(suppliers: Supplier[], search: SupplierSearch, countryOf: (s: Supplier) => string | undefined = (s) => s.country): Supplier[] {
  const q = normalizeName(search.text);
  const fields = search.fields.length ? search.fields : SUPPLIER_SEARCH_FIELDS.map((f) => f.key);
  const valueOf = (s: Supplier, f: SupplierSearchField) => (f === 'country' ? countryOf(s) : s[f]) ?? '';
  return suppliers
    .filter((s) => !q || fields.some((f) => normalizeName(valueOf(s, f)).includes(q)))
    .sort((a, b) => compareRu(a.name, b.name));
}

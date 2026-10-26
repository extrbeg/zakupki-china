// Список поставщиков: фильтры, поиск и группировка провинция → город.

import type { Supplier } from '../../domain/model';
import { compareRu, normalizeName } from './cityLookup';

export const NO_PROVINCE = 'Без провинции';
export const NO_CITY = 'Без города';

export interface SupplierFilters { search: string; province: string; city: string; specialization: string }
export const NO_FILTERS: SupplierFilters = { search: '', province: '', city: '', specialization: '' };

export interface CityGroup { city: string; suppliers: Supplier[] }
export interface ProvinceGroup { province: string; cities: CityGroup[] }

export function filterSuppliers(suppliers: Supplier[], f: SupplierFilters): Supplier[] {
  const q = normalizeName(f.search);
  return suppliers.filter((s) =>
    (!q || normalizeName(s.name).includes(q)) &&
    (!f.province || (s.province ?? '') === f.province) &&
    (!f.city || (s.city ?? '') === f.city) &&
    (!f.specialization || (s.specialization ?? '') === f.specialization));
}

/** Провинции по алфавиту, внутри — города по алфавиту, поставщики по названию; «Без …» — в конце. */
export function groupSuppliers(suppliers: Supplier[]): ProvinceGroup[] {
  const byProvince = new Map<string, Map<string, Supplier[]>>();
  for (const s of suppliers) {
    const p = (s.province ?? '').trim();
    const c = (s.city ?? '').trim();
    const cities = byProvince.get(p) ?? new Map<string, Supplier[]>();
    cities.set(c, [...(cities.get(c) ?? []), s]);
    byProvince.set(p, cities);
  }
  const lastBlank = (a: string, b: string) => (a === '' ? 1 : b === '' ? -1 : compareRu(a, b));
  return [...byProvince.entries()]
    .sort(([a], [b]) => lastBlank(a, b))
    .map(([province, cities]) => ({
      province: province || NO_PROVINCE,
      cities: [...cities.entries()]
        .sort(([a], [b]) => lastBlank(a, b))
        .map(([city, list]) => ({ city: city || NO_CITY, suppliers: [...list].sort((x, y) => compareRu(x.name, y.name)) })),
    }));
}

/** Значения для выпадающего фильтра: уникальные, непустые, по алфавиту. */
export function distinct(values: (string | undefined)[]): string[] {
  return [...new Set(values.map((v) => (v ?? '').trim()).filter(Boolean))].sort(compareRu);
}

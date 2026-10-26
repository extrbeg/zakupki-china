// Страна, провинции и города страны для полей места (поставщик, агент). Чистые функции без React и ввода-вывода.
// Страна у поставщика и агента хранится названием; город — по countryId (старые строки без него — Китай).

import { CHINA_COUNTRY_ID, CHINA_COUNTRY_NAME } from '../../data/geo';
import type { City, Country, Dataset } from '../../domain/model';
import type { SelectOption } from '../components';
import { compareRu, listProvinces, normalizeName } from './cityLookup';

/** Название Китая из справочника. В формах по умолчанию — `defaultCountryName(ds)`: Китай под его текущим названием. */
export const DEFAULT_COUNTRY = CHINA_COUNTRY_NAME;

type Geo = Pick<Dataset, 'countries' | 'provinces' | 'cities'>;

export function findCountry(ds: Pick<Dataset, 'countries'>, name: string | undefined): Country | undefined {
  const key = normalizeName(name ?? '');
  return key ? ds.countries.find((c) => normalizeName(c.name) === key) : undefined;
}

/** id Китая в наборе: справочный (под любым названием), иначе страна с названием «Китай». */
function chinaIdOf(ds: Pick<Dataset, 'countries'>): string {
  if (ds.countries.some((c) => c.id === CHINA_COUNTRY_ID)) return CHINA_COUNTRY_ID;
  return findCountry(ds, DEFAULT_COUNTRY)?.id ?? CHINA_COUNTRY_ID;
}

/** Страна по умолчанию (F3): запись Китая под её текущим названием (после «Китай» → «КНР» — «КНР»); нет записи — «Китай». */
export function defaultCountryName(ds: Pick<Dataset, 'countries'>): string {
  return ds.countries.find((c) => c.id === chinaIdOf(ds))?.name ?? DEFAULT_COUNTRY;
}

/** id страны по названию; «Китай», которого нет в «Странах» (старый набор или переименован), — id Китая. */
export function countryIdOf(ds: Pick<Dataset, 'countries'>, name: string | undefined): string | undefined {
  const found = findCountry(ds, name);
  if (found) return found.id;
  return normalizeName(name ?? '') === normalizeName(DEFAULT_COUNTRY) ? chinaIdOf(ds) : undefined;
}

/** Страна города; у старых строк без countryId — Китай. */
export function cityCountryOf(ds: Pick<Dataset, 'countries'>, c: Pick<City, 'countryId'>): string {
  return c.countryId?.trim() || chinaIdOf(ds);
}

/** Страна записи с местом: своя или, если указан город/провинция, — Китай под текущим названием (записи до G21). */
export function placeCountry(ds: Pick<Dataset, 'countries'>, p: { country?: string; city?: string; province?: string }): string | undefined {
  const own = (p.country ?? '').trim();
  if (own) return own;
  return (p.city ?? '').trim() || (p.province ?? '').trim() ? defaultCountryName(ds) : undefined;
}

/** Города страны (по названию страны). */
export function citiesOfCountry(ds: Pick<Dataset, 'countries' | 'cities'>, country: string | undefined): City[] {
  const id = countryIdOf(ds, country);
  return id ? ds.cities.filter((c) => cityCountryOf(ds, c) === id) : [];
}

/** Провинции страны: из «Провинций» и из её городов, без повторов, по алфавиту. */
export function provinceNamesOf(ds: Geo, country: string | undefined): string[] {
  const id = countryIdOf(ds, country);
  if (!id) return [];
  const names = new Map<string, string>();
  for (const p of ds.provinces) if (p.countryId === id && p.name.trim()) names.set(normalizeName(p.name), p.name.trim());
  for (const p of listProvinces(citiesOfCountry(ds, country))) if (!names.has(normalizeName(p))) names.set(normalizeName(p), p);
  return [...names.values()].sort(compareRu);
}

export function countryOptions(ds: Pick<Dataset, 'countries'>): SelectOption[] {
  return [...ds.countries].sort((a, b) => compareRu(a.name, b.name)).map((c) => ({ value: c.name, label: c.name }));
}

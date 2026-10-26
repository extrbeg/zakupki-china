// Логика экрана «География» (G21): дерево страны → провинции → города, поиск, проверка названий,
// запрет удаления используемого и переименование вместе со ссылками на название. Чистые функции.
// Провинция у города и место у поставщика/агента хранятся названиями, поэтому переименование переписывает и их.
// Изменения пишутся по одной записи; запись самой сущности — последней: при сбое на середине она ещё под старым
// названием, и повтор того же переименования находит и дописывает оставшиеся ссылки.

import type { City, Country, Dataset, PaymentAgent, Province, Supplier } from '../../../domain/model';
import { compareRu, normalizeName } from '../../directories/cityLookup';
import { cityCountryOf, placeCountry } from '../../directories/geography';

type Place = Supplier | PaymentAgent;

export type GeoChange =
  | { entity: 'countries'; record: Country }
  | { entity: 'provinces'; record: Province }
  | { entity: 'cities'; record: City }
  | { entity: 'suppliers'; record: Supplier }
  | { entity: 'agents'; record: PaymentAgent };

const same = (a: string | undefined, b: string | undefined) => normalizeName(a ?? '') === normalizeName(b ?? '');

const countryName = (ds: Pick<Dataset, 'countries'>, id: string) => ds.countries.find((c) => c.id === id)?.name ?? '';

export function sortedCountries(ds: Pick<Dataset, 'countries'>): Country[] {
  return [...ds.countries].sort((a, b) => compareRu(a.name, b.name));
}

export function provincesOfCountry(ds: Pick<Dataset, 'provinces'>, countryId: string): Province[] {
  return ds.provinces.filter((p) => p.countryId === countryId).sort((a, b) => compareRu(a.name, b.name));
}

export function citiesOfProvince(ds: Pick<Dataset, 'countries' | 'cities'>, countryId: string, province: string): City[] {
  return ds.cities.filter((c) => cityCountryOf(ds, c) === countryId && same(c.province, province)).sort((a, b) => compareRu(a.city, b.city));
}

const citiesOfCountryId = (ds: Pick<Dataset, 'countries' | 'cities'>, countryId: string) => ds.cities.filter((c) => cityCountryOf(ds, c) === countryId);

/** Поставщики/агенты в стране (без страны, но с местом — Китай). */
const placesIn = (ds: Pick<Dataset, 'countries'>, list: Place[], country: string) => list.filter((p) => same(placeCountry(ds, p), country));

function usageText(subject: string, parts: [label: string, n: number][]): string | null {
  const used = parts.filter(([, n]) => n > 0).map(([label, n]) => `${label} — ${n}`);
  return used.length ? `${subject} используется: ${used.join(', ')}` : null;
}

export function countryDeleteBlock(ds: Dataset, countryId: string): string | null {
  const name = countryName(ds, countryId);
  return usageText('Страна', [
    ['провинции', ds.provinces.filter((p) => p.countryId === countryId).length],
    ['города', citiesOfCountryId(ds, countryId).length],
    ['поставщики', placesIn(ds, ds.suppliers, name).length],
    ['агенты', placesIn(ds, ds.agents, name).length],
  ]);
}

export function provinceDeleteBlock(ds: Dataset, provinceId: string): string | null {
  const p = ds.provinces.find((x) => x.id === provinceId);
  if (!p) return null;
  const country = countryName(ds, p.countryId);
  const inProvince = (list: Place[]) => placesIn(ds, list, country).filter((x) => same(x.province, p.name)).length;
  return usageText('Провинция', [
    ['города', citiesOfProvince(ds, p.countryId, p.name).length],
    ['поставщики', inProvince(ds.suppliers)],
    ['агенты', inProvince(ds.agents)],
  ]);
}

const placesInCity = (ds: Dataset, list: Place[], city: City) =>
  placesIn(ds, list, countryName(ds, cityCountryOf(ds, city))).filter((x) => same(x.city, city.city) && (!x.province?.trim() || same(x.province, city.province)));

export function cityDeleteBlock(ds: Dataset, cityId: string): string | null {
  const city = ds.cities.find((c) => c.id === cityId);
  if (!city) return null;
  return usageText('Город', [['поставщики', placesInCity(ds, ds.suppliers, city).length], ['агенты', placesInCity(ds, ds.agents, city).length]]);
}

export const EMPTY_GEO_NAME_ERROR = 'Введите название';

/** '' — название подходит; иначе текст ошибки. Повтор среди соседей (без учёта регистра и пробелов) запрещён. */
export function validateGeoName(siblings: { id: string; name: string }[], name: string, selfId?: string): string {
  if (!name.trim()) return EMPTY_GEO_NAME_ERROR;
  const dup = siblings.find((s) => s.id !== selfId && same(s.name, name));
  return dup ? `Уже есть: ${dup.name}` : '';
}

const placeChanges = (list: Place[], entity: 'suppliers' | 'agents', match: (p: Place) => boolean, patch: Partial<Place>): GeoChange[] =>
  list.filter(match).map((p) => ({ entity, record: { ...p, ...patch } }) as GeoChange);

export function renameCountry(ds: Dataset, countryId: string, name: string): GeoChange[] {
  const country = ds.countries.find((c) => c.id === countryId);
  if (!country) return [];
  const next = name.trim();
  const match = (p: Place) => same(placeCountry(ds, p), country.name);
  return [
    ...placeChanges(ds.suppliers, 'suppliers', match, { country: next }),
    ...placeChanges(ds.agents, 'agents', match, { country: next }),
    { entity: 'countries', record: { ...country, name: next } },
  ];
}

export function renameProvince(ds: Dataset, provinceId: string, name: string): GeoChange[] {
  const p = ds.provinces.find((x) => x.id === provinceId);
  if (!p) return [];
  const next = name.trim();
  const country = countryName(ds, p.countryId);
  const match = (x: Place) => same(placeCountry(ds, x), country) && same(x.province, p.name);
  return [
    ...citiesOfProvince(ds, p.countryId, p.name).map((c): GeoChange => ({ entity: 'cities', record: { ...c, province: next } })),
    ...placeChanges(ds.suppliers, 'suppliers', match, { province: next }),
    ...placeChanges(ds.agents, 'agents', match, { province: next }),
    { entity: 'provinces', record: { ...p, name: next } },
  ];
}

export function renameCity(ds: Dataset, cityId: string, name: string): GeoChange[] {
  const city = ds.cities.find((c) => c.id === cityId);
  if (!city) return [];
  const next = name.trim();
  const inCity = (list: Place[]) => new Set(placesInCity(ds, list, city).map((p) => p.id));
  const sup = inCity(ds.suppliers);
  const agt = inCity(ds.agents);
  return [
    ...placeChanges(ds.suppliers, 'suppliers', (p) => sup.has(p.id), { city: next }),
    ...placeChanges(ds.agents, 'agents', (p) => agt.has(p.id), { city: next }),
    { entity: 'cities', record: { ...city, city: next } },
  ];
}

export interface GeoHit { kind: 'country' | 'province' | 'city'; id: string; name: string; path: string; countryId: string; province?: string }

/** Поиск по подстроке названия: страны, затем провинции, затем города; внутри — по названию и пути. */
export function searchGeography(ds: Dataset, query: string, limit = 50): GeoHit[] {
  const q = normalizeName(query);
  if (!q) return [];
  const has = (s: string) => normalizeName(s).includes(q);
  const byName = (a: GeoHit, b: GeoHit) => compareRu(a.name, b.name) || compareRu(a.path, b.path);
  const countries: GeoHit[] = ds.countries.filter((c) => has(c.name))
    .map((c) => ({ kind: 'country', id: c.id, name: c.name, path: '', countryId: c.id }));
  const provinces: GeoHit[] = ds.provinces.filter((p) => has(p.name))
    .map((p) => ({ kind: 'province', id: p.id, name: p.name, path: countryName(ds, p.countryId), countryId: p.countryId, province: p.name }));
  const cities: GeoHit[] = ds.cities.filter((c) => has(c.city)).map((c) => {
    const countryId = cityCountryOf(ds, c);
    return { kind: 'city', id: c.id, name: c.city, path: [countryName(ds, countryId), c.province].filter(Boolean).join(' › '), countryId, province: c.province };
  });
  return [...countries.sort(byName), ...provinces.sort(byName), ...cities.sort(byName)].slice(0, limit);
}

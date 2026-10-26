// Сохранение места «страна — провинция — город»: неизвестный город с провинцией попадает в справочник этой страны,
// новая провинция — в «Провинции» страны; страна, которой ещё нет в «Странах», заводится там.

import { newId } from '../../domain/ids';
import { CHINA_COUNTRY_ID } from '../../data/geo';
import type { DataApi } from '../DataContext';
import { findCity, normalizeName } from './cityLookup';
import { citiesOfCountry, defaultCountryName, DEFAULT_COUNTRY, findCountry, provinceNamesOf } from './geography';

export interface CityPair { city?: string; province?: string; country?: string }

type Data = Pick<DataApi, 'ds' | 'save'>;

/** Найти страну по названию или завести её. Возвращает id. */
export async function ensureCountry(data: Data, name: string): Promise<string> {
  const found = findCountry(data.ds, name);
  if (found) return found.id;
  const isChina = normalizeName(name) === normalizeName(DEFAULT_COUNTRY) && !data.ds.countries.some((c) => c.id === CHINA_COUNTRY_ID);
  const id = isChina ? CHINA_COUNTRY_ID : newId('cnt');
  await data.save('countries', { id, name: name.trim() });
  return id;
}

/**
 * Приводит город к написанию из справочника страны и добавляет новую пару в `cities` (и новую провинцию в `provinces`).
 * Провинция из формы главнее справочной. Страна по умолчанию — Китай под текущим названием (F3).
 */
export async function resolveCityPair(data: Data, city?: string, province?: string, country?: string): Promise<CityPair> {
  const countryName = country?.trim() || defaultCountryName(data.ds);
  const name = (city ?? '').trim();
  const prov = (province ?? '').trim() || undefined;
  const cities = citiesOfCountry(data.ds, countryName);
  const known = name ? findCity(cities, name, prov) : undefined;
  if (known) return { city: known.city, province: prov ?? known.province, country: countryName };
  if (!prov) return { city: name || undefined, province: undefined, country: countryName };
  const knownProvince = provinceNamesOf(data.ds, countryName).some((p) => normalizeName(p) === normalizeName(prov));
  const needsWrite = !knownProvince || name !== '';
  const countryId = needsWrite ? await ensureCountry(data, countryName) : undefined;
  if (!knownProvince && countryId) await data.save('provinces', { id: newId('prv'), name: prov, countryId });
  if (name && countryId) await data.save('cities', { id: newId('city'), city: name, province: prov, countryId });
  return { city: name || undefined, province: prov, country: countryName };
}

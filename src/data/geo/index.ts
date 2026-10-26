// Справочник географии: страна «Китай» с провинциями и городами (данные — china.ts) и план его внесения в таблицу.
// Чистые функции без ввода-вывода: план считает setup (таблица), демо-набор и импорт старой таблицы.
// Правило внесения: ничего не удаляется и заполненное пользователем не перезаписывается; повторный план после применения пуст.

import { newId } from '../../domain/ids';
import type { City, Country, Dataset, Province } from '../../domain/model';
import { CHINA_CITIES, CHINA_COUNTRY_NAME, CHINA_PROVINCES } from './china';

export { CHINA_CITIES, CHINA_COUNTRY_NAME, CHINA_PROVINCES } from './china';

/** Версия справочника: метка `geoVersion` в «_meta». Поднять при изменении china.ts — справочник довнесётся при входе. */
export const GEO_VERSION = '1';
/** id страны «Китай», который получает новая таблица; города старых строк без countryId считаются городами этой страны. */
export const CHINA_COUNTRY_ID = 'cnt_china';

export type GeoData = Pick<Dataset, 'countries' | 'provinces' | 'cities'>;

export interface GeoSeedPlan {
  countries: Country[];
  provinces: Province[];
  cities: City[];
  /** Существующие города с заполненными пустыми полями (провинция, страна, население) — запись целиком. */
  cityUpdates: City[];
}

/** Ключ сравнения названий: без регистра, крайних и повторных пробелов, ё = е. */
export const geoKey = (s: string | undefined): string => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Провинции Китая каждого названия города (по ключу) — для подстановки провинции. */
const provincesByCity: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const c of CHINA_CITIES) {
    const k = geoKey(c.city);
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(c.province);
  }
  return m;
})();

/** Провинция города Китая по справочнику; город в нескольких провинциях или неизвестный — undefined. */
export function chinaProvinceOf(city: string | undefined): string | undefined {
  const set = provincesByCity.get(geoKey(city));
  return set && set.size === 1 ? [...set][0] : undefined;
}

/** Провинция самого крупного по населению тёзки из справочника (население не указано — после указанного; равные — первый). */
export function chinaLargestProvinceOf(city: string | undefined): string | undefined {
  const k = geoKey(city);
  if (!k) return undefined;
  let best: (typeof CHINA_CITIES)[number] | undefined;
  for (const c of CHINA_CITIES) {
    if (geoKey(c.city) === k && (!best || (c.population ?? -1) > (best.population ?? -1))) best = c;
  }
  return best?.province;
}

/** Население пар «город — провинция» Китая по справочнику (ключ — geoKey обоих). */
const populationByPair: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const c of CHINA_CITIES) {
    const k = `${geoKey(c.city)}|${geoKey(c.province)}`;
    if (c.population !== null && !m.has(k)) m.set(k, c.population);
  }
  return m;
})();

/** Население города Китая по справочнику — точной пары «город — провинция»; не указано или пары нет — undefined. */
export function chinaPopulationOf(city: string | undefined, province: string | undefined): number | undefined {
  return populationByPair.get(`${geoKey(city)}|${geoKey(province)}`);
}

/** Страна города: в старых строках countryId нет — это Китай. */
export const cityCountryId = (c: Pick<City, 'countryId'>): string => c.countryId?.trim() || CHINA_COUNTRY_ID;

/**
 * Что дописать в справочник, чтобы в нём были Китай, его 33 провинции и города; пустые провинции и страны городов заполняются
 * (провинция неоднозначного названия — провинцией самого крупного тёзки, иначе строка старой таблицы осталась бы дублем без провинции).
 */
export function planGeoSeed(current: GeoData): GeoSeedPlan {
  const plan: GeoSeedPlan = { countries: [], provinces: [], cities: [], cityUpdates: [] };
  const usedIds = new Set<string>([...current.countries, ...current.provinces, ...current.cities].map((r) => r.id));
  const freshId = (wanted: string, prefix: string) => {
    const id = wanted && !usedIds.has(wanted) ? wanted : newId(prefix);
    usedIds.add(id);
    return id;
  };

  // Страна: по id справочника (пользователь мог переименовать), затем по названию.
  let china = current.countries.find((c) => c.id === CHINA_COUNTRY_ID)
    ?? current.countries.find((c) => geoKey(c.name) === geoKey(CHINA_COUNTRY_NAME));
  if (!china) {
    china = { id: freshId(CHINA_COUNTRY_ID, 'cnt'), name: CHINA_COUNTRY_NAME };
    plan.countries.push(china);
  }
  const chinaId = china.id;

  // Провинции Китая: справочные и те, что уже указаны у городов Китая.
  const haveProvince = new Set(current.provinces.filter((p) => p.countryId === chinaId).map((p) => geoKey(p.name)));
  const addProvince = (name: string, wantedId: string) => {
    const k = geoKey(name);
    if (!k || haveProvince.has(k)) return;
    haveProvince.add(k);
    plan.provinces.push({ id: freshId(wantedId, 'prv'), name: name.trim(), countryId: chinaId });
  };
  for (const name of CHINA_PROVINCES) addProvince(name, `prv_cn_${slug(name)}`);

  // Существующие города: заполнить пустые страну и провинцию.
  const cities = current.cities.map((c) => {
    const next: City = { ...c };
    if (!c.countryId?.trim()) next.countryId = chinaId;
    if (next.countryId === chinaId && !c.province?.trim()) {
      // у тёзок в разных провинциях — провинция самого крупного, как при вводе в форме
      const province = chinaLargestProvinceOf(c.city);
      if (province) next.province = province;
      // своего населения нет — справочное, иначе мелкий тёзка из справочника обгонял бы эту строку в подсказках
      const population = province && c.population === undefined ? chinaPopulationOf(c.city, province) : undefined;
      if (population !== undefined) next.population = population;
    }
    if (next.countryId !== c.countryId || next.province !== c.province || next.population !== c.population) plan.cityUpdates.push(next);
    return next;
  });
  for (const c of cities) if (c.countryId === chinaId && c.province?.trim()) addProvince(c.province, '');

  // Недостающие города справочника (пара «город — провинция» без повторов).
  const havePair = new Set(cities.filter((c) => c.countryId === chinaId).map((c) => `${geoKey(c.city)}|${geoKey(c.province)}`));
  CHINA_CITIES.forEach((src, i) => {
    const k = `${geoKey(src.city)}|${geoKey(src.province)}`;
    if (havePair.has(k)) return;
    havePair.add(k);
    const city: City = { id: freshId(`city_cn_${i + 1}`, 'city'), city: src.city, province: src.province, countryId: chinaId };
    if (src.population !== null) city.population = src.population;
    plan.cities.push(city);
  });
  return plan;
}

/** Применить план к набору в памяти (демо-набор, тесты): обновления на месте, новое — в конец. */
export function applyGeoSeed<T extends GeoData>(data: T, plan: GeoSeedPlan): T {
  const upd = new Map(plan.cityUpdates.map((c) => [c.id, c]));
  return {
    ...data,
    countries: [...data.countries, ...plan.countries],
    provinces: [...data.provinces, ...plan.provinces],
    cities: [...data.cities.map((c) => upd.get(c.id) ?? c), ...plan.cities],
  };
}

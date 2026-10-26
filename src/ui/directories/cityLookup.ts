// Справочник городов: поиск, подсказки и автоподстановка провинции. Чистые функции без React и без ввода-вывода.

import type { City } from '../../domain/model';
import { chinaPopulationOf } from '../../data/geo';
import { searchKey } from '../../domain/search';

/** Сравнение названий без учёта регистра, лишних пробелов и «ё/е» — тот же ключ, что у поиска при вводе. */
export const normalizeName = searchKey;

export const compareRu = (a: string, b: string): number => a.localeCompare(b, 'ru');

/** Население строки; своего нет — справочное для той же пары «город — провинция» Китая (старые строки без населения). */
const population = (c: City) => c.population ?? chinaPopulationOf(c.city, c.province) ?? -1;
/** Крупнее — раньше (население не указано — после указанного); равные — в порядке справочника. */
const byPopulation = (a: City, b: City) => population(b) - population(a);
const hasProvince = (c: City) => ((c.province ?? '').trim() ? 1 : 0);
/** Строка с провинцией — раньше строки без неё (старый импорт), затем по населению. */
const byProvinceThenPopulation = (a: City, b: City) => hasProvince(b) - hasProvince(a) || byPopulation(a, b);

/** Город по названию; с провинцией — сначала точная пара, иначе самый крупный из одноимённых с провинцией (F1). */
export function findCity(cities: City[], name: string | undefined, province?: string): City | undefined {
  const key = normalizeName(name ?? '');
  if (!key) return undefined;
  const prov = normalizeName(province ?? '');
  const same = cities.filter((c) => normalizeName(c.city) === key).sort(byProvinceThenPopulation);
  return (prov ? same.find((c) => normalizeName(c.province ?? '') === prov) : undefined) ?? same[0];
}

/** Разные провинции одноимённых городов (без пустых): провинция самого крупного тёзки — первой. */
export function cityProvinces(cities: City[], name: string | undefined): string[] {
  const key = normalizeName(name ?? '');
  if (!key) return [];
  const out = new Map<string, string>();
  for (const c of cities.filter((x) => normalizeName(x.city) === key).sort(byPopulation)) {
    const p = (c.province ?? '').trim();
    if (p && !out.has(normalizeName(p))) out.set(normalizeName(p), p);
  }
  return [...out.values()];
}

/** Подсказки по началу ввода: сначала города, начинающиеся с запроса, затем содержащие его. */
export function suggestCities(cities: City[], query: string | undefined, limit = 30): City[] {
  const key = normalizeName(query ?? '');
  // тёзки — по убыванию населения (F2)
  const sorted = [...cities].sort((a, b) => compareRu(a.city, b.city) || byPopulation(a, b) || compareRu(a.province ?? '', b.province ?? ''));
  if (!key) return sorted.slice(0, limit);
  const starts = sorted.filter((c) => normalizeName(c.city).startsWith(key));
  const contains = sorted.filter((c) => !normalizeName(c.city).startsWith(key) && normalizeName(c.city).includes(key));
  return [...starts, ...contains].slice(0, limit);
}

/** Разделитель «город — провинция» в подсказке одноимённых городов. */
export const CITY_PROVINCE_SEPARATOR = ' — ';

export interface CityOption { key: string; value: string; label: string; city: string; province: string }

/**
 * Пункты подсказки города: одноимённые города разных провинций — значением «Taizhou — Zhejiang»
 * (выбор подставляет нужную провинцию), остальные — названием с провинцией в подписи.
 */
export function cityOptions(cities: City[], query: string | undefined, limit = 30): CityOption[] {
  const seen = new Set<string>();
  const out: CityOption[] = [];
  for (const c of suggestCities(cities, query, limit)) {
    const province = (c.province ?? '').trim();
    const ambiguous = cityProvinces(cities, c.city).length > 1;
    const value = ambiguous && province ? `${c.city}${CITY_PROVINCE_SEPARATOR}${province}` : c.city;
    if (seen.has(normalizeName(value))) continue;
    seen.add(normalizeName(value));
    out.push({ key: c.id, value, label: ambiguous ? '' : province, city: c.city, province });
  }
  return out;
}

/** Ввод — выбранная подсказка «город — провинция» известной пары? */
export function parseCityOption(cities: City[], text: string): { city: string; province: string } | null {
  const at = text.lastIndexOf(CITY_PROVINCE_SEPARATOR);
  if (at <= 0) return null;
  const city = text.slice(0, at);
  const province = text.slice(at + CITY_PROVINCE_SEPARATOR.length);
  const match = cities.find((c) => normalizeName(c.city) === normalizeName(city) && normalizeName(c.province ?? '') === normalizeName(province));
  return match ? { city: match.city, province: match.province } : null;
}

export function listProvinces(cities: City[]): string[] {
  return [...new Set(cities.map((c) => (c.province ?? '').trim()).filter(Boolean))].sort(compareRu);
}

export interface CityDraft { city?: string; province?: string }

/**
 * Ввод города: известный город подставляет свою провинцию; выбор «город — провинция» — именно эту.
 * Город из нескольких провинций подставляет провинцию самого крупного тёзки (F1); выбранная раньше для того же города — остаётся.
 * Если город стал неизвестным, а провинция была подставлена прежним городом — она снимается; поправленная руками остаётся.
 */
export function applyCityInput(cities: City[], prev: CityDraft, nextCity: string): CityDraft {
  const picked = parseCityOption(cities, nextCity);
  if (picked) return picked;
  const provinces = cityProvinces(cities, nextCity);
  if (provinces.length === 1) return { city: nextCity, province: provinces[0] };
  const prevProvinces = cityProvinces(cities, prev.city);
  const prevProv = normalizeName(prev.province ?? '');
  const autoFilled = prevProv !== '' && prevProvinces.some((p) => normalizeName(p) === prevProv);
  if (provinces.length > 1) {
    const sameCity = normalizeName(prev.city ?? '') === normalizeName(nextCity);
    const keep = sameCity ? provinces.find((p) => normalizeName(p) === prevProv) : undefined;
    return { city: nextCity, province: keep ?? provinces[0] };
  }
  return { city: nextCity, province: autoFilled ? undefined : prev.province };
}

export const NEW_CITY_PROVINCE_ERROR = 'Для нового города выберите провинцию';
/** Новый (неизвестный справочнику) город требует провинции; известный берёт её из справочника (у тёзок — самого крупного). */
export function validateCityProvince(cities: City[], city: string | undefined, province: string | undefined): Record<string, string> {
  const name = (city ?? '').trim();
  if (!name || (province ?? '').trim()) return {};
  return findCity(cities, name) ? {} : { province: NEW_CITY_PROVINCE_ERROR };
}

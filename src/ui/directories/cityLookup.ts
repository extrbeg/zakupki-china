// Справочник городов: поиск, подсказки и автоподстановка провинции. Чистые функции без React и без ввода-вывода.

import type { City } from '../../domain/model';

/** Сравнение названий без учёта регистра, лишних пробелов и «ё/е». */
export const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

export const compareRu = (a: string, b: string): number => a.localeCompare(b, 'ru');

export function findCity(cities: City[], name: string | undefined): City | undefined {
  const key = normalizeName(name ?? '');
  if (!key) return undefined;
  return cities.find((c) => normalizeName(c.city) === key);
}

/** Подсказки по началу ввода: сначала города, начинающиеся с запроса, затем содержащие его. */
export function suggestCities(cities: City[], query: string | undefined, limit = 30): City[] {
  const key = normalizeName(query ?? '');
  const sorted = [...cities].sort((a, b) => compareRu(a.city, b.city));
  if (!key) return sorted.slice(0, limit);
  const starts = sorted.filter((c) => normalizeName(c.city).startsWith(key));
  const contains = sorted.filter((c) => !normalizeName(c.city).startsWith(key) && normalizeName(c.city).includes(key));
  return [...starts, ...contains].slice(0, limit);
}

export function listProvinces(cities: City[]): string[] {
  return [...new Set(cities.map((c) => c.province.trim()).filter(Boolean))].sort(compareRu);
}

export interface CityDraft { city?: string; province?: string }

/**
 * Ввод города: известный город подставляет свою провинцию. Если город стал неизвестным,
 * а провинция была подставлена прежним городом — она снимается; поправленная руками остаётся.
 */
export function applyCityInput(cities: City[], prev: CityDraft, nextCity: string): CityDraft {
  const match = findCity(cities, nextCity);
  if (match) return { city: nextCity, province: match.province };
  const prevMatch = findCity(cities, prev.city);
  const autoFilled = prevMatch !== undefined && prev.province === prevMatch.province;
  return { city: nextCity, province: autoFilled ? undefined : prev.province };
}

/** Новый (неизвестный справочнику) город требует провинции. */
export function validateCityProvince(cities: City[], city: string | undefined, province: string | undefined): Record<string, string> {
  const name = (city ?? '').trim();
  if (name && !findCity(cities, name) && !(province ?? '').trim()) {
    return { province: 'Для нового города выберите провинцию' };
  }
  return {};
}

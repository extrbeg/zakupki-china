// Справочник Китая в таблице пользователя (G20): в новую таблицу — сразу при привязке, в существующую — один раз при входе.
// Метка `geoVersion` в «_meta»: совпала — ничего не читается и не пишется. План (src/data/geo) ничего не удаляет
// и не перезаписывает заполненное, поэтому повтор после сбоя на середине безопасен.

import type { SheetsApi } from '../google/sheetsApi';
import { a1, rect } from '../google/a1';
import { GEO_VERSION, planGeoSeed } from '../data/geo';
import type { City } from '../domain/model';
import { sheetFor } from '../store/schema';
import { mapHeaders, SheetsStore, upsertKeyValue } from '../store/sheetsStore';
import { readMeta } from './installScript';

export interface GeoSeedReport { countries: number; provinces: number; cities: number; updatedCities: number }

const norm = (v: unknown) => String(v ?? '').trim();

/** Внести справочник Китая, если метка `geoVersion` устарела. Уже внесён — null без записей. Ошибки API — как есть. */
export async function ensureGeography(api: SheetsApi, spreadsheetId: string): Promise<GeoSeedReport | null> {
  const meta = await readMeta(api, spreadsheetId);
  if (meta.geoVersion === GEO_VERSION) return null;

  const store = new SheetsStore(api, spreadsheetId);
  const ds = await store.load();
  const plan = planGeoSeed(ds);

  await writeCityUpdates(api, spreadsheetId, plan.cityUpdates);
  if (plan.countries.length) await store.bulkInsert('countries', plan.countries);
  if (plan.provinces.length) await store.bulkInsert('provinces', plan.provinces);
  if (plan.cities.length) await store.bulkInsert('cities', plan.cities);
  await upsertKeyValue(api, spreadsheetId, sheetFor('meta').sheet, 'geoVersion', GEO_VERSION);

  return { countries: plan.countries.length, provinces: plan.provinces.length, cities: plan.cities.length, updatedCities: plan.cityUpdates.length };
}

/**
 * Заполненные провинции, страны и население существующих городов — одной записью на колонку (в старой таблице их сотни):
 * в диапазоне колонки значение стоит только у изменённых строк, остальные — null (Sheets их не трогает).
 */
async function writeCityUpdates(api: SheetsApi, spreadsheetId: string, updates: City[]): Promise<void> {
  if (updates.length === 0) return;
  const def = sheetFor('cities');
  const [rows] = await api.batchGet(spreadsheetId, [a1(def.sheet)]);
  const idx = mapHeaders(def, rows[0] ?? []);
  const col = (key: string) => idx[def.columns.findIndex((c) => c.key === key)];
  const idCol = col('id');
  const byId = new Map(updates.map((c) => [c.id, c]));
  for (const key of ['province', 'countryId', 'population'] as const) {
    const at = col(key);
    if (at < 0 || idCol < 0) continue;
    const values: (string | number | null)[][] = [];
    let last = 0;
    rows.forEach((row, r) => {
      if (r === 0) return;
      const next = byId.get(norm(row[idCol]));
      const value = next?.[key] ?? '';
      // «Население» — только в пустую ячейку: текст пользователя («~3 млн») не разбирается в число, но это его данные
      const free = key !== 'population' || norm(row[at]) === '';
      const changed = next !== undefined && value !== '' && free && String(value) !== norm(row[at]);
      values.push([changed ? value : null]);
      if (changed) last = values.length;
    });
    if (last === 0) continue;
    await api.update(spreadsheetId, rect(def.sheet, 2, at, last + 1, at), values.slice(0, last));
  }
}

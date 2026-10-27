// Разовое проставление при входе (G29, G33): поставкам без типа — тип по прежнему `mode`, затратам без номера —
// номера по порядку дат. Метка `codesVersion` в «_meta»: совпала — ничего не читается и не пишется.
// Запись — одной на колонку (null — ячейка не трогается), только в пустые ячейки: лист перечитывается прямо перед записью,
// и номер, вписанный руками (или другим устройством) после загрузки, не перезаписывается.

import type { SheetsApi } from '../google/sheetsApi';
import { a1, rect } from '../google/a1';
import type { EntityName } from '../domain/model';
import { planCostCodes } from '../domain/numbering';
import { planShipmentTypeIds } from '../domain/shipmentTypes';
import { sheetFor } from '../store/schema';
import { mapHeaders, SheetsStore, upsertKeyValue } from '../store/sheetsStore';
import { readMeta } from './installScript';

export const CODES_VERSION = '1';
export const CODES_META_KEY = 'codesVersion';

export interface CodesReport { shipmentTypes: number; costCodes: number }

const norm = (v: unknown) => String(v ?? '').trim();

/** Проставить типы поставок и номера затрат, если метка устарела. Уже сделано — null без записей. Ошибки API — как есть. */
export async function ensureCodes(api: SheetsApi, spreadsheetId: string): Promise<CodesReport | null> {
  const meta = await readMeta(api, spreadsheetId);
  if (meta[CODES_META_KEY] === CODES_VERSION) return null;

  const ds = await new SheetsStore(api, spreadsheetId).load();
  const types = planShipmentTypeIds(ds);
  const codes = planCostCodes(ds);
  const shipmentTypes = await fillEmpty(api, spreadsheetId, 'shipments', 'typeId', new Map(types.map((t) => [t.id, t.typeId])));
  const costCodes = await fillEmpty(api, spreadsheetId, 'costs', 'code', new Map(codes.map((c) => [c.id, c.code])));
  await upsertKeyValue(api, spreadsheetId, sheetFor('meta').sheet, CODES_META_KEY, CODES_VERSION);
  return { shipmentTypes, costCodes };
}

/** Записать значения в колонку `key` строк с этими id — только туда, где ячейка пуста. Возвращает число записанных. */
async function fillEmpty(api: SheetsApi, spreadsheetId: string, entity: EntityName, key: string, values: Map<string, string>): Promise<number> {
  if (values.size === 0) return 0;
  const def = sheetFor(entity);
  const [rows] = await api.batchGet(spreadsheetId, [a1(def.sheet)]);
  const idx = mapHeaders(def, rows[0] ?? []);
  const col = (k: string) => idx[def.columns.findIndex((c) => c.key === k)];
  const idCol = col('id');
  const at = col(key);
  if (!(idCol >= 0) || !(at >= 0)) return 0;
  const out: (string | null)[][] = [];
  let last = 0;
  let count = 0;
  rows.forEach((row, r) => {
    if (r === 0) return;
    const value = values.get(norm(row[idCol]));
    const write = value !== undefined && norm(row[at]) === '';
    out.push([write ? value : null]);
    if (write) { last = out.length; count++; }
  });
  if (last === 0) return 0;
  await api.update(spreadsheetId, rect(def.sheet, 2, at, last + 1, at), out.slice(0, last));
  return count;
}

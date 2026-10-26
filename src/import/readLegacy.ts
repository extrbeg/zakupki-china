// Чтение старой таблицы через Sheets API (файл выбран в Picker — доступ по drive.file).
// Читаются только видимые листы из шести (история 51); в старую таблицу ничего не пишется.

import type { SheetsApi } from '../google/sheetsApi';
import { a1 } from '../google/a1';
import { LEGACY_SHEETS, type LegacyRaw } from './types';

export const NO_LEGACY_SHEETS_TEXT = `В выбранной таблице нет листов старой таблицы («${LEGACY_SHEETS.join('», «')}»). Выберите таблицу «Закупки Китай AREC».`;

export async function readLegacy(api: SheetsApi, spreadsheetId: string): Promise<LegacyRaw> {
  const meta = await api.getMeta(spreadsheetId);
  const wanted = new Set<string>(LEGACY_SHEETS);
  const titles = meta.sheets.filter((s) => !s.hidden && wanted.has(s.title.trim())).map((s) => s.title);
  if (titles.length === 0) throw new Error(NO_LEGACY_SHEETS_TEXT);
  const values = await api.batchGet(spreadsheetId, titles.map((t) => a1(t)));
  const sheets: LegacyRaw['sheets'] = {};
  titles.forEach((t, i) => { sheets[t.trim()] = { hidden: false, values: values[i] ?? [] }; });
  return { sheets };
}

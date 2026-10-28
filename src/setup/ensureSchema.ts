// Приведение таблицы пользователя к схеме. Идемпотентно: создаёт недостающие листы и колонки,
// не удаляет и не переставляет существующее; чужую таблицу (лист схемы с данными без «id» в строке 1) не трогает вовсе; форматы ставит только тому, что создало само;
// «Списки» и «Типы поставки» заполняет, только если там нет данных; в «Настройки» дописывает недостающие ключи; версия схемы — в «_meta».

import type { SheetsApi } from '../google/sheetsApi';
import { a1, rect } from '../google/a1';
import { newId } from '../domain/ids';
import type { ListItem } from '../domain/model';
import { SCHEMA_VERSION, SHEETS, sheetFor, toRow, type ColType, type ColumnDef, type SheetDef } from '../store/schema';
import { mapHeaders, upsertKeyValue } from '../store/sheetsStore';
import { DEFAULT_COST_TYPES, DEFAULT_SETTINGS } from './defaults';
import { DEFAULT_UNITS } from '../domain/labels';
import { DEFAULT_SHIPMENT_TYPES } from '../domain/shipmentTypes';

export interface SchemaReport { createdSheets: string[]; addedColumns: { sheet: string; headers: string[] }[]; renamedColumns: { sheet: string; from: string; to: string }[] }

export const NOT_APP_SPREADSHEET_TEXT = 'Это не таблица приложения — для переноса используйте Импорт';

/** В таблице есть лист схемы с данными, но без заголовка «id» в строке 1 — это чужая (например, старая) таблица. */
export class NotAppSpreadsheetError extends Error {
  readonly sheets: string[];
  constructor(sheets: string[]) {
    super(NOT_APP_SPREADSHEET_TEXT);
    this.name = 'NotAppSpreadsheetError';
    this.sheets = sheets;
  }
}

const NUMBER_FORMATS: Partial<Record<ColType, { type: string; pattern: string }>> = {
  date: { type: 'DATE', pattern: 'dd.mm.yyyy' },
  datetime: { type: 'DATE_TIME', pattern: 'dd.mm.yyyy hh:mm' },
  number: { type: 'NUMBER', pattern: '#,##0.00##' },
  int: { type: 'NUMBER', pattern: '0' },
};

/** Листы, которые читаются целиком (нужно знать, есть ли в них данные). */
const READ_WHOLE = new Set(['lists', 'settings', 'meta', 'shipmentTypes']);

const norm = (v: unknown) => String(v ?? '').trim();

function formatRequests(sheetId: number, columns: { col: ColumnDef; at: number }[]): object[] {
  const out: object[] = [];
  for (const { col, at } of columns) {
    const fmt = NUMBER_FORMATS[col.type];
    if (!fmt) continue;
    out.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: at, endColumnIndex: at + 1 },
        cell: { userEnteredFormat: { numberFormat: fmt } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }
  return out;
}

export async function ensureSchema(api: SheetsApi, spreadsheetId: string): Promise<SchemaReport> {
  const report: SchemaReport = { createdSheets: [], addedColumns: [], renamedColumns: [] };
  let meta = await api.getMeta(spreadsheetId);
  const existing = new Set(meta.sheets.map((s) => s.title));
  const missing = SHEETS.filter((d) => !existing.has(d.sheet));

  // 1. Текущее содержимое существующих листов: заголовки (и всё — у небольших служебных)
  const present = SHEETS.filter((d) => existing.has(d.sheet));
  const read = present.length
    ? await api.batchGet(spreadsheetId, present.map((d) => (READ_WHOLE.has(d.entity) ? a1(d.sheet) : a1(d.sheet, '1:1'))))
    : [];
  const content = new Map<string, unknown[][]>();
  present.forEach((d, i) => content.set(d.sheet, read[i] ?? []));

  // 2. Проверка до первой записи: лист схемы с данными, но без «id» в строке 1 — таблица не наша, ничего не трогаем
  const hasId = (d: SheetDef) => d.columns.some((c) => c.key === 'id');
  const suspects = present.filter((d) => hasId(d) && !(content.get(d.sheet)?.[0] ?? []).some((h) => norm(h) === 'id'));
  if (suspects.length > 0) {
    const toRead = suspects.filter((d) => !READ_WHOLE.has(d.entity));
    const whole = toRead.length ? await api.batchGet(spreadsheetId, toRead.map((d) => a1(d.sheet))) : [];
    const full = new Map<string, unknown[][]>(toRead.map((d, i) => [d.sheet, whole[i] ?? []]));
    const foreign = suspects.filter((d) =>
      (full.get(d.sheet) ?? content.get(d.sheet) ?? []).slice(1).some((r) => r.some((v) => norm(v) !== '')));
    if (foreign.length > 0) throw new NotAppSpreadsheetError(foreign.map((d) => d.sheet));
  }

  // 3. Недостающие листы
  if (missing.length > 0) {
    await api.batchUpdate(spreadsheetId, missing.map((d) => ({
      addSheet: { properties: { title: d.sheet, gridProperties: { frozenRowCount: 1, columnCount: Math.max(26, d.columns.length) } } },
    })));
    report.createdSheets = missing.map((d) => d.sheet);
    meta = await api.getMeta(spreadsheetId);
  }
  const sheetIdOf = (title: string) => meta.sheets.find((s) => s.title === title)?.sheetId ?? 0;

  // 4. Заголовки и форматы
  const structure: object[] = [];
  const headerWrites: { range: string; values: unknown[][] }[] = [];
  const finalHeaders = new Map<string, unknown[]>();
  for (const def of SHEETS) {
    const sheetId = sheetIdOf(def.sheet);
    if (!existing.has(def.sheet)) {
      const headers = def.columns.map((c) => c.header);
      finalHeaders.set(def.sheet, headers);
      headerWrites.push({ range: rect(def.sheet, 1, 0, 1, headers.length - 1), values: [headers] });
      structure.push({
        repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' },
      });
      structure.push(...formatRequests(sheetId, def.columns.map((col, at) => ({ col, at }))));
      continue;
    }
    const current = [...(content.get(def.sheet)?.[0] ?? [])];
    // колонка под прежним названием (aliases) переименовывается — данные остаются на месте
    for (const col of def.columns) {
      if (current.some((h) => norm(h) === col.header)) continue;
      const at = (col.aliases ?? []).map((old) => current.findIndex((h) => norm(h) === old)).find((i) => i >= 0);
      if (at === undefined) continue;
      current[at] = col.header;
      report.renamedColumns.push({ sheet: def.sheet, from: norm(content.get(def.sheet)?.[0]?.[at]), to: col.header });
      headerWrites.push({ range: rect(def.sheet, 1, at, 1, at), values: [[col.header]] });
    }
    const have = new Set(current.map(norm));
    const add = def.columns.filter((c) => !have.has(c.header));
    if (add.length === 0) {
      finalHeaders.set(def.sheet, current);
      continue;
    }
    let start = current.length;
    while (start > 0 && norm(current[start - 1]) === '') start--;
    const headers = add.map((c) => c.header);
    report.addedColumns.push({ sheet: def.sheet, headers });
    finalHeaders.set(def.sheet, [...current.slice(0, start), ...headers]);
    structure.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: add.length } });
    structure.push(...formatRequests(sheetId, add.map((col, i) => ({ col, at: start + i }))));
    headerWrites.push({ range: rect(def.sheet, 1, start, 1, start + add.length - 1), values: [headers] });
  }
  if (structure.length > 0) await api.batchUpdate(spreadsheetId, structure);
  for (const w of headerWrites) await api.update(spreadsheetId, w.range, w.values);

  // 5. Значения по умолчанию
  const dataRows = (def: SheetDef) => (content.get(def.sheet) ?? []).slice(1).filter((r) => r.some((v) => norm(v) !== ''));
  const appendRecords = async (def: SheetDef, records: object[]) => {
    if (records.length === 0) return;
    const idx = mapHeaders(def, finalHeaders.get(def.sheet) ?? []);
    const width = Math.max(...idx) + 1;
    const rows = records.map((rec) => {
      const values = toRow(def, rec);
      const row: unknown[] = new Array(width).fill(null);
      def.columns.forEach((c, j) => { if (idx[j] >= 0 && c.type !== 'formula') row[idx[j]] = values[j]; });
      return row;
    });
    await api.append(spreadsheetId, a1(def.sheet, 'A1'), rows);
  };

  const lists = sheetFor('lists');
  const listRows = dataRows(lists);
  const listCol = mapHeaders(lists, finalHeaders.get(lists.sheet) ?? [])[lists.columns.findIndex((c) => c.key === 'list')];
  const items: ListItem[] = listRows.length === 0
    ? DEFAULT_COST_TYPES.map((value, i) => ({ id: newId('lst'), list: 'costType', value, order: i + 1 }))
    : [];
  // «Единицы измерения» появились позже остальных списков — дописываются и в таблицу, где их ещё нет
  if (!(listCol >= 0 && listRows.some((r) => norm(r[listCol]) === 'unit'))) {
    items.push(...DEFAULT_UNITS.map((value, i) => ({ id: newId('lst'), list: 'unit' as const, value, order: i + 1 })));
  }
  await appendRecords(lists, items);

  // G29: «Типы поставки» — заранее заведённые типы (постоянные id), только если в листе нет данных
  const shipmentTypes = sheetFor('shipmentTypes');
  if (dataRows(shipmentTypes).length === 0) await appendRecords(shipmentTypes, DEFAULT_SHIPMENT_TYPES.map((t) => ({ ...t })));

  const settings = sheetFor('settings');
  const settingsIdx = mapHeaders(settings, finalHeaders.get(settings.sheet) ?? []);
  const haveKeys = new Set(dataRows(settings).map((r) => norm(r[settingsIdx[0] >= 0 ? settingsIdx[0] : 0])));
  await appendRecords(settings, DEFAULT_SETTINGS.filter(([k]) => !haveKeys.has(k)).map(([key, value]) => ({ key, value })));

  const metaDef = sheetFor('meta');
  const metaIdx = mapHeaders(metaDef, finalHeaders.get(metaDef.sheet) ?? []);
  const kCol = metaIdx[0] >= 0 ? metaIdx[0] : 0;
  const vCol = metaIdx[1] >= 0 ? metaIdx[1] : 1;
  const versionRow = dataRows(metaDef).find((r) => norm(r[kCol]) === 'schemaVersion');
  if (!versionRow) await appendRecords(metaDef, [{ key: 'schemaVersion', value: String(SCHEMA_VERSION) }]);
  else if (norm(versionRow[vCol]) !== String(SCHEMA_VERSION)) await upsertKeyValue(api, spreadsheetId, metaDef.sheet, 'schemaVersion', String(SCHEMA_VERSION));

  return report;
}

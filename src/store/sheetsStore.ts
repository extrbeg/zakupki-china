// Хранилище в Google-таблице пользователя.
// Колонки ищутся по заголовкам строки 1: пользователь мог переставить колонки или дописать свои.
// Запись — построчно по id: перед update/remove колонка id перечитывается, чтобы не промахнуться при сдвиге строк.
// Значения пишутся RAW (числа — числами, даты — serial), формулы перевода — отдельным USER_ENTERED-запросом.

import type { Dataset, EntityName } from '../domain/model';
import { emptyDataset } from '../domain/model';
import type { SheetsApi } from '../google/sheetsApi';
import { a1, columnLetter, rect } from '../google/a1';
import { AuthError, GoogleApiError } from '../google/errors';
import { SHEETS, fromRow, sheetFor, toRow, type Cell, type SheetDef } from './schema';
import type { ReportRow, ReportSheet, Store } from './types';
import { StoreError } from './types';

type Rec = { id: string };

/** Любая ошибка слоя Google → StoreError нужного вида (для баннера в интерфейсе). */
export function toStoreError(e: unknown): StoreError {
  if (e instanceof StoreError) return e;
  if (e instanceof AuthError) return new StoreError('auth', undefined, { cause: e });
  if (e instanceof GoogleApiError) {
    if (e.status === 0) return new StoreError('network', undefined, { cause: e });
    if (e.status === 401 || e.status === 403) return new StoreError('auth', undefined, { cause: e });
    if (e.status === 404) return new StoreError('notFound', 'Таблица не найдена или нет доступа', { cause: e });
    return new StoreError('unknown', undefined, { cause: e });
  }
  if (e instanceof TypeError) return new StoreError('network', undefined, { cause: e });
  return new StoreError('unknown', undefined, { cause: e });
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toStoreError(e);
  }
}

const norm = (v: unknown) => String(v ?? '').trim();

/** Индекс колонки листа для каждой колонки схемы (по заголовку); -1 — колонки нет. */
export function mapHeaders(def: SheetDef, headerRow: unknown[]): number[] {
  const headers = headerRow.map(norm);
  return def.columns.map((c) => headers.indexOf(c.header));
}

/** Строка листа → строка в порядке схемы. */
function reorder(idx: number[], row: unknown[]): unknown[] {
  return idx.map((i) => (i >= 0 ? row[i] ?? '' : ''));
}

/** Записать пару ключ — значение в лист «Настройки»/«_meta»: найти строку по ключу или дописать новую. */
export async function upsertKeyValue(api: SheetsApi, spreadsheetId: string, sheet: string, key: string, value: string): Promise<void> {
  const def = SHEETS.find((d) => d.sheet === sheet) ?? sheetFor('settings');
  const [rows] = await api.batchGet(spreadsheetId, [a1(sheet)]);
  const idx = mapHeaders(def, rows[0] ?? []);
  const keyCol = idx[0] >= 0 ? idx[0] : 0;
  const valCol = idx[1] >= 0 ? idx[1] : 1;
  const r = rows.findIndex((row, i) => i > 0 && norm(row[keyCol]) === key);
  if (r > 0) {
    await api.update(spreadsheetId, rect(sheet, r + 1, valCol, r + 1, valCol), [[value]]);
    return;
  }
  const row: Cell[] = new Array(Math.max(keyCol, valCol) + 1).fill(null);
  row[keyCol] = key;
  row[valCol] = value;
  await api.append(spreadsheetId, a1(sheet, 'A1'), [row]);
}

interface Located { idx: number[]; ids: string[] }   // ids[r-1] — id в строке r

export class SheetsStore implements Store {
  readonly kind = 'sheets' as const;
  private sheetIds = new Map<string, number>();

  constructor(readonly api: SheetsApi, readonly spreadsheetId: string) {}

  load(): Promise<Dataset> {
    return guarded(async () => {
      const meta = await this.api.getMeta(this.spreadsheetId);
      this.rememberSheets(meta.sheets);
      const existing = new Set(meta.sheets.map((s) => s.title));
      const defs = SHEETS.filter((d) => d.entity !== 'log' && existing.has(d.sheet));
      const ds = emptyDataset();
      if (defs.length === 0) return ds;
      const all = await this.api.batchGet(this.spreadsheetId, defs.map((d) => a1(d.sheet)));
      defs.forEach((def, i) => {
        const rows = all[i] ?? [];
        const idx = mapHeaders(def, rows[0] ?? []);
        for (const row of rows.slice(1)) {
          const rec = fromRow(def, reorder(idx, row));
          if (def.entity === 'settings' || def.entity === 'meta') {
            const key = norm(rec.key);
            if (key) ds[def.entity][key] = rec.value === undefined ? '' : String(rec.value);
          } else if (typeof rec.id === 'string' && rec.id.trim()) {
            (ds[def.entity as EntityName] as unknown[]).push(rec);
          }
        }
      });
      return ds;
    });
  }

  insert<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    return this.bulkInsertInner(entity, [record as Rec]);
  }

  bulkInsert<E extends EntityName>(entity: E, records: Dataset[E]): Promise<void> {
    return this.bulkInsertInner(entity, records as Rec[]);
  }

  update<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    return guarded(async () => {
      const def = sheetFor(entity);
      const loc = await this.locate(def);
      const r = this.rowOf(loc, (record as Rec).id);
      const row = this.buildRow(def, loc.idx, record);
      await this.api.update(this.spreadsheetId, rect(def.sheet, r, 0, r, row.length - 1), [row]);
      await this.writeFormulas(def, loc.idx, [r]);
    });
  }

  remove(entity: EntityName, id: string): Promise<void> {
    return guarded(async () => {
      const def = sheetFor(entity);
      const loc = await this.locate(def);
      const r = this.rowOf(loc, id);
      const sheetId = await this.sheetId(def.sheet);
      await this.api.batchUpdate(this.spreadsheetId, [
        { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } },
      ]);
    });
  }

  setSetting(key: string, value: string): Promise<void> {
    return guarded(() => upsertKeyValue(this.api, this.spreadsheetId, sheetFor('settings').sheet, key, value));
  }

  writeReport(sheet: ReportSheet, rows: ReportRow[]): Promise<void> {
    return guarded(async () => {
      const meta = await this.api.getMeta(this.spreadsheetId);
      this.rememberSheets(meta.sheets);
      const found = meta.sheets.find((s) => s.title === sheet);
      if (found) {
        await this.api.batchUpdate(this.spreadsheetId, [{ updateCells: { range: { sheetId: found.sheetId }, fields: 'userEnteredValue' } }]);
      } else {
        await this.api.batchUpdate(this.spreadsheetId, [{ addSheet: { properties: { title: sheet } } }]);
        this.sheetIds.clear();
      }
      if (rows.length === 0) return;
      // append на пустой лист пишет с A1 и сам добавляет строки сетки, если отчёт длиннее листа
      await this.api.append(this.spreadsheetId, a1(sheet, 'A1'), rows.map((r) => r.map((v) => v ?? '')));
    });
  }

  // ---------- внутреннее ----------

  private bulkInsertInner(entity: EntityName, records: Rec[]): Promise<void> {
    return guarded(async () => {
      if (records.length === 0) return;
      const def = sheetFor(entity);
      const loc = await this.locate(def);
      const have = new Set(loc.ids);
      const seen = new Set<string>();
      for (const rec of records) {
        if (have.has(rec.id) || seen.has(rec.id)) throw new StoreError('conflict', `Запись с id «${rec.id}» уже есть`);
        seen.add(rec.id);
      }
      await this.api.append(this.spreadsheetId, a1(def.sheet, 'A1'), records.map((rec) => this.buildRow(def, loc.idx, rec)));
      if (!def.columns.some((c) => c.type === 'formula')) return;
      const after = await this.locate(def);
      const rowNums = records.map((rec) => this.rowOf(after, rec.id));
      await this.writeFormulas(def, after.idx, rowNums);
    });
  }

  /** Перечитать заголовки и колонку id листа. Обычно id — колонка A, тогда это один запрос. */
  private async locate(def: SheetDef): Promise<Located> {
    const [header, colA] = await this.api.batchGet(this.spreadsheetId, [a1(def.sheet, '1:1'), a1(def.sheet, 'A:A')]);
    const idx = mapHeaders(def, header[0] ?? []);
    const idCol = idx[def.columns.findIndex((c) => c.key === 'id')];
    if (idCol === undefined || idCol < 0) throw new StoreError('unknown', `В листе «${def.sheet}» нет колонки id — переподключите таблицу`);
    let column = colA;
    if (idCol !== 0) {
      const L = columnLetter(idCol);
      [column] = await this.api.batchGet(this.spreadsheetId, [a1(def.sheet, `${L}:${L}`)]);
    }
    return { idx, ids: column.map((row) => norm(row?.[0])) };
  }

  private rowOf(loc: Located, id: string): number {
    const i = loc.ids.findIndex((v, j) => j > 0 && v === id);
    if (i < 1) throw new StoreError('notFound');
    return i + 1;
  }

  /** Строка для RAW-записи: значения схемы в колонках с нужными заголовками; чужие и формульные колонки — null (не трогать). */
  private buildRow(def: SheetDef, idx: number[], record: object): Cell[] {
    const values = toRow(def, record);
    const width = Math.max(...idx) + 1;
    const row: Cell[] = new Array(width).fill(null);
    def.columns.forEach((c, j) => {
      if (idx[j] >= 0 && c.type !== 'formula') row[idx[j]] = values[j];
    });
    return row;
  }

  /** Формульные колонки — отдельным USER_ENTERED-запросом на каждый непрерывный блок строк. */
  private async writeFormulas(def: SheetDef, idx: number[], rowNums: number[]): Promise<void> {
    const cols = def.columns
      .map((c, j) => ({ c, at: idx[j] }))
      .filter(({ c, at }) => c.type === 'formula' && c.formula && at >= 0);
    if (cols.length === 0 || rowNums.length === 0) return;
    const refCol = (key: string) => idx[def.columns.findIndex((c) => c.key === key)];
    const usable = cols.filter(({ c }) => {
      let ok = true;
      c.formula!((key) => { if (!(refCol(key) >= 0)) ok = false; return 'A1'; });
      return ok;
    });
    if (usable.length === 0) return;
    const minCol = Math.min(...usable.map((u) => u.at));
    const maxCol = Math.max(...usable.map((u) => u.at));
    const sorted = [...rowNums].sort((a, b) => a - b);
    const runs: number[][] = [];
    for (const r of sorted) {
      const last = runs[runs.length - 1];
      if (last && r === last[last.length - 1] + 1) last.push(r);
      else runs.push([r]);
    }
    for (const run of runs) {
      const values = run.map((r) => {
        const row: Cell[] = new Array(maxCol - minCol + 1).fill(null);
        for (const { c, at } of usable) row[at - minCol] = c.formula!((key) => `${columnLetter(refCol(key))}${r}`);
        return row;
      });
      await this.api.update(this.spreadsheetId, rect(def.sheet, run[0], minCol, run[run.length - 1], maxCol), values, { valueInputOption: 'USER_ENTERED' });
    }
  }

  private rememberSheets(sheets: { title: string; sheetId: number }[]) {
    this.sheetIds = new Map(sheets.map((s) => [s.title, s.sheetId]));
  }

  private async sheetId(title: string): Promise<number> {
    if (!this.sheetIds.has(title)) this.rememberSheets((await this.api.getMeta(this.spreadsheetId)).sheets);
    const id = this.sheetIds.get(title);
    if (id === undefined) throw new StoreError('notFound', `В таблице нет листа «${title}»`);
    return id;
  }
}

// Хранилище в Google-таблице пользователя.
// Колонки ищутся по заголовкам строки 1: пользователь мог переставить колонки или дописать свои.
// Запись — построчно по id: перед update/remove колонка id перечитывается, чтобы не промахнуться при сдвиге строк.
// Значения пишутся RAW (числа — числами, даты — serial), формулы перевода — отдельным USER_ENTERED-запросом
// с разделителем аргументов из «Настройки» (formulaSeparator), а без настройки — по локали таблицы (G27).
// Строки, вбитые прямо в лист без id, при загрузке получают id (одна запись на лист, G26).

import type { Dataset, EntityName } from '../domain/model';
import { emptyDataset } from '../domain/model';
import { newId } from '../domain/ids';
import type { SheetsApi } from '../google/sheetsApi';
import { a1, columnLetter, rect } from '../google/a1';
import { AuthError, GoogleApiError } from '../google/errors';
import { SHEETS, fromRow, sheetFor, toRow, type Cell, type FormulaSeparator, type SheetDef } from './schema';
import type { ReportRow, ReportSheet, Store } from './types';
import { StoreError } from './types';

type Rec = { id: string };

/** Ключ листа «Настройки» с выбранным разделителем. */
export const FORMULA_SEPARATOR_KEY = 'formulaSeparator';

/** Значение настройки → разделитель; не «,» и не «;» — null. */
export function parseSeparator(value: unknown): FormulaSeparator | null {
  const v = String(value ?? '').trim();
  return v === ',' || v === ';' ? v : null;
}

/** Разделитель по локали таблицы (`ru_RU`, `en_US`): десятичная запятая → «;», иначе (и неизвестная локаль) — «,». */
export function separatorForLocale(locale: string | undefined): FormulaSeparator {
  if (!locale) return ',';
  try {
    return new Intl.NumberFormat(locale.replace(/_/g, '-')).format(1.5).includes(',') ? ';' : ',';
  } catch {
    return ',';
  }
}


/** Префикс id новой записи по сущности — те же, что у форм приложения. */
export const ID_PREFIX: Record<EntityName, string> = {
  rates: 'r', lists: 'lst', countries: 'cnt', provinces: 'prv', cities: 'city', suppliers: 'sup', agents: 'agt', carriers: 'car',
  orders: 'ord', supplierOrders: 'so', lines: 'ln', shipmentTypes: 'stp', shipments: 'shp', batches: 'bat', declarations: 'dec', costs: 'cst',
};

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

/** Индекс колонки листа для каждой колонки схемы (по заголовку, иначе по прежнему названию — `aliases`); -1 — колонки нет. */
export function mapHeaders(def: SheetDef, headerRow: unknown[]): number[] {
  const headers = headerRow.map(norm);
  return def.columns.map((c) => {
    const at = headers.indexOf(c.header);
    if (at >= 0) return at;
    for (const old of c.aliases ?? []) { const i = headers.indexOf(old); if (i >= 0) return i; }
    return -1;
  });
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


/** Формульные колонки листа, которые можно построить (все колонки-источники на месте), и ссылка на ячейку строки. */
function formulaColumns(def: SheetDef, idx: number[]) {
  const refCol = (key: string) => idx[def.columns.findIndex((c) => c.key === key)];
  const usable = def.columns
    .map((c, j) => ({ c, at: idx[j] }))
    .filter(({ c, at }) => {
      if (c.type !== 'formula' || !c.formula || !(at >= 0)) return false;
      let ok = true;
      c.formula((key) => { if (!(refCol(key) >= 0)) ok = false; return 'A1'; });
      return ok;
    });
  const build = (col: (typeof usable)[number], r: number, sep: FormulaSeparator) => col.c.formula!((key) => `${columnLetter(refCol(key))}${r}`, sep);
  return { usable, build };
}

/**
 * Переписать формулы перевода в «Позициях» с разделителем sep одним USER_ENTERED-запросом.
 * 'mismatched' — только ячейки с формулой перевода, записанной иначе (другой разделитель);
 * 'all' — ещё и пустые формульные ячейки строк с id (ячейку, где пользователь написал свой текст, не трогает).
 * Возвращает число переписанных ячеек.
 */
export async function rewriteTranslateFormulas(api: SheetsApi, spreadsheetId: string, sep: FormulaSeparator, mode: 'all' | 'mismatched'): Promise<number> {
  const def = sheetFor('lines');
  const [rows] = await api.batchGet(spreadsheetId, [a1(def.sheet)], { valueRenderOption: 'FORMULA' });
  const idx = mapHeaders(def, rows[0] ?? []);
  const { usable, build } = formulaColumns(def, idx);
  const idCol = idx[def.columns.findIndex((c) => c.key === 'id')];
  if (usable.length === 0) return 0;
  const targets = new Map<number, Map<number, string>>();   // номер строки → колонка → формула
  rows.forEach((row, i) => {
    if (i === 0) return;
    const r = i + 1;
    for (const u of usable) {
      const cur = norm(row[u.at]).toUpperCase();
      const want = build(u, r, sep);
      // формула приложения — только шаблон перевода этой строки с «,» или «;»; своя формула пользователя не трогается
      const ours = cur !== '' && (cur === build(u, r, ',').toUpperCase() || cur === build(u, r, ';').toUpperCase());
      const fits = ours
        ? cur !== want.toUpperCase()
        : mode === 'all' && cur === '' && idCol >= 0 && norm(row[idCol]) !== '';
      if (!fits) continue;
      if (!targets.has(r)) targets.set(r, new Map());
      targets.get(r)!.set(u.at, want);
    }
  });
  if (targets.size === 0) return 0;
  const rowNums = [...targets.keys()];
  const r1 = Math.min(...rowNums);
  const r2 = Math.max(...rowNums);
  const c1 = Math.min(...usable.map((u) => u.at));
  const c2 = Math.max(...usable.map((u) => u.at));
  const values: Cell[][] = [];
  let count = 0;
  for (let r = r1; r <= r2; r++) {
    const row: Cell[] = new Array(c2 - c1 + 1).fill(null);
    for (const [at, f] of targets.get(r) ?? []) { row[at - c1] = f; count++; }
    values.push(row);
  }
  await api.update(spreadsheetId, rect(def.sheet, r1, c1, r2, c2), values, { valueInputOption: 'USER_ENTERED' });
  return count;
}

/** Ключ «_meta»: разделитель, под который уже приведены формулы перевода (переписка при входе — один раз). */
export const FORMULA_SEPARATOR_META_KEY = 'formulaSeparatorApplied';

/** Отметить в «_meta», что формулы приведены к sep. Отметка не обязательна: без неё вход просто проверит формулы ещё раз. */
export async function markFormulaSeparator(api: SheetsApi, spreadsheetId: string, sep: FormulaSeparator): Promise<void> {
  try {
    await upsertKeyValue(api, spreadsheetId, sheetFor('meta').sheet, FORMULA_SEPARATOR_META_KEY, sep);
  } catch { /* повторится при следующем входе */ }
}

interface Located { idx: number[]; ids: string[] }   // ids[r-1] — id в строке r

export class SheetsStore implements Store {
  readonly kind = 'sheets' as const;
  private sheetIds = new Map<string, number>();
  private sep: FormulaSeparator | null = null;

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
      const missing: { def: SheetDef; idCol: number; rows: Map<number, { id: string; row: unknown[] }> }[] = [];
      defs.forEach((def, i) => {
        const rows = all[i] ?? [];
        const idx = mapHeaders(def, rows[0] ?? []);
        const keyed = def.entity === 'settings' || def.entity === 'meta';
        const idCol = keyed ? -1 : idx[def.columns.findIndex((c) => c.key === 'id')];
        // «есть данные» — непустая ячейка в колонке схемы (не id и не формула): чужие колонки и формулы перевода не в счёт
        // FALSE во флажке — не данные: Sheets отдаёт его во всех строках, где стоит флажок
        const dataCols = def.columns
          .map((c, j) => ({ at: c.key !== 'id' && c.type !== 'formula' ? idx[j] : -1, bool: c.type === 'bool' }))
          .filter((d) => d.at >= 0);
        const hasData = (row: unknown[]) => dataCols.some(({ at, bool }) => {
          const v = norm(row[at]);
          return v !== '' && !(bool && (row[at] === false || v.toUpperCase() === 'FALSE'));
        });
        const assigned = new Map<number, { id: string; row: unknown[] }>();
        rows.slice(1).forEach((row, j) => {
          const rec = fromRow(def, reorder(idx, row));
          if (keyed) {
            const key = norm(rec.key);
            if (key) ds[def.entity as 'settings' | 'meta'][key] = rec.value === undefined ? '' : String(rec.value);
            return;
          }
          if (typeof rec.id === 'string' && rec.id.trim()) {
            (ds[def.entity as EntityName] as unknown[]).push(rec);
          } else if (idCol >= 0 && hasData(row)) {
            const fresh = newId(ID_PREFIX[def.entity as EntityName]);
            assigned.set(j + 2, { id: fresh, row });
            (ds[def.entity as EntityName] as unknown[]).push({ ...rec, id: fresh });
          }
        });
        if (assigned.size > 0) missing.push({ def, idCol, rows: assigned });
      });
      this.sep = parseSeparator(ds.settings[FORMULA_SEPARATOR_KEY]) ?? separatorForLocale(meta.locale);
      for (const m of missing) await this.writeIds(m.def, m.idCol, m.rows);
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
    return guarded(async () => {
      await upsertKeyValue(this.api, this.spreadsheetId, sheetFor('settings').sheet, key, value);
      if (key === FORMULA_SEPARATOR_KEY) this.sep = parseSeparator(value) ?? this.sep;
    });
  }

  /** Разделитель, которым пишутся формулы перевода (известен после load). */
  get formulaSeparator(): FormulaSeparator | null {
    return this.sep;
  }

  /** Сменить разделитель: записать в «Настройки», переписать формулы перевода во всех строках «Позиций» (одной записью), отметить в «_meta». */
  setFormulaSeparator(sep: FormulaSeparator): Promise<void> {
    return guarded(async () => {
      await this.setSetting(FORMULA_SEPARATOR_KEY, sep);
      await rewriteTranslateFormulas(this.api, this.spreadsheetId, sep, 'all');
      await markFormulaSeparator(this.api, this.spreadsheetId, sep);
    });
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
    const { usable, build } = formulaColumns(def, idx);
    if (usable.length === 0 || rowNums.length === 0) return;
    const sep = await this.separator();
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
        for (const u of usable) row[u.at - minCol] = build(u, r, sep);
        return row;
      });
      await this.api.update(this.spreadsheetId, rect(def.sheet, run[0], minCol, run[run.length - 1], maxCol), values, { valueInputOption: 'USER_ENTERED' });
    }
  }

  /** Разделитель формул: из load, иначе — настройка из листа «Настройки» или локаль таблицы. */
  private async separator(): Promise<FormulaSeparator> {
    if (this.sep) return this.sep;
    const meta = await this.api.getMeta(this.spreadsheetId);
    this.rememberSheets(meta.sheets);
    const settings = sheetFor('settings');
    let saved: FormulaSeparator | null = null;
    if (meta.sheets.some((x) => x.title === settings.sheet)) {
      const [rows] = await this.api.batchGet(this.spreadsheetId, [a1(settings.sheet)]);
      const idx = mapHeaders(settings, rows[0] ?? []);
      const k = idx[0] >= 0 ? idx[0] : 0;
      const v = idx[1] >= 0 ? idx[1] : 1;
      saved = parseSeparator(rows.find((row, i) => i > 0 && norm(row[k]) === FORMULA_SEPARATOR_KEY)?.[v]);
    }
    this.sep = saved ?? separatorForLocale(meta.locale);
    return this.sep;
  }

  /**
   * id новым строкам — одной записью в колонку id листа (null — ячейка не трогается).
   * Прямо перед записью лист перечитывается: пишется только туда, где id всё ещё пуст и строка та же, что при чтении
   * (другое устройство могло успеть записать id, лист могли отсортировать). Остальные — до следующей загрузки.
   * Сбой не мешает загрузке: записи видны в этой сессии, следующая загрузка повторит.
   */
  private async writeIds(def: SheetDef, idCol: number, assigned: Map<number, { id: string; row: unknown[] }>): Promise<void> {
    const same = (a: unknown[] = [], b: unknown[] = []) => {
      const n = Math.max(a.length, b.length);
      for (let c = 0; c < n; c++) if (norm(a[c]) !== norm(b[c])) return false;
      return true;
    };
    try {
      const [now] = await this.api.batchGet(this.spreadsheetId, [a1(def.sheet)]);
      const ok = [...assigned].filter(([r, a]) => norm(now[r - 1]?.[idCol]) === '' && same(now[r - 1], a.row));
      if (ok.length === 0) return;
      const rowNums = ok.map(([r]) => r);
      const r1 = Math.min(...rowNums);
      const r2 = Math.max(...rowNums);
      const byRow = new Map(ok.map(([r, a]) => [r, a.id]));
      const values: Cell[][] = [];
      for (let r = r1; r <= r2; r++) values.push([byRow.get(r) ?? null]);
      await this.api.update(this.spreadsheetId, rect(def.sheet, r1, idCol, r2, idCol), values);
    } catch { /* запись id не удалась — повтор при следующей загрузке */ }
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

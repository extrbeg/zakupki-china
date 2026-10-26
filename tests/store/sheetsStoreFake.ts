// Фейковый SheetsApi в памяти: ведёт себя как Sheets API v4 в тех местах, на которые опирается приложение.
// - batchGet обрезает пустой хвост строк и пустые строки в конце, пустые ячейки внутри — '';
// - update: null — ячейка не трогается, '' — очищается; выход за указанный диапазон — 400;
// - USER_ENTERED строка с '=' — формула; формула перевода вычисляется как «[en] <значение>», если её разделитель
//   подходит локали таблицы (en_* — «,», прочие — «;»), иначе «#ERROR!» (как ошибка разбора в Sheets);
// - локаль: seed — en_US (или setLocale), create — ru_RU, как createSheetsApi; getMeta отдаёт её;
// - batchGet с valueRenderOption FORMULA отдаёт текст формул;
// - несуществующий лист — 400; deleteDimension сдвигает строки.

import { GoogleApiError, type ReadOptions, type SheetMeta, type SheetsApi, type WriteOptions } from '../../src/google/sheetsApi';

type Stored = string | number | boolean | { formula: string } | undefined;
interface FakeSheet { sheetId: number; hidden: boolean; grid: Stored[][]; formats: Record<number, string> }
interface FakeSpreadsheet { title: string; locale: string; sheets: Map<string, FakeSheet> }
export interface FakeCall { method: keyof SheetsApi; range?: string; ranges?: string[]; values?: unknown[][]; input?: string; requests?: object[]; render?: string }

/** Разделитель аргументов формул в локали фейка: англоязычные — «,», остальные (ru_RU, de_DE…) — «;». */
const localeSep = (locale: string) => (/^en(_|$)/.test(locale) ? ',' : ';');

const colIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;

interface Parsed { sheet: string; r1: number; c1: number; r2: number; c2: number; bounded: boolean }

export function parseRange(range: string): Parsed {
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))(?:!(.+))?$/.exec(range);
  if (!m) throw new GoogleApiError(400, `Плохой диапазон ${range}`);
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
  const part = m[3];
  if (!part) return { sheet, r1: 0, c1: 0, r2: Infinity, c2: Infinity, bounded: false };
  const pm = /^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/.exec(part);
  if (!pm) throw new GoogleApiError(400, `Плохой диапазон ${range}`);
  const [, ca, ra, cb, rb] = pm;
  const single = pm[3] === undefined && pm[4] === undefined;
  const c1 = ca ? colIndex(ca) : 0;
  const r1 = ra ? Number(ra) - 1 : 0;
  const c2 = single ? (ca ? c1 : Infinity) : cb ? colIndex(cb) : Infinity;
  const r2 = single ? (ra ? r1 : Infinity) : rb ? Number(rb) - 1 : Infinity;
  return { sheet, r1, c1, r2, c2, bounded: !single };
}

const isBlank = (v: Stored) => v === undefined || v === '';

export class FakeSheetsApi implements SheetsApi {
  readonly calls: FakeCall[] = [];
  private books = new Map<string, FakeSpreadsheet>();
  private nextSheetId = 100;
  private nextBook = 1;
  private failures: Error[] = [];

  /** Следующий вызов API бросит эту ошибку. */
  failNext(err: Error): void {
    this.failures.push(err);
  }

  /** Создать таблицу с листами и значениями (для подготовки теста). */
  seed(id: string, sheets: Record<string, unknown[][]>, title = 'Тест'): void {
    const book: FakeSpreadsheet = { title, locale: 'en_US', sheets: new Map() };
    for (const [name, rows] of Object.entries(sheets)) {
      book.sheets.set(name, { sheetId: this.nextSheetId++, hidden: false, grid: rows.map((r) => r.map((v) => (v === null ? undefined : (v as Stored)))), formats: {} });
    }
    this.books.set(id, book);
  }

  /** Локаль таблицы (properties.locale). */
  setLocale(id: string, locale: string): void {
    this.book(id).locale = locale;
  }

  /** Сырые значения листа: что видит пользователь (формулы — вычисленные). */
  values(id: string, sheet: string): unknown[][] {
    const s = this.sheet(id, sheet);
    const sep = localeSep(this.book(id).locale);
    return this.trim(s.grid.map((row, r) => row.map((_, c) => this.read(s, r, c, sep))));
  }

  /** Записанные ячейки без обрезки: явно очищенная ('') — null, никогда не писанный хвост строки отброшен. */
  writtenRows(id: string, sheet: string): unknown[][] {
    const s = this.sheet(id, sheet);
    const sep = localeSep(this.book(id).locale);
    return s.grid.map((row) => {
      let n = row.length;
      while (n > 0 && row[n - 1] === undefined) n--;
      return row.slice(0, n).map((v, c) => (v === '' || v === undefined ? null : this.read(s, s.grid.indexOf(row), c, sep)));
    });
  }

  /** Вставить строку прямо в таблицу (как пользователь руками), r — с нуля. */
  insertRow(id: string, sheet: string, r: number, row: unknown[]): void {
    this.sheet(id, sheet).grid.splice(r, 0, row.map((v) => (v === null ? undefined : (v as Stored))));
  }

  /** Формула в ячейке (r, c с нуля) или undefined. */
  formulaAt(id: string, sheet: string, r: number, c: number): string | undefined {
    const v = this.sheet(id, sheet).grid[r]?.[c];
    return typeof v === 'object' && v ? v.formula : undefined;
  }

  formats(id: string, sheet: string): Record<number, string> {
    return this.sheet(id, sheet).formats;
  }

  sheetTitles(id: string): string[] {
    return [...this.book(id).sheets.keys()];
  }

  /** Вызовы, которые что-то меняют. */
  writes(): FakeCall[] {
    return this.calls.filter((c) => c.method !== 'batchGet' && c.method !== 'getMeta');
  }

  // ---------- SheetsApi ----------

  async create(title: string) {
    this.guard({ method: 'create' });
    const id = `fake_${this.nextBook++}`;
    this.seed(id, { 'Лист1': [] }, title);
    this.setLocale(id, 'ru_RU');
    return { spreadsheetId: id, url: `https://docs.google.com/spreadsheets/d/${id}/edit` };
  }

  async getMeta(id: string) {
    this.guard({ method: 'getMeta' });
    const book = this.book(id);
    const sheets: SheetMeta[] = [...book.sheets.entries()].map(([title, s]) => ({ title, sheetId: s.sheetId, hidden: s.hidden }));
    return { title: book.title, locale: book.locale, sheets };
  }

  async batchGet(id: string, ranges: string[], options?: ReadOptions) {
    const render = options?.valueRenderOption ?? 'UNFORMATTED_VALUE';
    this.guard({ method: 'batchGet', ranges, render });
    const sep = localeSep(this.book(id).locale);
    return ranges.map((range) => {
      const p = parseRange(range);
      const s = this.sheet(id, p.sheet);
      const out: unknown[][] = [];
      const lastRow = Math.min(p.r2, s.grid.length - 1);
      for (let r = p.r1; r <= lastRow; r++) {
        const row = s.grid[r] ?? [];
        const lastCol = Math.min(p.c2, row.length - 1);
        const vals: unknown[] = [];
        for (let c = p.c1; c <= lastCol; c++) {
          const v = row[c];
          vals.push(render === 'FORMULA' && typeof v === 'object' && v ? v.formula : this.read(s, r, c, sep));
        }
        out.push(vals);
      }
      return this.trim(out);
    });
  }

  async update(id: string, range: string, values: unknown[][], options?: WriteOptions) {
    const input = options?.valueInputOption ?? 'RAW';
    this.guard({ method: 'update', range, values, input });
    const p = parseRange(range);
    const s = this.sheet(id, p.sheet);
    if (p.bounded) {
      const width = Math.max(0, ...values.map((r) => r.length));
      if (values.length > p.r2 - p.r1 + 1 || width > p.c2 - p.c1 + 1) throw new GoogleApiError(400, `Запись за пределы диапазона ${range}`);
    } else if (values.length > 1 || (values[0]?.length ?? 0) > 1) {
      throw new GoogleApiError(400, `Запись за пределы диапазона ${range}`);
    }
    this.write(s, p.r1, p.c1, values, input);
  }

  async append(id: string, range: string, values: unknown[][]) {
    this.guard({ method: 'append', range, values, input: 'RAW' });
    const p = parseRange(range);
    const s = this.sheet(id, p.sheet);
    let last = -1;
    s.grid.forEach((row, r) => { if (row.some((v) => !isBlank(v))) last = r; });
    this.write(s, last + 1, p.c1, values, 'RAW');
  }

  async batchUpdate(id: string, requests: object[]) {
    this.guard({ method: 'batchUpdate', requests });
    const book = this.book(id);
    const byId = (sheetId: number) => {
      const s = [...book.sheets.values()].find((x) => x.sheetId === sheetId);
      if (!s) throw new GoogleApiError(400, `Нет листа ${sheetId}`);
      return s;
    };
    for (const req of requests as Record<string, any>[]) {
      if (req.addSheet) {
        const title: string = req.addSheet.properties.title;
        if (book.sheets.has(title)) throw new GoogleApiError(400, `Лист ${title} уже есть`);
        book.sheets.set(title, { sheetId: req.addSheet.properties.sheetId ?? this.nextSheetId++, hidden: false, grid: [], formats: {} });
      } else if (req.deleteDimension) {
        const { sheetId, dimension, startIndex, endIndex } = req.deleteDimension.range;
        if (dimension !== 'ROWS') throw new Error('фейк умеет удалять только строки');
        byId(sheetId).grid.splice(startIndex, endIndex - startIndex);
      } else if (req.updateCells) {
        const s = byId(req.updateCells.range.sheetId);
        if (req.updateCells.rows) throw new Error('фейк не пишет значения через updateCells');
        s.grid = [];
      } else if (req.repeatCell) {
        const r = req.repeatCell.range;
        const fmt = req.repeatCell.cell?.userEnteredFormat?.numberFormat;
        const s = byId(r.sheetId);
        if (fmt) for (let c = r.startColumnIndex; c < r.endColumnIndex; c++) s.formats[c] = `${fmt.type}:${fmt.pattern ?? ''}`;
      } else if (req.appendDimension || req.updateSheetProperties || req.deleteSheet) {
        if (req.deleteSheet) for (const [t, s] of book.sheets) if (s.sheetId === req.deleteSheet.sheetId) book.sheets.delete(t);
      } else {
        throw new Error(`фейк не знает запрос ${Object.keys(req).join(',')}`);
      }
    }
  }

  // ---------- внутреннее ----------

  private guard(call: FakeCall) {
    this.calls.push(call);
    const err = this.failures.shift();
    if (err) throw err;
  }

  private book(id: string): FakeSpreadsheet {
    const b = this.books.get(id);
    if (!b) throw new GoogleApiError(404, 'Requested entity was not found.');
    return b;
  }

  private sheet(id: string, title: string): FakeSheet {
    const s = this.book(id).sheets.get(title);
    if (!s) throw new GoogleApiError(400, `Unable to parse range: ${title}`);
    return s;
  }

  private write(s: FakeSheet, r0: number, c0: number, values: unknown[][], input: string) {
    values.forEach((row, i) => {
      const r = r0 + i;
      while (s.grid.length <= r) s.grid.push([]);
      row.forEach((v, j) => {
        if (v === null || v === undefined) return;
        const c = c0 + j;
        while (s.grid[r].length <= c) s.grid[r].push(undefined);
        if (typeof v === 'object') throw new GoogleApiError(400, 'Недопустимое значение ячейки');
        s.grid[r][c] = input === 'USER_ENTERED' && typeof v === 'string' && v.startsWith('=') ? { formula: v } : (v as Stored);
      });
    });
  }

  private read(s: FakeSheet, r: number, c: number, sep: string): unknown {
    const v = s.grid[r]?.[c];
    if (v === undefined) return '';
    if (typeof v !== 'object') return v;
    const m = /^=IF\(ISBLANK\(([A-Z]+)(\d+)\)([,;])""\3GOOGLETRANSLATE\(\1\2\3"ru"\3"en"\)\)$/.exec(v.formula);
    if (!m) return v.formula;
    if (m[3] !== sep) return '#ERROR!';
    const src = this.read(s, Number(m[2]) - 1, colIndex(m[1]), sep);
    return src === '' ? '' : `[en] ${String(src)}`;
  }

  private trim(rows: unknown[][]): unknown[][] {
    const out = rows.map((row) => {
      let n = row.length;
      while (n > 0 && (row[n - 1] === '' || row[n - 1] === undefined)) n--;
      return row.slice(0, n);
    });
    while (out.length > 0 && out[out.length - 1].length === 0) out.pop();
    return out;
  }
}

// Стенд для Code.gs: загружает скрипт в node через `vm` с моками сервисов Apps Script.
// Моки повторяют только ту часть API, которой пользуется скрипт.

import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const CODE_PATH = path.resolve(dir, '../Code.gs');
export const MANIFEST_PATH = path.resolve(dir, '../appsscript.json');

export const isDate = (v: unknown): v is Date => Object.prototype.toString.call(v) === '[object Date]';
/** Снимает «чужой realm» с результатов из vm, чтобы сравнивать обычным toEqual. */
export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const TZ_OFFSETS: Record<string, number> = { 'Europe/Moscow': 3, UTC: 0, 'Etc/UTC': 0, GMT: 0 };
function offsetOf(tz: string): number {
  if (!(tz in TZ_OFFSETS)) throw new Error(`mock Utilities: неизвестный часовой пояс ${tz}`);
  return TZ_OFFSETS[tz];
}
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export const Utilities = {
  formatDate(date: Date, tz: string, fmt: string): string {
    const d = new Date(date.getTime() + offsetOf(tz) * 3600_000);
    return fmt
      .replace('yyyy', String(d.getUTCFullYear()))
      .replace('MM', pad(d.getUTCMonth() + 1))
      .replace('dd', pad(d.getUTCDate()))
      .replace('HH', pad(d.getUTCHours()))
      .replace('mm', pad(d.getUTCMinutes()))
      .replace('ss', pad(d.getUTCSeconds()));
  },
  parseDate(text: string, tz: string, fmt: string): Date {
    if (fmt !== 'yyyy-MM-dd') throw new Error(`mock Utilities.parseDate: формат ${fmt} не поддержан`);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!m) throw new Error(`mock Utilities.parseDate: не дата ${text}`);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - offsetOf(tz) * 3600_000);
  },
};

const empty = (v: unknown) => v === '' || v === null || v === undefined;

export class FakeRange {
  constructor(private sheet: FakeSheet, private row: number, private col: number, private nRows: number, private nCols: number) {}
  getValues(): unknown[][] {
    const out: unknown[][] = [];
    for (let r = 0; r < this.nRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] ?? [];
      const line: unknown[] = [];
      for (let c = 0; c < this.nCols; c++) { const v = src[this.col - 1 + c]; line.push(v === undefined || v === null ? '' : v); }
      out.push(line);
    }
    return out;
  }
  getValue(): unknown { return this.getValues()[0][0]; }
  setValues(values: unknown[][]): FakeRange {
    if (values.length !== this.nRows || values.some((r) => r.length !== this.nCols)) {
      throw new Error(`mock Range.setValues: размер ${values.length}x${values[0]?.length} не совпадает с ${this.nRows}x${this.nCols}`);
    }
    for (let r = 0; r < this.nRows; r++) {
      const idx = this.row - 1 + r;
      while (this.sheet.data.length <= idx) this.sheet.data.push([]);
      for (let c = 0; c < this.nCols; c++) this.sheet.data[idx][this.col - 1 + c] = values[r][c];
    }
    return this;
  }
  setValue(v: unknown): FakeRange { return this.setValues([[v]]); }
  setNumberFormat(fmt: string): FakeRange {
    for (let r = 0; r < this.nRows; r++) for (let c = 0; c < this.nCols; c++) this.sheet.formats[`${this.row + r}:${this.col + c}`] = fmt;
    return this;
  }
  setFontWeight(): FakeRange { return this; }
}

export class FakeSheet {
  data: unknown[][];
  formats: Record<string, string> = {};
  frozenRows = 0;
  constructor(public name: string, rows: unknown[][] = []) { this.data = rows.map((r) => [...r]); }
  getName() { return this.name; }
  getLastRow() { let last = 0; this.data.forEach((r, i) => { if (r.some((v) => !empty(v))) last = i + 1; }); return last; }
  getLastColumn() {
    let max = 0;
    for (const r of this.data) for (let j = r.length - 1; j >= 0; j--) if (!empty(r[j])) { max = Math.max(max, j + 1); break; }
    return max;
  }
  getRange(row: number, col: number, nRows = 1, nCols = 1) {
    if (typeof row !== 'number' || row < 1 || col < 1 || nRows < 1 || nCols < 1) throw new Error(`mock getRange: неверные координаты ${row},${col},${nRows},${nCols}`);
    return new FakeRange(this, row, col, nRows, nCols);
  }
  appendRow(values: unknown[]) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
  deleteRow(row: number) { this.data.splice(row - 1, 1); return this; }
  setFrozenRows(n: number) { this.frozenRows = n; return this; }
  /** Для тестов: строки как объекты по заголовкам первой строки. */
  records(): Record<string, unknown>[] {
    const [head = [], ...rest] = this.data;
    return rest.filter((r) => r.some((v) => !empty(v))).map((r) => Object.fromEntries(head.map((h, j) => [String(h), r[j] ?? ''])));
  }
  formatAt(row: number, col: number) { return this.formats[`${row}:${col}`]; }
}

export const RATES_HEADER = ['id', 'Дата', 'Валюта', 'Курс', 'Источник', 'Загружено', 'Комментарий'];
export const LOG_HEADER = ['Время', 'Уровень', 'Сообщение', 'Подробности'];
export const SETTINGS_HEADER = ['Ключ', 'Значение'];

export interface FetchReply { code?: number; body?: string; contentType?: string }
export interface FetchCall { url: string; params: Record<string, unknown> }

export interface EnvOptions {
  sheets?: Record<string, unknown[][]>;
  fetch?: (url: string, params: Record<string, unknown>) => FetchReply;
  now?: string;   // ISO момент «сейчас»
  noUi?: boolean; // запуск из триггера: getUi бросает
}

export function createEnv(opts: EnvOptions = {}) {
  const sheets = new Map<string, FakeSheet>();
  for (const [name, rows] of Object.entries(opts.sheets ?? {})) sheets.set(name, new FakeSheet(name, rows));
  const fetchCalls: FetchCall[] = [];
  const menus: { title: string; items: { caption: string; fn: string }[] }[] = [];
  const alerts: string[] = [];
  const toasts: string[] = [];
  let triggerSeq = 0;
  const triggers: Record<string, unknown>[] = [];
  let fetchImpl = opts.fetch ?? (() => ({ code: 200, body: '', contentType: 'text/html' }));

  const spreadsheet = {
    getSheetByName: (name: string) => sheets.get(name) ?? null,
    insertSheet: (name: string) => { const s = new FakeSheet(name); sheets.set(name, s); return s; },
    getSpreadsheetTimeZone: () => 'Europe/Moscow',
    toast: (msg: string) => { toasts.push(String(msg)); },
    getId: () => 'sheet-id',
  };
  const ui = {
    createMenu(title: string) {
      const menu = { title, items: [] as { caption: string; fn: string }[] };
      const builder = {
        addItem(caption: string, fn: string) { menu.items.push({ caption, fn }); return builder; },
        addSeparator() { return builder; },
        addToUi() { menus.push(menu); },
      };
      return builder;
    },
    alert(msg: string) { alerts.push(String(msg)); return 'OK'; },
    ButtonSet: { OK: 'OK' },
  };
  const SpreadsheetApp = {
    getActive: () => spreadsheet,
    getActiveSpreadsheet: () => spreadsheet,
    getUi: () => { if (opts.noUi) throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); return ui; },
  };
  const UrlFetchApp = {
    fetch(url: string, params: Record<string, unknown> = {}) {
      fetchCalls.push({ url, params });
      const reply = fetchImpl(url, params);
      const body = reply.body ?? '';
      return {
        getResponseCode: () => reply.code ?? 200,
        getContentText: () => body,
        getHeaders: () => ({ 'Content-Type': reply.contentType ?? 'text/html; charset=utf-8' }),
        getAllHeaders: () => ({ 'Content-Type': reply.contentType ?? 'text/html; charset=utf-8' }),
      };
    },
  };
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t: unknown) => { const i = triggers.indexOf(t as Record<string, unknown>); if (i >= 0) triggers.splice(i, 1); },
    newTrigger(fn: string) {
      const cfg: Record<string, unknown> = { handler: fn };
      const time = {
        everyDays(n: number) { cfg.everyDays = n; return time; },
        atHour(h: number) { cfg.atHour = h; return time; },
        nearMinute(m: number) { cfg.nearMinute = m; return time; },
        inTimezone(tz: string) { cfg.timezone = tz; return time; },
        create() {
          const id = `t${++triggerSeq}`;
          const t = { ...cfg, getHandlerFunction: () => fn, getUniqueId: () => id, getEventType: () => 'CLOCK' };
          triggers.push(t);
          return t;
        },
      };
      return { timeBased: () => { cfg.timeBased = true; return time; } };
    },
    EventType: { CLOCK: 'CLOCK' },
  };
  const Session = { getScriptTimeZone: () => 'Europe/Moscow' };
  const Logger = { log: () => undefined };
  const quietConsole = { log: () => undefined, warn: () => undefined, error: () => undefined, info: () => undefined };

  const context = vm.createContext({ SpreadsheetApp, UrlFetchApp, ScriptApp, Utilities, Session, Logger, console: quietConsole });
  vm.runInContext(readFileSync(CODE_PATH, 'utf8'), context, { filename: 'Code.gs' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gs = context as any;
  if (opts.now) { const at = opts.now; gs.now_ = () => new Date(at); }

  return {
    gs,
    sheets,
    sheet: (name: string) => sheets.get(name),
    fetchCalls,
    menus,
    alerts,
    toasts,
    triggers,
    setFetch(f: (url: string, params: Record<string, unknown>) => FetchReply) { fetchImpl = f; },
    setNow(iso: string) { gs.now_ = () => new Date(iso); },
  };
}

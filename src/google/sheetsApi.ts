// Тонкая обёртка над Sheets API v4. Чтение — UNFORMATTED_VALUE + SERIAL_NUMBER, запись — RAW (формулы — USER_ENTERED по запросу).

import { googleRequest, type RequestOptions, type TokenGetter } from './http';

export { GoogleApiError } from './errors';

export interface SheetMeta { title: string; sheetId: number; hidden: boolean }
export interface WriteOptions { valueInputOption?: 'RAW' | 'USER_ENTERED' }

export interface SheetsApi {
  create(title: string): Promise<{ spreadsheetId: string; url: string }>;
  getMeta(id: string): Promise<{ title: string; sheets: SheetMeta[] }>;
  batchGet(id: string, ranges: string[]): Promise<unknown[][][]>;
  /** RAW по умолчанию; формулы — `{ valueInputOption: 'USER_ENTERED' }`. null в values — ячейка не трогается. */
  update(id: string, range: string, values: unknown[][], options?: WriteOptions): Promise<void>;
  append(id: string, range: string, values: unknown[][]): Promise<void>;
  batchUpdate(id: string, requests: object[]): Promise<void>;
}

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function query(params: [string, string][]): string {
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export function createSheetsApi(getToken: TokenGetter, options: RequestOptions = {}): SheetsApi {
  const req = <T>(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) => googleRequest<T>(getToken, method, url, body, options);
  const sp = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
  const values = (id: string, range: string) => `${sp(id)}/values/${encodeURIComponent(range)}`;

  return {
    async create(title) {
      const res = await req<{ spreadsheetId: string; spreadsheetUrl: string }>('POST', BASE, { properties: { title, locale: 'ru_RU', timeZone: 'Europe/Moscow' } });
      return { spreadsheetId: res.spreadsheetId, url: res.spreadsheetUrl };
    },

    async getMeta(id) {
      const fields = 'properties.title,sheets.properties(title,sheetId,hidden)';
      const res = await req<{ properties?: { title?: string }; sheets?: { properties?: { title?: string; sheetId?: number; hidden?: boolean } }[] }>(
        'GET', `${sp(id)}?${query([['fields', fields]])}`,
      );
      return {
        title: res.properties?.title ?? '',
        sheets: (res.sheets ?? []).map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? 0, hidden: Boolean(s.properties?.hidden) })),
      };
    },

    async batchGet(id, ranges) {
      const params: [string, string][] = [
        ...ranges.map((r): [string, string] => ['ranges', r]),
        ['valueRenderOption', 'UNFORMATTED_VALUE'],
        ['dateTimeRenderOption', 'SERIAL_NUMBER'],
        ['majorDimension', 'ROWS'],
      ];
      const res = await req<{ valueRanges?: { values?: unknown[][] }[] }>('GET', `${sp(id)}/values:batchGet?${query(params)}`);
      const got = res?.valueRanges ?? [];
      return ranges.map((_, i) => got[i]?.values ?? []);
    },

    async update(id, range, rows, opts) {
      const input = opts?.valueInputOption ?? 'RAW';
      await req('PUT', `${values(id, range)}?${query([['valueInputOption', input]])}`, { range, majorDimension: 'ROWS', values: rows });
    },

    async append(id, range, rows) {
      await req('POST', `${values(id, range)}:append?${query([['valueInputOption', 'RAW'], ['insertDataOption', 'INSERT_ROWS']])}`, { range, majorDimension: 'ROWS', values: rows });
    },

    async batchUpdate(id, requests) {
      await req('POST', `${sp(id)}:batchUpdate`, { requests });
    },
  };
}

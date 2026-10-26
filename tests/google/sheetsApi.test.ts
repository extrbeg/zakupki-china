import { describe, expect, it, vi } from 'vitest';
import { createSheetsApi, GoogleApiError } from '../../src/google/sheetsApi';

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('нет ответа в моке');
    if (next instanceof Error) throw next;
    return next;
  });
  const getToken = vi.fn(async (opts?: { forceRefresh?: boolean }) => (opts?.forceRefresh ? 'tok-2' : 'tok-1'));
  const sleep = vi.fn(async (_ms: number) => {});
  const api = createSheetsApi(getToken, { fetch: fetchMock as unknown as typeof fetch, sleep });
  return { api, fetchMock, getToken, sleep };
}

const urlOf = (m: ReturnType<typeof setup>['fetchMock'], i: number) => new URL(m.mock.calls[i][0]);
const initOf = (m: ReturnType<typeof setup>['fetchMock'], i: number) => m.mock.calls[i][1] as RequestInit;

describe('SheetsApi: запросы', () => {
  it('batchGet читает UNFORMATTED_VALUE + SERIAL_NUMBER и отдаёт значения диапазонов', async () => {
    const { api, fetchMock } = setup([json(200, { valueRanges: [{ values: [['id', 'Дата'], ['a', 46296]] }, {}] })]);
    const res = await api.batchGet('sp1', ["'Заказы'", "'Курсы'!A:A"]);
    expect(res).toEqual([[['id', 'Дата'], ['a', 46296]], []]);
    const u = urlOf(fetchMock, 0);
    expect(u.pathname).toBe('/v4/spreadsheets/sp1/values:batchGet');
    expect(u.searchParams.getAll('ranges')).toEqual(["'Заказы'", "'Курсы'!A:A"]);
    expect(u.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    expect(u.searchParams.get('dateTimeRenderOption')).toBe('SERIAL_NUMBER');
    expect((initOf(fetchMock, 0).headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('update пишет RAW, а с опцией — USER_ENTERED; append — RAW + INSERT_ROWS', async () => {
    const { api, fetchMock } = setup([json(200), json(200), json(200)]);
    await api.update('sp1', "'Позиции'!A2:C2", [['x', 1.5, null]]);
    await api.update('sp1', "'Позиции'!V2:V2", [['=1+1']], { valueInputOption: 'USER_ENTERED' });
    await api.append('sp1', "'Позиции'!A1", [['y', 2]]);
    const u0 = urlOf(fetchMock, 0);
    expect(initOf(fetchMock, 0).method).toBe('PUT');
    expect(decodeURIComponent(u0.pathname)).toBe("/v4/spreadsheets/sp1/values/'Позиции'!A2:C2");
    expect(u0.searchParams.get('valueInputOption')).toBe('RAW');
    expect(JSON.parse(String(initOf(fetchMock, 0).body)).values).toEqual([['x', 1.5, null]]);
    expect(urlOf(fetchMock, 1).searchParams.get('valueInputOption')).toBe('USER_ENTERED');
    const u2 = urlOf(fetchMock, 2);
    expect(decodeURIComponent(u2.pathname)).toBe("/v4/spreadsheets/sp1/values/'Позиции'!A1:append");
    expect(u2.searchParams.get('valueInputOption')).toBe('RAW');
    expect(u2.searchParams.get('insertDataOption')).toBe('INSERT_ROWS');
  });

  it('create и getMeta разбирают ответ', async () => {
    const { api } = setup([
      json(200, { spreadsheetId: 'new1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new1/edit' }),
      json(200, { properties: { title: 'Закупки' }, sheets: [{ properties: { title: 'Заказы', sheetId: 7, hidden: true } }, { properties: { title: 'Курсы', sheetId: 8 } }] }),
    ]);
    expect(await api.create('Закупки')).toEqual({ spreadsheetId: 'new1', url: 'https://docs.google.com/spreadsheets/d/new1/edit' });
    expect(await api.getMeta('new1')).toEqual({ title: 'Закупки', sheets: [{ title: 'Заказы', sheetId: 7, hidden: true }, { title: 'Курсы', sheetId: 8, hidden: false }] });
  });

  it('G27: getMeta запрашивает и отдаёт локаль таблицы', async () => {
    const { api, fetchMock } = setup([json(200, { properties: { title: 'Т', locale: 'ru_RU' }, sheets: [] })]);
    const meta = await api.getMeta('sp1');
    expect(meta.locale).toBe('ru_RU');
    expect(urlOf(fetchMock, 0).searchParams.get('fields')).toContain('properties.locale');
  });

  it('G27: batchGet с valueRenderOption FORMULA читает текст формул', async () => {
    const { api, fetchMock } = setup([json(200, { valueRanges: [{ values: [['=1+1']] }] })]);
    expect(await api.batchGet('sp1', ["'Позиции'"], { valueRenderOption: 'FORMULA' })).toEqual([[['=1+1']]]);
    expect(urlOf(fetchMock, 0).searchParams.get('valueRenderOption')).toBe('FORMULA');
    expect(initOf(fetchMock, 0).method).toBe('GET');
  });
});

describe('SheetsApi: повторы и токен', () => {
  it('429 и 5xx повторяются с растущей паузой, затем успех', async () => {
    const { api, fetchMock, sleep } = setup([json(429), json(503), json(200, { valueRanges: [] })]);
    await api.batchGet('sp1', []);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const pauses = sleep.mock.calls.map((c) => c[0]);
    expect(pauses).toHaveLength(2);
    expect(pauses[1]).toBeGreaterThan(pauses[0]);
  });

  it('после трёх повторов 5xx — GoogleApiError со статусом (PUT)', async () => {
    const { api, fetchMock } = setup([json(500), json(500), json(500), json(500, { error: { message: 'Internal' } })]);
    const err = await api.update('sp1', "'Позиции'!A2:B2", [['x', 1]]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('POST на 5xx не повторяется (запись могла пройти) — один запрос и GoogleApiError', async () => {
    for (const call of [
      (api: ReturnType<typeof setup>['api']) => api.append('sp1', "'Заказы'!A1", [['x']]),
      (api: ReturnType<typeof setup>['api']) => api.batchUpdate('sp1', [{}]),
      (api: ReturnType<typeof setup>['api']) => api.create('Закупки'),
    ]) {
      const { api, fetchMock, sleep } = setup([json(503, { error: { message: 'Unavailable' } }), json(200)]);
      const err = await call(api).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(GoogleApiError);
      expect((err as GoogleApiError).status).toBe(503);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('POST на 429 повторяется (запрос отклонён до выполнения)', async () => {
    const { api, fetchMock } = setup([json(429), json(200)]);
    await api.append('sp1', "'Заказы'!A1", [['x']]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initOf(fetchMock, 1).method).toBe('POST');
  });

  it('401 → токен обновляется и запрос повторяется один раз', async () => {
    const { api, fetchMock, getToken } = setup([json(401), json(200, { valueRanges: [] })]);
    await api.batchGet('sp1', []);
    expect(getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect((initOf(fetchMock, 1).headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });

  it('повторный 401 — ошибка, без бесконечного цикла', async () => {
    const { api, fetchMock } = setup([json(401), json(401)]);
    const err = await api.batchGet('sp1', []).catch((e: unknown) => e);
    expect((err as GoogleApiError).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('сеть недоступна → GoogleApiError со статусом 0', async () => {
    const { api } = setup([new TypeError('Failed to fetch')]);
    const err = await api.getMeta('sp1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(0);
  });
});

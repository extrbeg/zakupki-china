// Список «Ваши таблицы приложения» (G19, история 88): Drive API v3 files.list в пределах drive.file (ADR 0002).
import { describe, expect, it, vi } from 'vitest';
import { listAppSpreadsheets } from '../../src/google/driveApi';
import { GoogleApiError } from '../../src/google/errors';

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(responses: Response[]) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('нет ответа в моке');
    return next;
  });
  const getToken = vi.fn(async (opts?: { forceRefresh?: boolean }) => (opts?.forceRefresh ? 'tok-2' : 'tok-1'));
  const deps = { getToken, request: { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} } };
  return { fetchMock, getToken, deps };
}

describe('listAppSpreadsheets', () => {
  it('запрос: только таблицы не в корзине, поля id/name/modifiedTime, свежие сверху, токен в заголовке', async () => {
    const { fetchMock, deps } = setup([json(200, { files: [] })]);
    await listAppSpreadsheets(deps);
    const u = new URL(fetchMock.mock.calls[0][0]);
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/drive/v3/files');
    expect(u.searchParams.get('q')).toBe("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    expect(u.searchParams.get('fields')).toBe('files(id,name,modifiedTime)');
    expect(u.searchParams.get('orderBy')).toBe('modifiedTime desc');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
  });

  it('пусто → []', async () => {
    const { deps } = setup([json(200, {})]);
    expect(await listAppSpreadsheets(deps)).toEqual([]);
  });

  it('несколько таблиц → id, название, дата изменения в порядке ответа', async () => {
    const { deps } = setup([json(200, { files: [
      { id: 'sp_new', name: 'Закупки Китай', modifiedTime: '2026-10-25T09:30:00.000Z' },
      { id: 'sp_old', name: 'Закупки 2025', modifiedTime: '2025-12-01T10:00:00.000Z' },
    ] })]);
    expect(await listAppSpreadsheets(deps)).toEqual([
      { id: 'sp_new', name: 'Закупки Китай', modifiedTime: '2026-10-25T09:30:00.000Z' },
      { id: 'sp_old', name: 'Закупки 2025', modifiedTime: '2025-12-01T10:00:00.000Z' },
    ]);
  });

  it('ошибка Google → GoogleApiError со статусом (через общую обёртку: 401 — обновить токен и повторить)', async () => {
    const { deps, getToken, fetchMock } = setup([json(401), json(403, { error: { message: 'Insufficient Permission' } })]);
    const err = await listAppSpreadsheets(deps).catch((e) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect((err as GoogleApiError).status).toBe(403);
    expect(getToken).toHaveBeenCalledWith({ forceRefresh: true });
    expect((fetchMock.mock.calls[1][1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok-2');
  });
});

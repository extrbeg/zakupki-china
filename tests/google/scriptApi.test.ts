import { describe, expect, it, vi } from 'vitest';
import { createBoundScript, updateScriptContent, ScriptApiDisabledError } from '../../src/google/scriptApi';
import { GoogleApiError } from '../../src/google/errors';

function deps(responses: Response[]) {
  const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => responses.shift()!);
  return { fetchMock, d: { getToken: async () => 'tok', request: { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} } } };
}
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('Apps Script API', () => {
  it('createBoundScript: POST projects с parentId = таблица', async () => {
    const { fetchMock, d } = deps([json(200, { scriptId: 'scr_1' })]);
    expect(await createBoundScript('sp_1', 'Закупки', d)).toEqual({ scriptId: 'scr_1' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://script.googleapis.com/v1/projects');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ title: 'Закупки', parentId: 'sp_1' });
  });

  it('updateScriptContent: PUT content со всеми файлами', async () => {
    const { fetchMock, d } = deps([json(200)]);
    const files = [{ name: 'Code', type: 'SERVER_JS' as const, source: 'function onOpen(){}' }, { name: 'appsscript', type: 'JSON' as const, source: '{}' }];
    await updateScriptContent('scr_1', files, d);
    expect(fetchMock.mock.calls[0][0]).toBe('https://script.googleapis.com/v1/projects/scr_1/content');
    expect(fetchMock.mock.calls[0][1]!.method).toBe('PUT');
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body))).toEqual({ files });
  });

  it('403 «User has not enabled the Apps Script API» → ScriptApiDisabledError', async () => {
    const msg = 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings then retrying.';
    const { d } = deps([json(403, { error: { code: 403, message: msg, status: 'PERMISSION_DENIED' } })]);
    await expect(createBoundScript('sp_1', 'Закупки', d)).rejects.toBeInstanceOf(ScriptApiDisabledError);
  });

  it('createBoundScript на 503 не повторяется — иначе второй скрипт у таблицы', async () => {
    const { fetchMock, d } = deps([json(503), json(200, { scriptId: 'scr_2' })]);
    const err = await createBoundScript('sp_1', 'Закупки', d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('другой 403 остаётся GoogleApiError', async () => {
    const { d } = deps([json(403, { error: { message: 'The caller does not have permission' } })]);
    const err = await updateScriptContent('scr_1', [], d).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).not.toBeInstanceOf(ScriptApiDisabledError);
  });
});

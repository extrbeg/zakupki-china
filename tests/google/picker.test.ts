import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/google/auth', () => ({ getAccessToken: vi.fn(async () => 'tok-picker') }));
import { pickSpreadsheet } from '../../src/google/picker';

let callback: ((d: { action: string; docs?: { id: string; name: string }[] }) => void) | null = null;
const calls: Record<string, unknown[]> = {};

class Builder {
  addView(v: unknown) { calls.view = [v]; return this; }
  setOAuthToken(t: string) { calls.token = [t]; return this; }
  setDeveloperKey(k: string) { calls.key = [k]; return this; }
  setAppId(a: string) { calls.appId = [a]; return this; }
  setLocale() { return this; }
  setTitle() { return this; }
  setCallback(cb: typeof callback) { callback = cb; return this; }
  build() { return { setVisible: () => {} }; }
}

beforeEach(() => {
  callback = null;
  for (const k of Object.keys(calls)) delete calls[k];
  vi.stubEnv('VITE_GOOGLE_API_KEY', 'api-key-for-test');
  vi.stubEnv('VITE_GOOGLE_APP_ID', 'app-id-for-test');
  (window as unknown as { google: unknown }).google = {
    picker: {
      PickerBuilder: Builder,
      DocsView: class {
        constructor(public id: unknown) { calls.views = [...(calls.views ?? []), this]; }
        fileIds?: string;
        setMimeTypes() { return this; }
        setFileIds(ids: string) { this.fileIds = ids; return this; }
      },
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as unknown as { google?: unknown }).google;
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('pickSpreadsheet', () => {
  it('выбор таблицы → id и имя; токен, ключ и app id переданы в Picker', async () => {
    const p = pickSpreadsheet();
    await tick();
    callback!({ action: 'loaded' });
    callback!({ action: 'picked', docs: [{ id: 'sp_9', name: 'Закупки 2026' }] });
    expect(await p).toEqual({ id: 'sp_9', name: 'Закупки 2026' });
    expect(calls.token).toEqual(['tok-picker']);
    expect(calls.key).toEqual(['api-key-for-test']);
    expect(calls.appId).toEqual(['app-id-for-test']);
  });

  it('отмена → null', async () => {
    const p = pickSpreadsheet();
    await tick();
    callback!({ action: 'cancel' });
    expect(await p).toBeNull();
  });

  it('по ссылке: окно открывается с этим файлом (DocsView.setFileIds), выбор → id и имя', async () => {
    const p = pickSpreadsheet({ fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd' });
    await tick();
    const views = calls.views as { id: unknown; fileIds?: string }[];
    expect(views).toHaveLength(1);
    expect(views[0].fileIds).toBe('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd');
    expect(calls.view).toEqual([views[0]]);
    callback!({ action: 'picked', docs: [{ id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd', name: 'Закупки' }] });
    expect(await p).toEqual({ id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd', name: 'Закупки' });
    expect(calls.token).toEqual(['tok-picker']);
    expect(calls.appId).toEqual(['app-id-for-test']);
  });

  it('без ссылки — обычный список таблиц, setFileIds не вызывается', async () => {
    const p = pickSpreadsheet();
    await tick();
    expect((calls.views as { fileIds?: string }[])[0].fileIds).toBeUndefined();
    callback!({ action: 'cancel' });
    expect(await p).toBeNull();
  });

  it('по ссылке, отмена в окне → null', async () => {
    const p = pickSpreadsheet({ fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd' });
    await tick();
    callback!({ action: 'cancel' });
    expect(await p).toBeNull();
  });

  it('область доступа не расширяется: только drive.file, script.projects, openid, email', async () => {
    const { SCOPES } = await vi.importActual<typeof import('../../src/google/auth')>('../../src/google/auth');
    expect([...SCOPES].sort()).toEqual([
      'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.projects', 'openid',
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/google/auth', () => ({ getAccessToken: vi.fn(async () => 'tok-picker') }));
import { pickSpreadsheet, PICKER_STALL_MS } from '../../src/google/picker';

let callback: ((d: { action: string; docs?: { id: string; name: string }[] }) => void) | null = null;
const calls: Record<string, unknown[]> = {};

class Builder {
  addView(v: unknown) { calls.view = [v]; return this; }
  setOAuthToken(t: string) { calls.token = [t]; return this; }
  setDeveloperKey(k: string) { calls.key = [k]; return this; }
  setAppId(a: string) { calls.appId = [a]; return this; }
  setLocale() { return this; }
  setTitle() { return this; }
  setOrigin(o: string) { calls.origin = [o]; return this; }
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
  it('окну Google передаётся origin приложения (setOrigin)', async () => {
    const p = pickSpreadsheet();
    await tick();
    expect(calls.origin).toEqual([window.location.origin]);
    callback!({ action: 'cancel' });
    await p;
  });
});

describe('pickSpreadsheet: окно без ответа', () => {
  afterEach(() => vi.useRealTimers());

  it('фокус вернулся в приложение, ответа нет несколько секунд → onStall; поздний ответ всё равно принимается', async () => {
    const onStall = vi.fn();
    const p = pickSpreadsheet({ onStall });
    await tick();
    vi.useFakeTimers();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(PICKER_STALL_MS - 1);
    expect(onStall).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onStall).toHaveBeenCalledTimes(1);
    callback!({ action: 'picked', docs: [{ id: 'sp_late', name: 'Поздно' }] });
    expect(await p).toEqual({ id: 'sp_late', name: 'Поздно' });
  });

  it('вкладка снова видна (visibilitychange) без ответа → onStall', async () => {
    const onStall = vi.fn();
    const p = pickSpreadsheet({ onStall });
    await tick();
    vi.useFakeTimers();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(PICKER_STALL_MS);
    expect(onStall).toHaveBeenCalledTimes(1);
    callback!({ action: 'cancel' });
    expect(await p).toBeNull();
  });

  it('фокус не возвращался → onStall не зовётся, сколько бы ни ждали', async () => {
    const onStall = vi.fn();
    const p = pickSpreadsheet({ onStall });
    await tick();
    vi.useFakeTimers();
    vi.advanceTimersByTime(PICKER_STALL_MS * 20);
    expect(onStall).not.toHaveBeenCalled();
    callback!({ action: 'cancel' });
    await p;
  });

  it('ответ пришёл вскоре после фокуса → onStall не зовётся', async () => {
    const onStall = vi.fn();
    const p = pickSpreadsheet({ onStall });
    await tick();
    vi.useFakeTimers();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(200);
    callback!({ action: 'picked', docs: [{ id: 'sp_1', name: 'Т' }] });
    vi.advanceTimersByTime(PICKER_STALL_MS * 2);
    expect(onStall).not.toHaveBeenCalled();
    expect(await p).toEqual({ id: 'sp_1', name: 'Т' });
  });
});

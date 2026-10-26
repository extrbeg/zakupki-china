import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TokenResponse = { access_token?: string; expires_in?: number; error?: string };
interface ClientConfig { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }

let configs: ClientConfig[] = [];
let requests: { prompt?: string; login_hint?: string }[] = [];
let respond: (cfg: ClientConfig, n: number) => void;
const revoke = vi.fn();

function installGis() {
  configs = [];
  requests = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg: ClientConfig) => {
          configs.push(cfg);
          return {
            requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => {
              requests.push(o ?? {});
              const n = requests.length;
              queueMicrotask(() => respond(cfg, n));
            },
          };
        },
        revoke,
      },
    },
  };
}

async function loadAuth() {
  vi.resetModules();
  return import('../../src/google/auth');
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id-for-test');
  installGis();
  respond = (cfg, n) => cfg.callback({ access_token: `token-${n}`, expires_in: 3600 });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ email: 'user@example.com' }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (window as unknown as { google?: unknown }).google;
});

describe('auth', () => {
  it('isGoogleConfigured зависит от VITE_GOOGLE_CLIENT_ID', async () => {
    const auth = await loadAuth();
    expect(auth.isGoogleConfigured()).toBe(true);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    expect(auth.isGoogleConfigured()).toBe(false);
  });

  it('signIn: токен-клиент с нужными областями, email из userinfo, email запоминается', async () => {
    const auth = await loadAuth();
    const res = await auth.signIn();
    expect(res).toEqual({ email: 'user@example.com' });
    expect(configs[0].client_id).toBe('client-id-for-test');
    expect(configs[0].scope.split(' ')).toEqual(expect.arrayContaining(['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.projects']));
    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0][0])).toContain('userinfo');
    expect(auth.lastEmail()).toBe('user@example.com');
  });

  it('getAccessToken: действующий токен отдаётся без нового запроса; истёкший — тихо обновляется', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
    const auth = await loadAuth();
    await auth.signIn();
    expect(await auth.getAccessToken()).toBe('token-1');
    expect(requests).toHaveLength(1);
    vi.setSystemTime(new Date('2026-10-25T11:30:00Z'));
    expect(await auth.getAccessToken()).toBe('token-2');
    expect(requests[1].prompt).toBe('');
    expect(requests[1].login_hint).toBe('user@example.com');
  });

  it('getAccessToken({ forceRefresh }) запрашивает новый токен даже при действующем', async () => {
    const auth = await loadAuth();
    await auth.signIn();
    expect(await auth.getAccessToken({ forceRefresh: true })).toBe('token-2');
  });

  it('не удалось обновить токен → AuthError', async () => {
    const auth = await loadAuth();
    await auth.signIn();
    respond = (cfg) => cfg.error_callback?.({ type: 'popup_failed_to_open' });
    const err = await auth.getAccessToken({ forceRefresh: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(auth.AuthError);
  });

  it('без входа getAccessToken → AuthError без запроса к Google', async () => {
    const auth = await loadAuth();
    localStorage.clear();
    const err = await auth.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(auth.AuthError);
    expect(requests).toHaveLength(0);
  });

  it('signOut отзывает токен; после него нужен новый вход', async () => {
    const auth = await loadAuth();
    await auth.signIn();
    auth.signOut();
    expect(revoke).toHaveBeenCalledWith('token-1', expect.any(Function));
    expect(auth.lastEmail()).toBeNull();
    const err = await auth.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(auth.AuthError);
  });
});

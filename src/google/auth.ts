// Вход Google: Google Identity Services, token client (OAuth 2.0 implicit, без сервера).
// Токен живёт только в памяти вкладки; запоминается лишь email последнего входа — для подсказки и привязки таблицы.
// VITE_GOOGLE_CLIENT_ID читается из import.meta.env; значение нигде не логируется.

import { AuthError } from './errors';

// Одна реализация проверки настройки — в DataContext (таск 01); здесь реэкспорт.
export { isGoogleConfigured } from '../ui/DataContext';
export { AuthError } from './errors';

export const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/script.projects', 'openid', 'email'];

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const LAST_EMAIL_KEY = 'zk:lastEmail';
const EXPIRY_MARGIN_MS = 60_000;

interface TokenResponse { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void }
interface Oauth2 {
  initTokenClient(cfg: {
    client_id: string; scope: string; callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void; login_hint?: string;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
type GoogleGlobal = { accounts?: { oauth2?: Oauth2 } };

let token: { value: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;
let gisLoading: Promise<Oauth2> | null = null;

function readLastEmail(): string | null {
  try { return localStorage.getItem(LAST_EMAIL_KEY); } catch { return null; }
}
function writeLastEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(LAST_EMAIL_KEY, email);
    else localStorage.removeItem(LAST_EMAIL_KEY);
  } catch { /* без localStorage email не запоминается */ }
}

/** Email последнего входа на этом устройстве (или null). */
export function lastEmail(): string | null {
  return readLastEmail();
}

function gis(): Oauth2 | undefined {
  return (window as unknown as { google?: GoogleGlobal }).google?.accounts?.oauth2;
}

function loadGis(): Promise<Oauth2> {
  const ready = gis();
  if (ready) return Promise.resolve(ready);
  if (!gisLoading) {
    gisLoading = new Promise<Oauth2>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => { const g = gis(); if (g) resolve(g); else reject(new AuthError('Не удалось загрузить вход Google')); };
      s.onerror = () => reject(new AuthError('Не удалось загрузить вход Google — проверьте связь'));
      document.head.appendChild(s);
    }).catch((e) => { gisLoading = null; throw e; });
  }
  return gisLoading;
}

function requestToken(prompt: string, hint: string | null): Promise<string> {
  if (pending) return pending;
  pending = (async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) throw new AuthError('Вход Google не настроен (VITE_GOOGLE_CLIENT_ID)');
    const oauth2 = await loadGis();
    return new Promise<string>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES.join(' '),
        ...(hint ? { login_hint: hint } : {}),
        callback: (r) => {
          if (r.error || !r.access_token) {
            reject(new AuthError(r.error === 'access_denied' ? 'Доступ к Google не выдан' : undefined));
            return;
          }
          token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => reject(new AuthError(e?.type === 'popup_closed' ? 'Окно входа закрыто' : undefined, { cause: e })),
      });
      client.requestAccessToken({ prompt, ...(hint ? { login_hint: hint } : {}) });
    });
  })().finally(() => { pending = null; });
  return pending;
}

/** Войти: окно Google с выбором аккаунта и согласием на доступ; возвращает email. */
export async function signIn(): Promise<{ email: string }> {
  const hint = readLastEmail();
  const access = await requestToken(hint ? '' : 'select_account', hint);
  let res: Response;
  try {
    res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${access}` } });
  } catch (e) {
    throw new AuthError('Нет связи с Google', { cause: e });
  }
  if (!res.ok) throw new AuthError('Не удалось узнать email аккаунта Google');
  const info = (await res.json()) as { email?: string };
  if (!info.email) throw new AuthError('Google не вернул email аккаунта');
  writeLastEmail(info.email);
  return { email: info.email };
}

/** Действующий токен; истёкший (или по forceRefresh) — тихо обновляется. Не вышло — AuthError. */
export async function getAccessToken(opts?: { forceRefresh?: boolean }): Promise<string> {
  if (!opts?.forceRefresh && token && token.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return token.value;
  const hint = readLastEmail();
  if (!token && !hint) throw new AuthError();
  return requestToken('', hint);
}

/** Выйти: отозвать токен и забыть email последнего входа. Привязки таблиц остаются. */
export function signOut(): void {
  const t = token?.value;
  token = null;
  writeLastEmail(null);
  if (t) gis()?.revoke(t, () => {});
}

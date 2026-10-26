// Общий запрос к Google API: токен в заголовке, повтор с backoff, на 401 — обновить токен и повторить один раз.
// GET/PUT/DELETE повторяются на 429 и 5xx; POST (append, batchUpdate, create, createBoundScript) — только на 429:
// после 5xx запись могла уже пройти, и повтор задвоил бы строки или создал второй скрипт.

import { GoogleApiError } from './errors';

export type TokenGetter = (opts?: { forceRefresh?: boolean }) => Promise<string>;

export interface RequestOptions {
  /** Подмена fetch (тесты). */
  fetch?: typeof fetch;
  /** Подмена паузы между повторами (тесты). */
  sleep?: (ms: number) => Promise<void>;
  /** Сколько раз повторять (429, а для не-POST и 5xx); по умолчанию 3. */
  retries?: number;
  /** Первая пауза backoff, мс; дальше удваивается. */
  backoffMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isRetryable = (method: string, status: number) => status === 429 || (status >= 500 && method !== 'POST');

async function errorMessage(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body?.error?.message;
  } catch {
    return undefined;
  }
}

export async function googleRequest<T>(
  getToken: TokenGetter,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = options.sleep ?? defaultSleep;
  const retries = options.retries ?? 3;
  const backoff = options.backoffMs ?? 500;
  let refreshed = false;
  let attempt = 0;
  let token = await getToken();

  for (;;) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new GoogleApiError(0, undefined, { cause: e });
    }

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await getToken({ forceRefresh: true });
      continue;
    }
    if (isRetryable(method, res.status) && attempt < retries) {
      await sleep(backoff * 2 ** attempt);
      attempt += 1;
      continue;
    }
    if (!res.ok) throw new GoogleApiError(res.status, await errorMessage(res));
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

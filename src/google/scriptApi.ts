// Apps Script API: создать скрипт, привязанный к таблице, и загрузить в него файлы.

import { getAccessToken } from './auth';
import { GoogleApiError, ScriptApiDisabledError } from './errors';
import { googleRequest, type RequestOptions, type TokenGetter } from './http';

export { ScriptApiDisabledError } from './errors';

export interface ScriptFile { name: string; type: 'SERVER_JS' | 'JSON'; source: string }
export interface ScriptApiDeps { getToken?: TokenGetter; request?: RequestOptions }

export const APPS_SCRIPT_SETTINGS_URL = 'https://script.google.com/home/usersettings';
const BASE = 'https://script.googleapis.com/v1/projects';

/** 403 «User has not enabled the Apps Script API» — пользователь не включил API в своих настройках. */
function isUserApiDisabled(e: unknown): boolean {
  return e instanceof GoogleApiError && e.status === 403 && /Apps Script API|usersettings/i.test(e.message);
}

async function call<T>(deps: ScriptApiDeps, method: 'POST' | 'PUT', url: string, body: unknown): Promise<T> {
  try {
    return await googleRequest<T>(deps.getToken ?? getAccessToken, method, url, body, deps.request);
  } catch (e) {
    if (isUserApiDisabled(e)) throw new ScriptApiDisabledError();
    throw e;
  }
}

export async function createBoundScript(spreadsheetId: string, title: string, deps: ScriptApiDeps = {}): Promise<{ scriptId: string }> {
  const res = await call<{ scriptId: string }>(deps, 'POST', BASE, { title, parentId: spreadsheetId });
  return { scriptId: res.scriptId };
}

export async function updateScriptContent(scriptId: string, files: ScriptFile[], deps: ScriptApiDeps = {}): Promise<void> {
  await call(deps, 'PUT', `${BASE}/${encodeURIComponent(scriptId)}/content`, { files });
}

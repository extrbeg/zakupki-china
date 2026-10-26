// Установка скрипта таблицы через Apps Script API. Исходники вшиваются при сборке (`?raw`).
// scriptId и версия загруженного кода хранятся в «_meta»: повторная установка обновляет тот же скрипт.

import codeSource from '../../apps-script/Code.gs?raw';
import manifestSource from '../../apps-script/appsscript.json?raw';
import type { SheetsApi } from '../google/sheetsApi';
import { a1 } from '../google/a1';
import { GoogleApiError, ScriptApiDisabledError } from '../google/errors';
import { createBoundScript, updateScriptContent, type ScriptFile } from '../google/scriptApi';
import { sheetFor } from '../store/schema';
import { mapHeaders, toStoreError, upsertKeyValue } from '../store/sheetsStore';

export type ScriptInstallResult = { ok: true; scriptId: string } | { ok: false; reason: 'API_DISABLED' | 'FAILED'; message: string };

export interface ScriptDeps {
  createBoundScript: (spreadsheetId: string, title: string) => Promise<{ scriptId: string }>;
  updateScriptContent: (scriptId: string, files: ScriptFile[]) => Promise<void>;
}

const defaultDeps: ScriptDeps = {
  createBoundScript: (id, title) => createBoundScript(id, title),
  updateScriptContent: (id, files) => updateScriptContent(id, files),
};

export const SCRIPT_TITLE = 'Закупки — скрипт таблицы';

export const SCRIPT_FILES: ScriptFile[] = [
  { name: 'Code', type: 'SERVER_JS', source: codeSource },
  { name: 'appsscript', type: 'JSON', source: manifestSource },
];

/** Версия вшитого кода скрипта (хеш исходников) — по ней видно, что скрипт в таблице устарел. */
export const SCRIPT_VERSION: string = (() => {
  let h = 5381;
  const s = SCRIPT_FILES.map((f) => f.source).join('\u0000');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
})();

/** Ключи листа «_meta». */
export async function readMeta(api: SheetsApi, spreadsheetId: string): Promise<Record<string, string>> {
  const def = sheetFor('meta');
  const [rows] = await api.batchGet(spreadsheetId, [a1(def.sheet)]);
  const idx = mapHeaders(def, rows[0] ?? []);
  const k = idx[0] >= 0 ? idx[0] : 0;
  const v = idx[1] >= 0 ? idx[1] : 1;
  const out: Record<string, string> = {};
  for (const row of rows.slice(1)) {
    const key = String(row[k] ?? '').trim();
    if (key) out[key] = String(row[v] ?? '');
  }
  return out;
}

export async function installScript(api: SheetsApi, spreadsheetId: string, deps: ScriptDeps = defaultDeps): Promise<ScriptInstallResult> {
  const metaSheet = sheetFor('meta').sheet;
  try {
    const meta = await readMeta(api, spreadsheetId);
    let scriptId = meta.scriptId?.trim() || '';
    let uploaded = false;
    if (scriptId) {
      try {
        await deps.updateScriptContent(scriptId, SCRIPT_FILES);
        uploaded = true;
      } catch (e) {
        // скрипт удалили из таблицы — создадим новый
        if (!(e instanceof GoogleApiError && e.status === 404)) throw e;
        scriptId = '';
      }
    }
    if (!scriptId) {
      scriptId = (await deps.createBoundScript(spreadsheetId, SCRIPT_TITLE)).scriptId;
      await upsertKeyValue(api, spreadsheetId, metaSheet, 'scriptId', scriptId);
    }
    if (!uploaded) await deps.updateScriptContent(scriptId, SCRIPT_FILES);
    if (meta.scriptVersion !== SCRIPT_VERSION) await upsertKeyValue(api, spreadsheetId, metaSheet, 'scriptVersion', SCRIPT_VERSION);
    return { ok: true, scriptId };
  } catch (e) {
    if (e instanceof ScriptApiDisabledError) {
      return { ok: false, reason: 'API_DISABLED', message: 'Apps Script API выключен. Включите его в настройках Google Apps Script и нажмите «Повторить».' };
    }
    const err = toStoreError(e);
    const detail = e instanceof Error && e.message && e.message !== err.message ? ` (${e.message})` : '';
    return { ok: false, reason: 'FAILED', message: `Не удалось установить скрипт таблицы: ${err.message}${detail}` };
  }
}

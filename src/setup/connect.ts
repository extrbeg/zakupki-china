// Сценарии подключения таблицы: создать новую, привязать выбранную, восстановить привязку при входе,
// открыть таблицу по ссылке (сначала напрямую, окно Google — только при отказе в доступе, G19).

import type { SheetsApi } from '../google/sheetsApi';
import { getAccessToken } from '../google/auth';
import { createSheetsApi } from '../google/sheetsApi';
import { GoogleApiError } from '../google/errors';
import type { PickOptions } from '../google/picker';
import { toStoreError } from '../store/sheetsStore';
import { getBinding, setBinding } from './binding';
import { ensureSchema, NotAppSpreadsheetError, type SchemaReport } from './ensureSchema';
import { ensureGeography } from './geography';
import { installScript, readMeta, SCRIPT_VERSION, type ScriptDeps, type ScriptInstallResult } from './installScript';

export const NEW_SPREADSHEET_TITLE = 'Закупки Китай';

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
}

let defaultApi: SheetsApi | null = null;
/** Sheets API с токеном текущего входа (одна на приложение). */
export function googleSheetsApi(): SheetsApi {
  if (!defaultApi) defaultApi = createSheetsApi(getAccessToken);
  return defaultApi;
}

export interface BindResult { spreadsheetId: string; schema: SchemaReport; script: ScriptInstallResult }

/** Привести таблицу к схеме, внести справочник Китая (G20), поставить скрипт и запомнить привязку. Чужая таблица — NotAppSpreadsheetError; ошибки таблицы — StoreError; сбой скрипта — в результате. */
export async function bindSpreadsheet(api: SheetsApi, email: string, spreadsheetId: string, deps?: ScriptDeps): Promise<BindResult> {
  let schema: SchemaReport;
  try {
    schema = await ensureSchema(api, spreadsheetId);
    await ensureGeography(api, spreadsheetId);
  } catch (e) {
    if (e instanceof NotAppSpreadsheetError) throw e;   // отказ с текстом — показать как есть
    throw toStoreError(e);
  }
  setBinding(email, spreadsheetId);
  const script = await installScript(api, spreadsheetId, deps);
  return { spreadsheetId, schema, script };
}

/** Создать новую таблицу в Drive пользователя и привязать её. */
export async function createAndBind(api: SheetsApi, email: string, deps?: ScriptDeps): Promise<BindResult> {
  let created: { spreadsheetId: string };
  try {
    created = await api.create(NEW_SPREADSHEET_TITLE);
  } catch (e) {
    throw toStoreError(e);
  }
  return bindSpreadsheet(api, email, created.spreadsheetId, deps);
}

/**
 * Привязка, запомненная для email: таблица догоняет схему (обновление приложения) и справочник Китая (один раз, по geoVersion),
 * устаревший скрипт обновляется.
 * Таблица удалена или доступа больше нет — привязка снимается, возвращается null. Сбой сети — StoreError.
 */
export async function restoreBinding(api: SheetsApi, email: string, deps?: ScriptDeps): Promise<string | null> {
  const spreadsheetId = getBinding(email);
  if (!spreadsheetId) return null;
  try {
    await ensureSchema(api, spreadsheetId);
    await ensureGeography(api, spreadsheetId);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 403)) {
      setBinding(email, null);
      return null;
    }
    throw toStoreError(e);
  }
  try {
    const meta = await readMeta(api, spreadsheetId);
    if (meta.scriptId && meta.scriptVersion !== SCRIPT_VERSION) await installScript(api, spreadsheetId, deps);
  } catch { /* скрипт не обязателен для работы — переустановить можно в настройках */ }
  return spreadsheetId;
}

export interface LinkedSpreadsheetDeps {
  /** Прямая проверка доступа: метаданные таблицы по id. */
  getMeta(id: string): Promise<{ title: string }>;
  /** Окно Google с этим файлом (pickSpreadsheet). Отмена — null. */
  pick(options: PickOptions): Promise<{ id: string; name: string } | null>;
}

/**
 * Таблица по ссылке: доступ уже есть (создана приложением или выбрана раньше, в том числе на другом устройстве) —
 * сразу, без окна Google; 403/404 — окно Google с этим файлом (drive.file даёт доступ после «Выбрать»).
 * Отмена окна — null; прочие сбои проверки — StoreError, окно не открывается.
 */
export async function openLinkedSpreadsheet(
  fileId: string,
  deps: LinkedSpreadsheetDeps,
  pickOptions: Omit<PickOptions, 'fileId'> = {},
): Promise<{ id: string; name: string } | null> {
  try {
    const meta = await deps.getMeta(fileId);
    return { id: fileId, name: meta.title };
  } catch (e) {
    if (!(e instanceof GoogleApiError && (e.status === 403 || e.status === 404))) throw toStoreError(e);
  }
  return deps.pick({ fileId, ...pickOptions });
}

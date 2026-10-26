// Привязка таблицы пользователя: схема листов, скрипт таблицы, запомненная привязка.
export { ensureSchema, NotAppSpreadsheetError, NOT_APP_SPREADSHEET_TEXT, type SchemaReport } from './ensureSchema';
export { installScript, readMeta, SCRIPT_FILES, SCRIPT_VERSION, type ScriptDeps, type ScriptInstallResult } from './installScript';
export { getBinding, setBinding } from './binding';
export { bindSpreadsheet, createAndBind, restoreBinding, googleSheetsApi, spreadsheetUrl, type BindResult } from './connect';
export { DEFAULT_COST_TYPES, DEFAULT_SETTINGS } from './defaults';

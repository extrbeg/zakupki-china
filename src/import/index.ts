// Перенос из старой таблицы: чтение видимых листов, чистый маппинг, запись в подключённую таблицу.
export { LEGACY_SHEETS, type LegacyRaw, type LegacySheet, type ImportData, type ImportPlan, type ImportProblem } from './types';
export { mapLegacy } from './mapLegacy';
export { readLegacy, NO_LEGACY_SHEETS_TEXT } from './readLegacy';
export { applyImport, hasUserData, mergeWithExisting, type ImportResult } from './applyImport';

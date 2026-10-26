// Разделитель аргументов в формулах перевода (G27, история 96).
// В таблице с десятичной запятой (ru_RU) формула с «,» не разбирается — нужен «;».
// Значение хранится в «Настройки» (formulaSeparator); без него — по локали таблицы, без вопроса.
// При входе формулы перевода, записанные с другим разделителем, переписываются один раз: отметка в «_meta».

import type { SheetsApi } from '../google/sheetsApi';
import { a1 } from '../google/a1';
import type { FormulaSeparator } from '../store/schema';
import { sheetFor } from '../store/schema';
import {
  FORMULA_SEPARATOR_KEY, FORMULA_SEPARATOR_META_KEY, SheetsStore, mapHeaders, markFormulaSeparator, parseSeparator,
  rewriteTranslateFormulas, separatorForLocale, upsertKeyValue,
} from '../store/sheetsStore';

/** locale — разделитель по локали таблицы (его отмечает шаг выбора при привязке); current — действующий в «Настройки». */
export interface SeparatorState { locale: FormulaSeparator; current: FormulaSeparator }

/** Подписи для выбора на экранах подключения и настроек. */
export const FORMULA_SEPARATOR_OPTIONS: { value: FormulaSeparator; label: string }[] = [
  { value: ',', label: 'Запятая ( , )' },
  { value: ';', label: 'Точка с запятой ( ; )' },
];

const norm = (v: unknown) => String(v ?? '').trim();

async function readKeyValues(api: SheetsApi, spreadsheetId: string, entity: 'settings' | 'meta'): Promise<Record<string, string>> {
  const def = sheetFor(entity);
  const [rows] = await api.batchGet(spreadsheetId, [a1(def.sheet)]);
  const idx = mapHeaders(def, rows[0] ?? []);
  const k = idx[0] >= 0 ? idx[0] : 0;
  const v = idx[1] >= 0 ? idx[1] : 1;
  const out: Record<string, string> = {};
  rows.slice(1).forEach((row) => { const key = norm(row[k]); if (key) out[key] = norm(row[v]); });
  return out;
}

/**
 * Вход и привязка (таблица уже приведена к схеме): нет настройки — записать разделитель по локали;
 * формулы ещё не приводились к действующему разделителю — переписать те, что записаны иначе, и отметить.
 */
export async function syncFormulaSeparator(api: SheetsApi, spreadsheetId: string): Promise<SeparatorState> {
  const meta = await api.getMeta(spreadsheetId);
  const locale = separatorForLocale(meta.locale);
  const settings = await readKeyValues(api, spreadsheetId, 'settings');
  let current = parseSeparator(settings[FORMULA_SEPARATOR_KEY]);
  if (!current) {
    current = locale;
    await upsertKeyValue(api, spreadsheetId, sheetFor('settings').sheet, FORMULA_SEPARATOR_KEY, current);
  }
  const applied = (await readKeyValues(api, spreadsheetId, 'meta'))[FORMULA_SEPARATOR_META_KEY];
  if (applied !== current) {
    await rewriteTranslateFormulas(api, spreadsheetId, current, 'mismatched');
    await markFormulaSeparator(api, spreadsheetId, current);
  }
  return { locale, current };
}

/** Выбор пользователя (шаг привязки): записать в «Настройки» и переписать формулы перевода во всех строках «Позиций». */
export function applyFormulaSeparator(api: SheetsApi, spreadsheetId: string, sep: FormulaSeparator): Promise<void> {
  return new SheetsStore(api, spreadsheetId).setFormulaSeparator(sep);
}

// Типы переноса из старой таблицы «Закупки Китай AREC» (interfaces.md §5).

import type { Dataset } from '../domain/model';

/** Листы старой таблицы, которые переносятся (история 51). Остальные и скрытые не читаются. */
export const LEGACY_SHEETS = ['Заказы', 'Затраты по заказам', 'Списки', 'Поставщики исходник', 'Платежные агенты', 'Перевозчики'] as const;
export type LegacySheet = (typeof LEGACY_SHEETS)[number];

/** Значения листов как их отдаёт batchGet (UNFORMATTED_VALUE + SERIAL_NUMBER). */
export interface LegacyRaw { sheets: Record<string, { hidden: boolean; values: unknown[][] }> }
/** Проблема данных: лист и номер строки листа (с 1). */
export interface ImportProblem { sheet: string; row: number; message: string }
export type ImportData = Partial<Omit<Dataset, 'settings' | 'meta'>>;
export interface ImportPlan {
  data: ImportData; problems: ImportProblem[]; stats: Record<string, number>;
  /** id записи → строка старой таблицы, из которой она взята (заказ — первая строка группы). */
  origins?: Record<string, { sheet: string; row: number }>;
}

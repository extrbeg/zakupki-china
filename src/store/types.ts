// Интерфейс хранилища. Реализации: LocalStore (демо и тесты), SheetsStore (таблица пользователя, таск 08).

import type { Dataset, EntityName } from '../domain/model';

export type ReportSheet = 'Себестоимость';
export type ReportRow = (string | number | null)[];

export interface Store {
  kind: 'sheets' | 'local';
  load(): Promise<Dataset>;
  insert<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void>;
  update<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void>;
  remove(entity: EntityName, id: string): Promise<void>;
  bulkInsert<E extends EntityName>(entity: E, records: Dataset[E]): Promise<void>;
  setSetting(key: string, value: string): Promise<void>;
  writeReport(sheet: ReportSheet, rows: ReportRow[]): Promise<void>;   // A01: очистить лист и записать
}

export type StoreErrorKind = 'network' | 'auth' | 'notFound' | 'conflict' | 'unknown';

export class StoreError extends Error {
  readonly kind: StoreErrorKind;
  constructor(kind: StoreErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? STORE_ERROR_TEXT[kind]);
    this.name = 'StoreError';
    this.kind = kind;
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Русские тексты ошибок хранилища для интерфейса. */
export const STORE_ERROR_TEXT: Record<StoreErrorKind, string> = {
  network: 'Нет связи с таблицей',
  auth: 'Нужно войти в Google заново',
  notFound: 'Запись не найдена в таблице — возможно, её удалили',
  conflict: 'Запись с таким id уже есть',
  unknown: 'Не удалось выполнить операцию с таблицей',
};

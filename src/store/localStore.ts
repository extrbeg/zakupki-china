// Хранилище в localStorage: демо-режим и тесты UI. Тот же интерфейс Store, что у таблицы.

import type { Dataset, EntityName } from '../domain/model';
import { ENTITY_NAMES, emptyDataset } from '../domain/model';
import type { ReportRow, ReportSheet, Store } from './types';
import { StoreError } from './types';

type Rec = { id: string };

// Если localStorage недоступен (приватный режим, запрет сайта) — держим данные в памяти вкладки.
const memory = new Map<string, string>();
function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function normalize(raw: Partial<Dataset> | undefined): Dataset {
  const ds = emptyDataset();
  if (!raw || typeof raw !== 'object') return ds;
  for (const e of ENTITY_NAMES) {
    const v = raw[e];
    if (Array.isArray(v)) (ds as unknown as Record<string, unknown[]>)[e] = v;
  }
  if (raw.settings && typeof raw.settings === 'object') ds.settings = { ...raw.settings };
  if (raw.meta && typeof raw.meta === 'object') ds.meta = { ...raw.meta };
  return ds;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export class LocalStore implements Store {
  readonly kind = 'local' as const;
  private readonly key: string;

  constructor(storageKey: string, seed?: Partial<Dataset>) {
    this.key = storageKey;
    if (this.readDataset() === null) this.writeDataset(normalize(seed ? clone(seed) : undefined));
  }

  async load(): Promise<Dataset> {
    return clone(this.current());
  }

  async insert<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    const ds = this.current();
    const list = ds[entity] as Rec[];
    if (list.some((r) => r.id === (record as Rec).id)) throw new StoreError('conflict');
    list.push(clone(record) as Rec);
    this.writeDataset(ds);
  }

  async update<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    const ds = this.current();
    const list = ds[entity] as Rec[];
    const i = list.findIndex((r) => r.id === (record as Rec).id);
    if (i < 0) throw new StoreError('notFound');
    list[i] = clone(record) as Rec;
    this.writeDataset(ds);
  }

  async remove(entity: EntityName, id: string): Promise<void> {
    const ds = this.current();
    const list = ds[entity] as Rec[];
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) throw new StoreError('notFound');
    list.splice(i, 1);
    this.writeDataset(ds);
  }

  async bulkInsert<E extends EntityName>(entity: E, records: Dataset[E]): Promise<void> {
    const ds = this.current();
    const list = ds[entity] as Rec[];
    list.push(...(clone(records) as Rec[]));
    this.writeDataset(ds);
  }

  async setSetting(key: string, value: string): Promise<void> {
    const ds = this.current();
    ds.settings[key] = value;
    this.writeDataset(ds);
  }

  async writeReport(sheet: ReportSheet, rows: ReportRow[]): Promise<void> {
    writeRaw(this.reportKey(sheet), JSON.stringify(rows));
  }

  /** Содержимое листа отчёта (в таблице его видно глазами; в демо — только так). */
  readReport(sheet: ReportSheet): ReportRow[] {
    const raw = readRaw(this.reportKey(sheet));
    if (!raw) return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as ReportRow[]) : [];
    } catch {
      return [];
    }
  }

  private reportKey(sheet: ReportSheet): string {
    return `${this.key}:report:${sheet}`;
  }

  private readDataset(): Dataset | null {
    const raw = readRaw(this.key);
    if (raw === null) return null;
    try {
      return normalize(JSON.parse(raw) as Partial<Dataset>);
    } catch {
      return null;
    }
  }

  private current(): Dataset {
    return this.readDataset() ?? emptyDataset();
  }

  private writeDataset(ds: Dataset): void {
    writeRaw(this.key, JSON.stringify(ds));
  }
}

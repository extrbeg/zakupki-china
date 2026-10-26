// Данные приложения в памяти + сессия (демо или таблица Google).
// Экраны берут всё через useData(); хранилище выбирает сессия (useSession()).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Dataset, EntityName, ISODate } from '../domain/model';
import { computeCosting, type CostingResult } from '../domain/costing';
import { emptyDataset } from '../domain/model';
import type { Store } from '../store/types';
import { StoreError } from '../store/types';

// ---------- движок себестоимости ----------
// Типы результата — из src/domain/costing; реэкспорт оставлен для экранов, импортирующих их отсюда.

export type { RatePick } from '../domain/rates';
export type { BatchCost, CostCategory, CostRub, CostWarning, CostingResult, CustomsForecast, LineCost, OrderTotals } from '../domain/costing';

// ---------- даты ----------

/** Сегодня в локальном часовом поясе, `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): ISODate {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// ---------- данные ----------

export interface DataApi {
  ds: Dataset; costing: CostingResult; store: Store; today: ISODate;
  status: 'loading' | 'ready' | 'error'; error?: StoreError;
  save<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void>;   // insert или update по id, затем локально обновляет ds
  remove(entity: EntityName, id: string): Promise<void>;
  reload(): Promise<void>;
}

const DataCtx = createContext<DataApi | null>(null);

const asStoreError = (e: unknown): StoreError =>
  e instanceof StoreError ? e : new StoreError('unknown', e instanceof Error ? e.message : undefined, { cause: e });

type Rec = { id: string };

export function DataProvider({ store, today: todayProp, children }: { store: Store; today?: ISODate; children: ReactNode }) {
  const [ds, setDs] = useState<Dataset>(emptyDataset);
  const [status, setStatus] = useState<DataApi['status']>('loading');
  const [error, setError] = useState<StoreError | undefined>(undefined);
  const [today, setToday] = useState<ISODate>(() => todayProp ?? todayISO());
  const dsRef = useRef(ds);
  dsRef.current = ds;
  const loadSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    setStatus('loading');
    try {
      const data = await store.load();
      if (seq !== loadSeq.current) return;
      setDs(data);
      setError(undefined);
      setStatus('ready');
      if (!todayProp) setToday(todayISO());
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(asStoreError(e));
      setStatus('error');
    }
  }, [store, todayProp]);

  useEffect(() => {
    setDs(emptyDataset());
    void reload();
  }, [reload]);

  const save = useCallback(async <E extends EntityName>(entity: E, record: Dataset[E][number]) => {
    const rec = record as Rec;
    const exists = (dsRef.current[entity] as Rec[]).some((r) => r.id === rec.id);
    if (exists) await store.update(entity, record);
    else await store.insert(entity, record);
    setDs((prev) => {
      const list = prev[entity] as Rec[];
      const i = list.findIndex((r) => r.id === rec.id);
      const next = i >= 0 ? list.map((r, j) => (j === i ? rec : r)) : [...list, rec];
      return { ...prev, [entity]: next };
    });
  }, [store]);

  const remove = useCallback(async (entity: EntityName, id: string) => {
    await store.remove(entity, id);
    setDs((prev) => ({ ...prev, [entity]: (prev[entity] as Rec[]).filter((r) => r.id !== id) }));
  }, [store]);

  const costing = useMemo(() => computeCosting(ds, today), [ds, today]);

  const value = useMemo<DataApi>(
    () => ({ ds, costing, store, today, status, error, save, remove, reload }),
    [ds, costing, store, today, status, error, save, remove, reload],
  );
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData(): DataApi {
  const v = useContext(DataCtx);
  if (!v) throw new Error('useData() вызван вне <DataProvider>');
  return v;
}

// ---------- сессия ----------

export type Session =
  | { mode: 'none' }
  | { mode: 'demo' }
  | { mode: 'sheets'; store: Store; email: string; spreadsheetId: string };

export interface SessionApi {
  session: Session;
  /** Задан ли VITE_GOOGLE_CLIENT_ID — без него вход Google скрыт. */
  googleConfigured: boolean;
  startDemo(): void;
  /** Подключить таблицу пользователя (таск 08: после входа и привязки). */
  startSheets(store: Store, info: { email: string; spreadsheetId: string }): void;
  /** Выйти из демо или отключиться от таблицы — вернуться на экран входа. */
  endSession(): void;
}

const MODE_KEY = 'zk:mode';
const SessionCtx = createContext<SessionApi | null>(null);

function readMode(): Session {
  try {
    return localStorage.getItem(MODE_KEY) === 'demo' ? { mode: 'demo' } : { mode: 'none' };
  } catch {
    return { mode: 'none' };
  }
}
function writeMode(mode: 'demo' | null) {
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch { /* без localStorage режим живёт до перезагрузки */ }
}

export function isGoogleConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(readMode);
  const api = useMemo<SessionApi>(() => ({
    session,
    googleConfigured: isGoogleConfigured(),
    startDemo: () => { writeMode('demo'); setSession({ mode: 'demo' }); },
    startSheets: (store, info) => { writeMode(null); setSession({ mode: 'sheets', store, ...info }); },
    endSession: () => { writeMode(null); setSession({ mode: 'none' }); },
  }), [session]);
  return <SessionCtx.Provider value={api}>{children}</SessionCtx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('useSession() вызван вне <SessionProvider>');
  return v;
}

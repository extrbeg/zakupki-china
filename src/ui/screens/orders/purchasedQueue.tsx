// Отметка «В работу» (`purchased`) на карточке заказа — одна очередь записей на заказ: её используют флажок в таблице товаров
// поставщика (G10) и «Сравнение цен» (G09–G12); итоги поставщика и заказа читают через isOn, поэтому меняются сразу.
//
// Медленная запись (Sheets): отметка показывается сразу (desired), записи идут по очереди, и каждая пишет последнее
// желаемое значение позиции; повтор того же значения не пишется. Пока у позиции есть записи в очереди, показ берётся
// из desired — ответ на промежуточную запись отметку не откатывает. Очередь опустела — показ снова из данных.

import { createContext, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Line } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ErrorBanner } from '../../components';

export interface PurchasedApi {
  /** Отметка с учётом ещё не записанных кликов. */
  isOn(line: Line): boolean;
  toggle(line: Line): void;
  setMany(lines: Line[], value: (line: Line) => boolean): void;
  /** Меняется при каждом изменении отметок — для зависимостей useMemo. */
  version: number;
  /** Ошибка последней записи; undefined — нет. */
  saveError: unknown;
}

const Ctx = createContext<PurchasedApi | null>(null);

export function PurchasedProvider({ children }: { children: ReactNode }) {
  const data = useData();
  const latest = useRef(data.ds);
  latest.current = data.ds;
  const saveRef = useRef(data.save);
  saveRef.current = data.save;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const desired = useRef(new Map<string, boolean>());
  const written = useRef(new Map<string, boolean>());
  const pending = useRef(new Map<string, number>());
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [saveError, setSaveError] = useState<unknown>(undefined);

  const api = useMemo<PurchasedApi>(() => {
    const write = (id: string) => async () => {
      try {
        const want = desired.current.get(id);
        const current = latest.current.lines.find((l) => l.id === id);
        if (want === undefined || !current) return;
        const have = written.current.get(id) ?? !!current.purchased;
        if (want === have) return;
        setSaveError(undefined);
        await saveRef.current('lines', { ...current, purchased: want });
        written.current.set(id, want);
      } catch (e) {
        setSaveError(e);
      } finally {
        const left = (pending.current.get(id) ?? 1) - 1;
        if (left > 0) pending.current.set(id, left);
        else {
          pending.current.delete(id);
          desired.current.delete(id);
          written.current.delete(id);
          bump();
        }
      }
    };
    const isOn = (l: Line) => desired.current.get(l.id) ?? !!l.purchased;
    const setMany = (lines: Line[], value: (l: Line) => boolean) => {
      for (const l of lines) {
        desired.current.set(l.id, value(l));
        pending.current.set(l.id, (pending.current.get(l.id) ?? 0) + 1);
        queue.current = queue.current.then(write(l.id));
      }
      bump();
    };
    return { isOn, setMany, toggle: (l) => setMany([l], (x) => !isOn(x)), version, saveError };
  }, [version, saveError]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePurchased(): PurchasedApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePurchased: нет PurchasedProvider (он стоит на карточке заказа)');
  return api;
}

/** Баннер ошибки записи отметки «В работу» — один на вкладку. */
export function PurchasedSaveError() {
  const { saveError } = usePurchased();
  return saveError !== undefined ? <ErrorBanner error={saveError} /> : null;
}

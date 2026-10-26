// Записи позиции с карточки заказа — одна очередь на заказ: отметка «В работу» (`purchased`; флажок в таблице товаров G10 и
// «Сравнение цен» G09–G12) и свой расчётный коэффициент (`coef`; ячейка таблицы, G23). Итоги поставщика и заказа читают
// отметку через isOn, поэтому меняются сразу. Общая очередь нужна, чтобы две записи одной строки не затёрли друг друга.
//
// Медленная запись (Sheets): отметка показывается сразу (desired), записи идут по очереди, и каждая пишет последнее
// желаемое значение позиции; повтор того же значения не пишется. Пока у позиции есть записи в очереди, показ берётся
// из desired — ответ на промежуточную запись отметку не откатывает. Очередь опустела — показ снова из данных.
// Текст поля коэффициента держит сама ячейка (см. LinesSection), очередь только пишет.

import { createContext, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { Line } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ErrorBanner } from '../../components';

export interface PurchasedApi {
  /** Отметка с учётом ещё не записанных кликов. */
  isOn(line: Line): boolean;
  toggle(line: Line): void;
  setMany(lines: Line[], value: (line: Line) => boolean): void;
  /** Свой расчётный коэффициент позиции (undefined — как у поставщика); промис завершается, когда запись обработана. */
  setCoef(lineId: string, coef: number | undefined): Promise<void>;
  /** Меняется при каждом изменении отметок — для зависимостей useMemo. */
  version: number;
  /** Ошибка последней записи; undefined — нет. */
  saveError: unknown;
}

/** Что пользователь хочет видеть записанным у позиции; необъявленное поле не трогаем. */
interface Want { purchased?: boolean; coef?: { value: number | undefined } }

const Ctx = createContext<PurchasedApi | null>(null);

export function PurchasedProvider({ children }: { children: ReactNode }) {
  const data = useData();
  const latest = useRef(data.ds);
  latest.current = data.ds;
  const saveRef = useRef(data.save);
  saveRef.current = data.save;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const desired = useRef(new Map<string, Want>());
  const written = useRef(new Map<string, Want>());
  const pending = useRef(new Map<string, number>());
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const [saveError, setSaveError] = useState<unknown>(undefined);

  const api = useMemo<PurchasedApi>(() => {
    const write = (id: string) => async () => {
      try {
        const want = desired.current.get(id);
        const current = latest.current.lines.find((l) => l.id === id);
        if (want === undefined || !current) return;
        // Основа записи — строка из данных, поверх неё то, что мы сами уже записали (данные могут отстать на ответ записи).
        const done = written.current.get(id);
        const base: Line = { ...current };
        if (done?.purchased !== undefined) base.purchased = done.purchased;
        if (done?.coef) { if (done.coef.value === undefined) delete base.coef; else base.coef = done.coef.value; }
        const record: Line = { ...base };
        if (want.purchased !== undefined) record.purchased = want.purchased;
        if (want.coef) { if (want.coef.value === undefined) delete record.coef; else record.coef = want.coef.value; }
        if (record.purchased === base.purchased && Object.is(record.coef, base.coef)) return;
        setSaveError(undefined);
        await saveRef.current('lines', record);
        written.current.set(id, { purchased: record.purchased, coef: { value: record.coef } });
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
    const enqueue = (id: string, patch: Want): Promise<void> => {
      desired.current.set(id, { ...desired.current.get(id), ...patch });
      pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
      const run = queue.current.then(write(id));
      queue.current = run;
      return run;
    };
    const isOn = (l: Line) => desired.current.get(l.id)?.purchased ?? !!l.purchased;
    const setMany = (lines: Line[], value: (l: Line) => boolean) => {
      for (const l of lines) void enqueue(l.id, { purchased: value(l) });
      bump();
    };
    const setCoef = (lineId: string, coef: number | undefined) => {
      const run = enqueue(lineId, { coef: { value: coef } });
      bump();
      return run;
    };
    return { isOn, setMany, setCoef, toggle: (l) => setMany([l], (x) => !isOn(x)), version, saveError };
  }, [version, saveError]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePurchased(): PurchasedApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('usePurchased: нет PurchasedProvider (он стоит на карточке заказа)');
  return api;
}

/** Баннер ошибки записи отметки «В работу» или коэффициента — один на вкладку. */
export function PurchasedSaveError() {
  const { saveError } = usePurchased();
  return saveError !== undefined ? <ErrorBanner error={saveError} /> : null;
}

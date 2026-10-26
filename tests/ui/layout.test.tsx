import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../src/ui/App';
import { Layout } from '../../src/ui/layout/Layout';
import { DataProvider, SessionProvider, useData } from '../../src/ui/DataContext';
import { ImportFlow, type ImportDeps } from '../../src/ui/screens/import/ImportScreen';
import { LocalStore } from '../../src/store/localStore';
import { StoreError, type Store } from '../../src/store/types';
import type { Dataset } from '../../src/domain/model';
import { SYNTHETIC_LEGACY } from '../../fixtures/legacy/synthetic';

let n = 0;

/** Хранилище, у которого первые `failures` загрузок падают «нет сети». */
function flakyStore(seed: Partial<Dataset>, failures: number): Store {
  const base = new LocalStore(`zk:t:layout${++n}`, seed);
  let left = failures;
  return Object.assign(Object.create(base) as Store, {
    load: async () => {
      if (left > 0) { left -= 1; throw new StoreError('network'); }
      return base.load();
    },
  });
}

function renderApp(path: string, store: Store) {
  return render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <DataProvider store={store} today="2026-10-25">
          <Layout><AppRoutes /></Layout>
        </DataProvider>
      </MemoryRouter>
    </SessionProvider>,
  );
}

const seed: Partial<Dataset> = {
  orders: [{ id: 'o1', number: 1, date: '2026-10-01', costsComplete: false }],
  shipments: [{ id: 'sh1', number: 'К-1', mode: 'air', vatRate: 22 }],
};

afterEach(() => localStorage.clear());

describe('оболочка: ошибка загрузки', () => {
  for (const path of ['/', '/orders/o1', '/shipments', '/shipments/sh1', '/costs', '/rates', '/costing']) {
    it(`${path}: ровно один баннер «Нет связи с таблицей — Повторить»; повтор открывает экран`, async () => {
      renderApp(path, flakyStore(seed, 1));
      await screen.findByRole('alert');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Повторить' })).toHaveLength(1);
      expect(screen.getByRole('alert').textContent).toContain('Нет связи с таблицей');
      fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    });
  }
});

/** Хранилище: первая загрузка удаётся, все следующие — «нет сети». */
function failsAfterFirst(seed: Partial<Dataset>): Store {
  const base = new LocalStore(`zk:t:layout${++n}`, seed);
  let calls = 0;
  return Object.assign(Object.create(base) as Store, {
    load: async () => {
      calls += 1;
      if (calls > 1) throw new StoreError('network');
      return base.load();
    },
  });
}

function ReloadButton() {
  const { reload } = useData();
  return <button type="button" onClick={() => void reload()}>перечитать</button>;
}

describe('оболочка: ошибка повторной загрузки', () => {
  for (const path of ['/', '/orders/o1', '/shipments', '/shipments/sh1', '/costs', '/rates', '/costing']) {
    it(`${path}: экран остаётся, баннер один`, async () => {
      render(
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <DataProvider store={failsAfterFirst(seed)} today="2026-10-25">
              <Layout><AppRoutes /><ReloadButton /></Layout>
            </DataProvider>
          </MemoryRouter>
        </SessionProvider>,
      );
      const heading = await screen.findByRole('heading', { level: 1 });
      const title = heading.textContent;
      fireEvent.click(screen.getByRole('button', { name: 'перечитать' }));
      await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Повторить' })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title);
    });
  }
});

describe('оболочка: повторная загрузка не размонтирует экран', () => {
  it('после импорта отчёт «Перенесено» и список пропущенных остаются на экране', async () => {
    const store = new LocalStore(`zk:t:layout${++n}`, { orders: [{ id: 'o-old', number: 1, date: '2026-01-01', costsComplete: false }] });
    const deps: ImportDeps = {
      pick: async () => ({ id: 'old-sheet', name: 'Закупки Китай AREC' }),
      read: async () => SYNTHETIC_LEGACY,
      currentSpreadsheetId: 'new-sheet',
    };
    render(
      <SessionProvider>
        <MemoryRouter>
          <DataProvider store={store} today="2026-10-25">
            <Layout><ImportFlow deps={deps} /></Layout>
          </DataProvider>
        </MemoryRouter>
      </SessionProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await screen.findByText('В таблице уже есть данные');
    fireEvent.click(screen.getByLabelText(/Добавить к существующим данным/));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await screen.findByText(/Перенесено из/);
    // reload() после импорта завершился — данные перечитаны, а отчёт на месте
    await waitFor(async () => expect((await store.load()).orders.length).toBeGreaterThan(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByText(/Перенесено из/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Пропущено' })).toBeTruthy();
    expect(screen.getByText(/Заказ № 1 уже есть в таблице/)).toBeTruthy();
    expect(screen.queryByText('Загрузка…')).toBeNull();
  });
});

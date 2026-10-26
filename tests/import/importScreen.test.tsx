import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ImportScreen, { ImportFlow, type ImportDeps } from '../../src/ui/screens/import/ImportScreen';
import { DataProvider, SessionProvider } from '../../src/ui/DataContext';
import { LocalStore } from '../../src/store/localStore';
import type { Dataset } from '../../src/domain/model';
import { SYNTHETIC_LEGACY } from '../../fixtures/legacy/synthetic';

let n = 0;

function renderFlow(seed: Partial<Dataset> | undefined, deps: Partial<ImportDeps> = {}) {
  const store = new LocalStore(`zk:t:importui${++n}`, seed);
  const read: string[] = [];
  const full: ImportDeps = {
    pick: async () => ({ id: 'old-sheet', name: 'Закупки Китай AREC' }),
    read: async (id) => { read.push(id); return SYNTHETIC_LEGACY; },
    currentSpreadsheetId: 'new-sheet',
    ...deps,
  };
  render(
    <MemoryRouter>
      <DataProvider store={store} today="2026-10-25">
        <ImportFlow deps={full} />
      </DataProvider>
    </MemoryRouter>,
  );
  return { store, read };
}

const statRow = (label: string) =>
  within(screen.getByRole('table', { name: 'Что будет перенесено' })).getByRole('row', { name: new RegExp(`^${label} \\d+$`) });

describe('экран «Импорт из старой таблицы»', () => {
  afterEach(() => localStorage.clear());

  it('выбор таблицы → предпросмотр количества и проблем → импорт в пустую таблицу', async () => {
    const { store, read } = renderFlow(undefined);
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await screen.findByText(/Предпросмотр/);
    expect(read).toEqual(['old-sheet']);
    expect(within(statRow('Заказы')).getByText('3')).toBeTruthy();
    expect(within(statRow('Позиции')).getByText('5')).toBeTruthy();
    expect(within(statRow('Поставщики')).getByText('4')).toBeTruthy();
    expect(within(statRow('Затраты')).getByText('4')).toBeTruthy();
    expect(within(statRow('Курсы')).getByText('3')).toBeTruthy();
    expect(within(statRow('Города')).getByText('3')).toBeTruthy();
    const problems = screen.getByRole('table', { name: /Проблемы данных/ });
    expect(within(problems).getByText(/Нет номера заказа — строка пропущена/)).toBeTruthy();
    expect(within(problems).getByText(/Номер заказа — дата 17\.01\.2026/)).toBeTruthy();
    expect(screen.queryByText('В таблице уже есть данные')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Импортировать' }));
    await screen.findByText(/Перенесено/);
    const ds = await store.load();
    expect(ds.orders.map((o) => o.number).sort((a, b) => a - b)).toEqual([1, 3, 46039]);
    expect(ds.costs).toHaveLength(4);
  });

  it('в непустую таблицу — предупреждение и явное подтверждение «добавить»', async () => {
    const { store } = renderFlow({ orders: [{ id: 'o-old', number: 1, date: '2026-01-01', costsComplete: false }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await screen.findByText('В таблице уже есть данные');
    const add = screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Импортировать' })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Добавить к существующим данным/));
    expect(add.disabled).toBe(false);
    fireEvent.click(add);
    await screen.findByText(/Перенесено/);
    expect(screen.getByText(/Заказ № 1 уже есть в таблице/)).toBeTruthy();
    const ds = await store.load();
    expect(ds.orders.map((o) => o.number).sort((a, b) => a - b)).toEqual([1, 3, 46039]);
  });

  it('выбрана сама подключённая таблица — отказ без чтения', async () => {
    const { read } = renderFlow(undefined, { pick: async () => ({ id: 'new-sheet', name: 'Закупки Китай' }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await screen.findByText(/Это подключённая таблица/);
    expect(read).toEqual([]);
  });

  it('ошибка чтения показывается текстом, данные не меняются', async () => {
    const { store } = renderFlow(undefined, { read: async () => { throw new Error('В выбранной таблице нет листов старой таблицы («Заказы»).'); } });
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await screen.findByText(/нет листов старой таблицы/);
    await waitFor(async () => expect((await store.load()).orders).toEqual([]));
  });

  it('в демо-режиме импорт недоступен — нужна подключённая таблица Google', async () => {
    localStorage.setItem('zk:mode', 'demo');
    render(
      <SessionProvider>
        <MemoryRouter>
          <DataProvider store={new LocalStore(`zk:t:importui${++n}`)} today="2026-10-25">
            <ImportScreen />
          </DataProvider>
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(await screen.findByText(/Нужна подключённая таблица Google/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Выбрать старую таблицу' })).toBeNull();
  });
});

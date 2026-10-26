import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/ui/App';

const MENU = ['Заказы', 'Поставки', 'Затраты', 'Себестоимость', 'Курсы', 'Поставщики', 'Платёжные агенты', 'Перевозчики', 'География', 'Списки', 'Настройки', 'Что нового'];

function openAt(hash: string, demo = true) {
  if (demo) localStorage.setItem('zk:mode', 'demo');
  window.location.hash = hash;
  return render(<App />);
}

afterEach(() => {
  vi.unstubAllEnvs();
  window.location.hash = '';
});

describe('вход', () => {
  it('без сессии — экран входа с «Попробовать без Google»; вход Google скрыт без VITE_GOOGLE_CLIENT_ID', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    openAt('#/', false);
    expect(screen.getByRole('button', { name: 'Попробовать без Google' })).toBeTruthy();
    expect(screen.queryByTestId('google-connect')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('с VITE_GOOGLE_CLIENT_ID на экране входа есть блок подключения Google', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    openAt('#/', false);
    expect(screen.getByTestId('google-connect')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Попробовать без Google' })).toBeTruthy();
  });

  it('демо: меню со всеми разделами и плашка; выход из демо возвращает на вход', async () => {
    openAt('#/', false);
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать без Google' }));
    expect(await screen.findByText('Демо — данные только в этом браузере')).toBeTruthy();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getAllByRole('link').map((a) => a.textContent).filter((t) => !t?.startsWith('Версия '))).toEqual(MENU);
    expect(localStorage.getItem('zk:mode')).toBe('demo');
    fireEvent.click(screen.getByRole('button', { name: 'Выйти из демо' }));
    expect(screen.getByRole('button', { name: 'Попробовать без Google' })).toBeTruthy();
    expect(localStorage.getItem('zk:mode')).toBeNull();
  });
});

describe('маршруты interfaces.md §8 ведут на свои экраны', () => {
  const routes: [string, string][] = [
    ['#/', 'Заказы'], ['#/orders/demo_ord_1', 'Заказ'], ['#/shipments', 'Поставки'], ['#/shipments/demo_sh_1', 'Поставка'],
    ['#/costs', 'Затраты'], ['#/costing', 'Себестоимость'], ['#/rates', 'Курсы'], ['#/suppliers', 'Поставщики'],
    ['#/suppliers/demo_sup_1', 'Поставщик'], ['#/agents', 'Платёжные агенты'], ['#/carriers', 'Перевозчики'], ['#/geography', 'География'], ['#/lists', 'Списки'],
    ['#/settings', 'Настройки'], ['#/import', 'Импорт из старой таблицы'], ['#/connect', 'Подключение таблицы'],
  ];
  for (const [hash, heading] of routes) {
    it(`${hash} → «${heading}»`, async () => {
      openAt(hash);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
    });
  }

  it('неизвестный адрес — «Страница не найдена» со ссылкой на заказы', async () => {
    openAt('#/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeTruthy();
  });
});

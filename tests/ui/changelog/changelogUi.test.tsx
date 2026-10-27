import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChangelogScreen from '../../../src/ui/screens/changelog/ChangelogScreen';
import { WhatsNewBanner, SEEN_VERSION_KEY } from '../../../src/ui/layout/WhatsNewBanner';
import { UpdateBanner } from '../../../src/ui/layout/UpdateBanner';
import { announceUpdate, clearUpdate } from '../../../src/ui/layout/updateBus';
import { Layout } from '../../../src/ui/layout/Layout';
import { AppRoutes } from '../../../src/ui/App';
import { DataProvider, SessionProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';

const inRouter = (ui: React.ReactElement, path = '/') => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

afterEach(() => { clearUpdate(); vi.restoreAllMocks(); });

describe('экран «Что нового»', () => {
  it('версии от новой к старой, у каждой дата; пустой раздел «Исправлено» не показывается', () => {
    inRouter(<ChangelogScreen />);
    const versions = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(versions).toEqual([
      'Версия 0.8.1 · 27.10.2026', 'Версия 0.8.0 · 27.10.2026', 'Версия 0.7.2 · 26.10.2026', 'Версия 0.7.1 · 26.10.2026', 'Версия 0.7.0 · 26.10.2026', 'Версия 0.6.1 · 26.10.2026', 'Версия 0.6.0 · 26.10.2026', 'Версия 0.5.0 · 26.10.2026', 'Версия 0.4.0 · 26.10.2026',
      'Версия 0.3.0 · 26.10.2026', 'Версия 0.2.0 · 26.10.2026', 'Версия 0.1.0 · 25.10.2026',
    ]);
    const v60 = screen.getByRole('region', { name: /Версия 0\.6\.0/ });
    expect(within(v60).getByText('Новое')).toBeTruthy();
    expect(within(v60).queryByText('Исправлено')).toBeNull();
    const v3 = screen.getByRole('region', { name: /Версия 0\.3\.0/ });
    expect(within(v3).getByText('Исправлено')).toBeTruthy();
    expect(within(v3).getByText('В итогах заказа исправлена подпись «Прогноз суммы в РФ».')).toBeTruthy();
  });
});

describe('плашка «Приложение обновлено»', () => {
  it('при первом запуске вообще не показывается, но версия запоминается', () => {
    inRouter(<WhatsNewBanner />);
    expect(screen.queryByText(/Приложение обновлено/)).toBeNull();
    expect(localStorage.getItem(SEEN_VERSION_KEY)).toBe('0.8.1');
  });

  it('после обновления: показывает, раскрывает список, закрывается и больше не появляется', () => {
    localStorage.setItem(SEEN_VERSION_KEY, '0.4.0');
    const { unmount } = inRouter(<WhatsNewBanner />);
    expect(screen.getByRole('status').textContent).toContain('Приложение обновлено до 0.8.1');
    expect(screen.queryByText(/Вся история/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /что нового/i }));
    expect(screen.getByText(/«\+ Добавить…»/)).toBeTruthy();
    expect(screen.getByText(/Экран «Что нового»/)).toBeTruthy();
    expect(screen.queryByText(/Поле «Ссылка на таблицу»/)).toBeNull();
    expect(screen.getByRole('link', { name: /Вся история/ }).getAttribute('href')).toBe('/changelog');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByText(/Приложение обновлено/)).toBeNull();
    expect(localStorage.getItem(SEEN_VERSION_KEY)).toBe('0.8.1');
    unmount();
    inRouter(<WhatsNewBanner />);
    expect(screen.queryByText(/Приложение обновлено/)).toBeNull();
  });

  it('если localStorage недоступен — ничего не показывает и не падает', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    inRouter(<WhatsNewBanner />);
    expect(screen.queryByText(/Приложение обновлено/)).toBeNull();
  });
});

describe('плашка «Доступна новая версия»', () => {
  it('без найденной версии не показывается; когда сообщили — кнопка «Обновить» запускает обновление', async () => {
    const apply = vi.fn(async () => {});
    render(<UpdateBanner />);
    expect(screen.queryByText(/Доступна новая версия/)).toBeNull();
    act(() => announceUpdate(apply));
    expect(screen.getByRole('status').textContent).toContain('Доступна новая версия');
    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));
    expect(apply).toHaveBeenCalledTimes(1);
  });
});

describe('оболочка', () => {
  const renderShell = (path = '/') => render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <DataProvider store={new LocalStore('zk:t:changelog', {})} today="2026-10-26">
          <Layout><AppRoutes /></Layout>
        </DataProvider>
      </MemoryRouter>
    </SessionProvider>,
  );

  it('внизу меню — версия и дата со ссылкой на «Что нового»; пункт меню «Что нового» открывает экран', async () => {
    renderShell();
    const nav = await screen.findByRole('navigation', { name: 'Разделы' });
    const footer = within(nav).getByRole('link', { name: 'Версия 0.8.1 · 27.10.2026' });
    expect(footer.getAttribute('href')).toBe('/changelog');
    fireEvent.click(within(nav).getByRole('link', { name: 'Что нового' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Что нового' })).toBeTruthy();
  });

  it('из настроек есть ссылка «Что нового»', async () => {
    renderShell('/settings');
    const main = await screen.findByRole('main');
    await screen.findByRole('heading', { level: 1, name: 'Настройки' });
    expect(within(main).getByRole('link', { name: 'Что нового' }).getAttribute('href')).toBe('/changelog');
  });
});

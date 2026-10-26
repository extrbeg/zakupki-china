// Раздел «Google-таблица» в настройках (G14, G15; истории 81, 82): виден всегда; в режиме таблицы — название, открыть, сменить,
// поле «Ссылка на таблицу» (окно Google с этим файлом → «Выбрать» → привязка), импорт; в демо — пояснение и docs/setup.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const h = vi.hoisted(() => ({ fake: null as unknown as import('../store/sheetsStoreFake').FakeSheetsApi }));

vi.mock('../../src/google/auth', async (orig) => ({
  ...(await orig<typeof import('../../src/google/auth')>()),
  signIn: vi.fn(async () => ({ email: 'user@example.com' })),
  signOut: vi.fn(),
  lastEmail: vi.fn(() => null),
  getAccessToken: vi.fn(async () => 'tok'),
}));
vi.mock('../../src/google/picker', () => ({ pickSpreadsheet: vi.fn(async () => null) }));
vi.mock('../../src/google/scriptApi', async (orig) => ({
  ...(await orig<typeof import('../../src/google/scriptApi')>()),
  createBoundScript: vi.fn(async () => ({ scriptId: 'scr_ui' })),
  updateScriptContent: vi.fn(async () => {}),
}));
vi.mock('../../src/setup/connect', async (orig) => ({
  ...(await orig<typeof import('../../src/setup/connect')>()),
  googleSheetsApi: () => h.fake,
}));

import { App } from '../../src/ui/App';
import { pickSpreadsheet } from '../../src/google/picker';
import { getBinding, setBinding } from '../../src/setup/binding';

const OLD_ID = 'sp_known_table_0000000000000';
const NEW_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
const LINK = `https://docs.google.com/spreadsheets/d/${NEW_ID}/edit#gid=0`;

beforeEach(() => {
  h.fake = new FakeSheetsApi();
  window.location.hash = '#/';
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.location.hash = '';
});

const section = () => screen.getByRole('region', { name: 'Google-таблица' });

/** Вход с запомненной таблицей OLD_ID → экран «Настройки». */
async function openSettingsSignedIn() {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id-for-test');
  h.fake.seed(OLD_ID, {}, 'Закупки 2026');
  setBinding('user@example.com', OLD_ID);
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
  await screen.findByText('user@example.com', { selector: '.app__user' });
  window.location.hash = '#/settings';
  await screen.findByRole('heading', { level: 1, name: 'Настройки' });
  return section();
}

describe('раздел «Google-таблица»: подключённая таблица', () => {
  it('название, «Открыть таблицу», «Сменить таблицу», поле ссылки, «Импорт из старой таблицы»', async () => {
    const box = await openSettingsSignedIn();
    expect(await within(box).findByText('Закупки 2026')).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'Открыть таблицу' }).getAttribute('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${OLD_ID}/edit`);
    expect(within(box).getByRole('link', { name: 'Сменить таблицу' }).getAttribute('href')).toBe('#/connect');
    expect(within(box).getByLabelText('Ссылка на таблицу')).toBeTruthy();
    expect(within(box).getByRole('button', { name: 'Подключить' })).toBeTruthy();
    expect(within(box).getByRole('link', { name: 'Импорт из старой таблицы' }).getAttribute('href')).toBe('#/import');
  });

  it('вставка ссылки → окно Google с файлом → «Выбрать» → привязка → работа с новой таблицей', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки по ссылке');
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce({ id: NEW_ID, name: 'Закупки по ссылке' });
    const box = await openSettingsSignedIn();
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    expect(await within(box).findByTestId('daily-rates-hint')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith({ fileId: NEW_ID });
    expect(getBinding('user@example.com')).toBe(NEW_ID);
    expect(h.fake.sheetTitles(NEW_ID)).toContain('Заказы');
    fireEvent.click(within(box).getByRole('button', { name: 'Начать работу' }));
    await waitFor(() => expect(within(section()).getByRole('link', { name: 'Открыть таблицу' }).getAttribute('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${NEW_ID}/edit`));
    expect(await within(section()).findByText('Закупки по ссылке')).toBeTruthy();
  });

  it('отмена в окне Google → ничего не меняется', async () => {
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce(null);
    const box = await openSettingsSignedIn();
    const writesBefore = h.fake.writes().length;
    fireEvent.change(within(box).getByLabelText('Ссылка на таблицу'), { target: { value: LINK } });
    fireEvent.click(within(box).getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith({ fileId: NEW_ID }));
    await waitFor(() => expect(within(section()).getByRole('button', { name: 'Подключить' }).hasAttribute('disabled')).toBe(false));
    expect(getBinding('user@example.com')).toBe(OLD_ID);
    expect(h.fake.writes()).toHaveLength(writesBefore);
    expect(within(section()).getByRole('link', { name: 'Открыть таблицу' }).getAttribute('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${OLD_ID}/edit`);
    expect(within(section()).queryByRole('alert')).toBeNull();
  });

  it('неверная ссылка → ошибка у поля, окно не открывается', async () => {
    const box = await openSettingsSignedIn();
    fireEvent.change(within(box).getByLabelText('Ссылка на таблицу'), { target: { value: 'просто текст' } });
    fireEvent.click(within(box).getByRole('button', { name: 'Подключить' }));
    expect(await within(box).findByText('Это не ссылка на Google-таблицу')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
    expect(getBinding('user@example.com')).toBe(OLD_ID);
  });

  it('по ссылке выбрана старая таблица чужой структуры → отказ, привязка прежняя, в неё ничего не пишется', async () => {
    h.fake.seed(NEW_ID, { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] }, 'Закупки Китай AREC');
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce({ id: NEW_ID, name: 'Закупки Китай AREC' });
    const box = await openSettingsSignedIn();
    const writesBefore = h.fake.writes().length;
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    expect((await within(box).findByRole('alert')).textContent).toContain('Это не таблица приложения — для переноса используйте Импорт');
    expect(getBinding('user@example.com')).toBe(OLD_ID);
    expect(h.fake.writes()).toHaveLength(writesBefore);
    expect(within(section()).getByRole('link', { name: 'Открыть таблицу' }).getAttribute('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${OLD_ID}/edit`);
  });

  it('ссылка на уже подключённую таблицу → сообщение, окно не открывается', async () => {
    const box = await openSettingsSignedIn();
    fireEvent.change(within(box).getByLabelText('Ссылка на таблицу'), { target: { value: OLD_ID } });
    fireEvent.click(within(box).getByRole('button', { name: 'Подключить' }));
    expect(await within(box).findByText('Эта таблица уже подключена')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
  });
});

describe('раздел «Google-таблица»: демо-режим', () => {
  it('Google не настроен: раздел виден, пояснение и docs/setup.md, без «Войти и подключить»', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать без Google' }));
    window.location.hash = '#/settings';
    await screen.findByRole('heading', { level: 1, name: 'Настройки' });
    const box = section();
    expect(within(box).getByRole('heading', { level: 2, name: 'Google-таблица' })).toBeTruthy();
    expect(box.textContent).toContain('Подключение появится после входа через Google');
    expect(box.textContent).toContain('docs/setup.md');
    expect(within(box).queryByRole('link', { name: 'Войти и подключить' })).toBeNull();
    expect(within(box).queryByLabelText('Ссылка на таблицу')).toBeNull();
  });

  it('Google настроен: «Войти и подключить» ведёт к входу и подключению таблицы', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id-for-test');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать без Google' }));
    window.location.hash = '#/settings';
    await screen.findByRole('heading', { level: 1, name: 'Настройки' });
    const go = within(section()).getByRole('link', { name: 'Войти и подключить' });
    expect(go.getAttribute('href')).toBe('#/connect');
    fireEvent.click(go);
    expect(await screen.findByRole('button', { name: 'Войти через Google' })).toBeTruthy();
  });
});

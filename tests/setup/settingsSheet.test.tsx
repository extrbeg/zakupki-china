// Раздел «Google-таблица» в настройках (G14, G15; истории 81, 82): виден всегда; в режиме таблицы — название, открыть, сменить,
// поле «Ссылка на таблицу» (окно Google с этим файлом → «Выбрать» → привязка), импорт; в демо — пояснение и docs/setup.md.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('../../src/google/driveApi', () => ({ listAppSpreadsheets: vi.fn(async () => []) }));
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
import { pickSpreadsheet, type PickOptions } from '../../src/google/picker';
import { listAppSpreadsheets } from '../../src/google/driveApi';
import { GoogleApiError } from '../../src/google/errors';
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
  await within(section()).findByText('Закупки 2026', { selector: 'strong' });   // название прочитано — дальше getMeta зовёт только сценарий теста
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

  it('вставка ссылки, доступа нет → окно Google с файлом → «Выбрать» → привязка → работа с новой таблицей', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки по ссылке');
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce({ id: NEW_ID, name: 'Закупки по ссылке' });
    const box = await openSettingsSignedIn();
    h.fake.failNext(new GoogleApiError(403));
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    expect(await within(box).findByTestId('daily-rates-hint')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith(expect.objectContaining({ fileId: NEW_ID }));
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
    await waitFor(() => expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith(expect.objectContaining({ fileId: NEW_ID })));
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

  it('по ссылке (доступ есть) старая таблица чужой структуры → отказ, привязка прежняя, в неё ничего не пишется', async () => {
    h.fake.seed(NEW_ID, { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] }, 'Закупки Китай AREC');
    const box = await openSettingsSignedIn();
    const writesBefore = h.fake.writes().length;
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    expect((await within(box).findByRole('alert')).textContent).toContain('Это не таблица приложения — для переноса используйте Импорт');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
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

describe('раздел «Google-таблица»: без окна Google (G19)', () => {
  it('ссылка на таблицу с доступом → привязка сразу, окно Google не открывается', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки по ссылке');
    const box = await openSettingsSignedIn();
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    expect(await within(box).findByTestId('daily-rates-hint')).toBeTruthy();
    expect(box.textContent).toContain('Таблица «Закупки по ссылке» подключена');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
    expect(getBinding('user@example.com')).toBe(NEW_ID);
  });

  it('«Ваши таблицы приложения»: текущая помечена; касание другой → привязка без окна Google', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки с компьютера');
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([
      { id: NEW_ID, name: 'Закупки с компьютера', modifiedTime: '2026-10-25T21:30:00.000Z' },
      { id: OLD_ID, name: 'Закупки 2026', modifiedTime: '2026-10-20T09:00:00.000Z' },
    ]);
    const box = await openSettingsSignedIn();
    const list = await within(box).findByRole('list', { name: 'Ваши таблицы приложения' });
    const [other, current] = within(list).getAllByRole('button');
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain('подключена');
    expect(other.textContent).toContain('26.10.2026');   // 21:30 UTC — уже 26-е по Москве
    fireEvent.click(other);
    expect(await within(box).findByTestId('daily-rates-hint')).toBeTruthy();
    expect(getBinding('user@example.com')).toBe(NEW_ID);
    expect(h.fake.sheetTitles(NEW_ID)).toContain('Заказы');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
  });

  it('G27: другая таблица из списка → шаг «Разделитель аргументов в формулах» по локали; выбор пишется в её «Настройки»', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки ru');
    h.fake.setLocale(NEW_ID, 'ru_RU');
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([{ id: NEW_ID, name: 'Закупки ru', modifiedTime: '2026-10-25T09:00:00.000Z' }]);
    const box = await openSettingsSignedIn();
    fireEvent.click(await within(box).findByRole('button', { name: /Закупки ru/ }));
    await within(box).findByTestId('daily-rates-hint');
    const group = within(box).getByRole('group', { name: 'Разделитель аргументов в формулах' });
    expect((within(group).getByRole('radio', { name: /Точка с запятой/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: /Запятая/ }));
    fireEvent.click(within(box).getByRole('button', { name: 'Начать работу' }));
    await waitFor(() => expect(within(section()).getByRole('link', { name: 'Открыть таблицу' }).getAttribute('href'))
      .toBe(`https://docs.google.com/spreadsheets/d/${NEW_ID}/edit`));
    expect(h.fake.values(NEW_ID, 'Настройки').find((r) => r[0] === 'formulaSeparator')?.[1]).toBe(',');
  });

  it('касание уже подключённой таблицы → «Эта таблица уже подключена», ничего не пишется', async () => {
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([{ id: OLD_ID, name: 'Закупки 2026', modifiedTime: '2026-10-20T09:00:00.000Z' }]);
    const box = await openSettingsSignedIn();
    const writesBefore = h.fake.writes().length;
    fireEvent.click(await within(box).findByRole('button', { name: /Закупки 2026/ }));
    expect(await within(box).findByText('Эта таблица уже подключена')).toBeTruthy();
    expect(h.fake.writes()).toHaveLength(writesBefore);
  });

  it('список пуст → подсказка', async () => {
    const box = await openSettingsSignedIn();
    expect(await within(box).findByText('Таблиц пока нет: создайте новую или вставьте ссылку')).toBeTruthy();
  });

  it('окно Google не вернуло ответ → поле снова активно, подсказка; поздний ответ всё равно принимается', async () => {
    h.fake.seed(NEW_ID, {}, 'Закупки по ссылке');
    let stall: (() => void) | undefined;
    let late: ((v: { id: string; name: string } | null) => void) | undefined;
    vi.mocked(pickSpreadsheet).mockImplementationOnce((o?: PickOptions) => {
      stall = o?.onStall;
      return new Promise((r) => { late = r; });
    });
    const box = await openSettingsSignedIn();
    h.fake.failNext(new GoogleApiError(403));
    fireEvent.paste(within(box).getByLabelText('Ссылка на таблицу'), { clipboardData: { getData: () => LINK } });
    await waitFor(() => expect(stall).toBeTypeOf('function'));
    expect(within(box).getByRole('button', { name: 'Подключить' }).hasAttribute('disabled')).toBe(true);
    act(() => stall!());
    expect(await within(box).findByText('Окно выбора не вернуло таблицу — выберите её из списка или вставьте ссылку')).toBeTruthy();
    expect(within(box).getByRole('button', { name: 'Подключить' }).hasAttribute('disabled')).toBe(false);
    await act(async () => late!({ id: NEW_ID, name: 'Закупки по ссылке' }));
    expect(await within(box).findByTestId('daily-rates-hint')).toBeTruthy();
    expect(getBinding('user@example.com')).toBe(NEW_ID);
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

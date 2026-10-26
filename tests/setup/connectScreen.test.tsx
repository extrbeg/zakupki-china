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
vi.mock('../../src/google/picker', () => ({ pickSpreadsheet: vi.fn(async () => ({ id: 'sp_picked', name: 'Моя таблица' })) }));
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
import { createBoundScript } from '../../src/google/scriptApi';
import { signIn, signOut } from '../../src/google/auth';
import { ScriptApiDisabledError } from '../../src/google/errors';
import { getBinding, setBinding } from '../../src/setup/binding';
import { pickSpreadsheet, type PickOptions } from '../../src/google/picker';
import { listAppSpreadsheets } from '../../src/google/driveApi';
import { GoogleApiError } from '../../src/google/errors';

beforeEach(() => {
  h.fake = new FakeSheetsApi();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client-id-for-test');
  window.location.hash = '#/';
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('экран подключения', () => {
  it('вход → нет привязки → «Создать новую таблицу» → инструкция по курсам → приложение с email в шапке', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    const create = await screen.findByRole('button', { name: 'Создать новую таблицу' });
    expect(screen.getByRole('button', { name: 'Выбрать существующую' })).toBeTruthy();
    fireEvent.click(create);
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(screen.getByText(/«Закупки» → «Включить ежедневные курсы»/)).toBeTruthy();
    const id = getBinding('user@example.com');
    expect(id).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Начать работу' }));
    expect(await screen.findByText('user@example.com', { selector: '.app__user' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'Заказы' })).toBeTruthy();
  });

  it('«Выбрать существующую» привязывает таблицу из Picker', async () => {
    h.fake.seed('sp_picked', {});
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать существующую' }));
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(getBinding('user@example.com')).toBe('sp_picked');
    expect(h.fake.sheetTitles('sp_picked')).toContain('Заказы');
  });

  it('запомненная привязка: после входа таблица открывается без вопросов', async () => {
    h.fake.seed('sp_known', {});
    setBinding('user@example.com', 'sp_known');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    expect(await screen.findByText('user@example.com', { selector: '.app__user' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Создать новую таблицу' })).toBeNull();
  });

  it('Apps Script API выключен → инструкция со ссылкой и «Повторить»; повтор ставит скрипт', async () => {
    vi.mocked(createBoundScript).mockRejectedValueOnce(new ScriptApiDisabledError());
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать новую таблицу' }));
    const box = await screen.findByTestId('script-api-disabled');
    expect(box.querySelector('a')?.getAttribute('href')).toBe('https://script.google.com/home/usersettings');
    expect(screen.getByRole('button', { name: 'Продолжить без скрипта' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Начать работу' })).toBeTruthy();
  });

  it('сбой сети при создании → баннер «Нет связи с таблицей», повтор работает', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    const create = await screen.findByRole('button', { name: 'Создать новую таблицу' });
    const { GoogleApiError } = await import('../../src/google/errors');
    h.fake.failNext(new GoogleApiError(0));
    fireEvent.click(create);
    expect((await screen.findByRole('alert')).textContent).toContain('Нет связи с таблицей');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
  });

  it('выход в настройках: токен отзывается, возврат на экран входа', async () => {
    h.fake.seed('sp_known', {});
    setBinding('user@example.com', 'sp_known');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    await screen.findByText('user@example.com', { selector: '.app__user' });
    window.location.hash = '#/settings';
    fireEvent.click(await screen.findByRole('button', { name: 'Выйти' }));
    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Войти через Google' })).toBeTruthy();
    expect(vi.mocked(signIn)).toHaveBeenCalledTimes(1);
  });

  it('выбрана чужая таблица со старой структурой → экран показывает отказ и предлагает Импорт', async () => {
    h.fake.seed('sp_picked', { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать существующую' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Это не таблица приложения — для переноса используйте Импорт');
    expect(getBinding('user@example.com')).toBeNull();
    expect(screen.queryByTestId('daily-rates-hint')).toBeNull();
  });
});

const LINK_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
const LINK = `https://docs.google.com/spreadsheets/d/${LINK_ID}/edit?usp=sharing#gid=0`;

async function toChoose() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
  await screen.findByRole('button', { name: 'Создать новую таблицу' });
  return screen.getByLabelText('Ссылка на таблицу') as HTMLInputElement;
}

describe('подключение по ссылке', () => {
  it('вставка ссылки, доступа нет → окно Google с этим файлом → «Выбрать» → привязка, листы созданы', async () => {
    h.fake.seed(LINK_ID, {});
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce({ id: LINK_ID, name: 'Закупки по ссылке' });
    const field = await toChoose();
    h.fake.failNext(new GoogleApiError(403));
    fireEvent.paste(field, { clipboardData: { getData: () => LINK } });
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith(expect.objectContaining({ fileId: LINK_ID }));
    expect(getBinding('user@example.com')).toBe(LINK_ID);
    expect(h.fake.sheetTitles(LINK_ID)).toContain('Заказы');
  });

  it('набранная ссылка, доступа нет → «Подключить» открывает окно с файлом', async () => {
    h.fake.seed(LINK_ID, {});
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce({ id: LINK_ID, name: 'Закупки' });
    const field = await toChoose();
    h.fake.failNext(new GoogleApiError(404));
    fireEvent.change(field, { target: { value: `docs.google.com/spreadsheets/d/${LINK_ID}/edit` } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith(expect.objectContaining({ fileId: LINK_ID }));
    expect(getBinding('user@example.com')).toBe(LINK_ID);
  });

  it('неверная ссылка → ошибка у поля, окно не открывается, ничего не пишется', async () => {
    const field = await toChoose();
    fireEvent.change(field, { target: { value: 'https://docs.google.com/document/d/abc/edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    expect(await screen.findByText('Это не ссылка на Google-таблицу')).toBeTruthy();
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
    expect(getBinding('user@example.com')).toBeNull();
  });

  it('отмена в окне Google → ничего не меняется: та же развилка, привязки нет', async () => {
    vi.mocked(pickSpreadsheet).mockResolvedValueOnce(null);
    const field = await toChoose();
    fireEvent.change(field, { target: { value: LINK } });
    fireEvent.click(screen.getByRole('button', { name: 'Подключить' }));
    await waitFor(() => expect(vi.mocked(pickSpreadsheet)).toHaveBeenCalledWith(expect.objectContaining({ fileId: LINK_ID })));
    expect(await screen.findByRole('button', { name: 'Создать новую таблицу' })).toBeTruthy();
    expect(getBinding('user@example.com')).toBeNull();
    expect(screen.queryByTestId('daily-rates-hint')).toBeNull();
    expect(h.fake.writes()).toEqual([]);
  });

  it('по ссылке (доступ есть) чужая таблица со старой структурой → отказ NotAppSpreadsheetError, ничего не пишется', async () => {
    h.fake.seed(LINK_ID, { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] });
    const field = await toChoose();
    fireEvent.paste(field, { clipboardData: { getData: () => LINK } });
    expect((await screen.findByRole('alert')).textContent).toContain('Это не таблица приложения — для переноса используйте Импорт');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
    expect(getBinding('user@example.com')).toBeNull();
    expect(h.fake.sheetTitles(LINK_ID)).toEqual(['Заказы']);
    expect(h.fake.writes()).toEqual([]);
  });
});

describe('телефон: подключение без окна Google (G19)', () => {
  it('ссылка на таблицу с доступом → привязка сразу, окно Google не открывается', async () => {
    h.fake.seed(LINK_ID, {}, 'Закупки Китай');
    const field = await toChoose();
    fireEvent.paste(field, { clipboardData: { getData: () => LINK } });
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
    expect(getBinding('user@example.com')).toBe(LINK_ID);
    expect(h.fake.sheetTitles(LINK_ID)).toContain('Заказы');
  });

  it('«Ваши таблицы приложения»: названия и даты; касание → привязка без окна Google', async () => {
    h.fake.seed('sp_desk', {}, 'Закупки Китай');
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([
      { id: 'sp_desk', name: 'Закупки Китай', modifiedTime: '2026-10-25T09:30:00.000Z' },
      { id: 'sp_old', name: 'Закупки 2025', modifiedTime: '2025-12-01T10:00:00.000Z' },
    ]);
    await toChoose();
    const list = await screen.findByRole('list', { name: 'Ваши таблицы приложения' });
    const items = within(list).getAllByRole('button');
    expect(items.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Закупки Китай'), expect.stringContaining('Закупки 2025'),
    ]);
    expect(items[0].textContent).toContain('25.10.2026');
    expect(items[1].textContent).toContain('01.12.2025');
    fireEvent.click(items[0]);
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(getBinding('user@example.com')).toBe('sp_desk');
    expect(h.fake.sheetTitles('sp_desk')).toContain('Заказы');
    expect(vi.mocked(pickSpreadsheet)).not.toHaveBeenCalled();
  });

  it('список пуст → подсказка «Таблиц пока нет: создайте новую или вставьте ссылку»', async () => {
    await toChoose();
    expect(await screen.findByText('Таблиц пока нет: создайте новую или вставьте ссылку')).toBeTruthy();
  });

  it('список не загрузился → текст ошибки и «Повторить»; повтор показывает список', async () => {
    vi.mocked(listAppSpreadsheets)
      .mockRejectedValueOnce(new GoogleApiError(0))
      .mockResolvedValueOnce([{ id: 'sp_desk', name: 'Закупки Китай', modifiedTime: '2026-10-25T09:30:00.000Z' }]);
    await toChoose();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Не удалось загрузить список таблиц');
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    const list = await screen.findByRole('list', { name: 'Ваши таблицы приложения' });
    expect(within(list).getByRole('button').textContent).toContain('Закупки Китай');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('из списка выбрана чужая таблица со старой структурой → отказ текстом, привязки нет', async () => {
    h.fake.seed('sp_arec', { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] }, 'Закупки Китай AREC');
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([{ id: 'sp_arec', name: 'Закупки Китай AREC', modifiedTime: '2026-10-01T09:00:00.000Z' }]);
    await toChoose();
    fireEvent.click(await screen.findByRole('button', { name: /Закупки Китай AREC/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Это не таблица приложения — для переноса используйте Импорт');
    expect(getBinding('user@example.com')).toBeNull();
    expect(h.fake.writes()).toEqual([]);
  });

  it('«Сменить таблицу»: текущая привязанная таблица в списке помечена', async () => {
    h.fake.seed('sp_known', {}, 'Закупки Китай');
    setBinding('user@example.com', 'sp_known');
    vi.mocked(listAppSpreadsheets).mockResolvedValueOnce([
      { id: 'sp_other', name: 'Другая', modifiedTime: '2026-10-20T09:00:00.000Z' },
      { id: 'sp_known', name: 'Закупки Китай', modifiedTime: '2026-10-25T09:00:00.000Z' },
    ]);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    await screen.findByText('user@example.com', { selector: '.app__user' });
    window.location.hash = '#/connect';
    const list = await screen.findByRole('list', { name: 'Ваши таблицы приложения' });
    const [other, current] = within(list).getAllByRole('button');
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain('подключена');
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.textContent).not.toContain('подключена');
  });

  it('окно Google не вернуло ответ → ожидание снято, кнопки активны, подсказка; поздний ответ всё равно принимается', async () => {
    h.fake.seed('sp_late', {});
    let stall: (() => void) | undefined;
    let late: ((v: { id: string; name: string } | null) => void) | undefined;
    vi.mocked(pickSpreadsheet).mockImplementationOnce((o?: PickOptions) => {
      stall = o?.onStall;
      return new Promise((r) => { late = r; });
    });
    await toChoose();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать существующую' }));
    await waitFor(() => expect(stall).toBeTypeOf('function'));
    expect(screen.queryByRole('button', { name: 'Выбрать существующую' })).toBeNull();
    act(() => stall!());
    expect(await screen.findByText('Окно выбора не вернуло таблицу — выберите её из списка или вставьте ссылку')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Выбрать существующую' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Создать новую таблицу' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => late!({ id: 'sp_late', name: 'Поздняя' }));
    expect(await screen.findByTestId('daily-rates-hint')).toBeTruthy();
    expect(getBinding('user@example.com')).toBe('sp_late');
  });
});

describe('шаг «Разделитель аргументов в формулах» при привязке (G27)', () => {
  const choice = () => screen.getByRole('group', { name: 'Разделитель аргументов в формулах' });
  const radio = (name: RegExp) => within(choice()).getByRole('radio', { name }) as HTMLInputElement;
  const settingIn = (id: string) => {
    const rows = h.fake.values(id, 'Настройки');
    return rows.find((r) => r[0] === 'formulaSeparator')?.[1];
  };

  it('новая таблица (русская локаль): отмечена точка с запятой; выбор запятой пишется в «Настройки» при «Начать работу»', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать новую таблицу' }));
    await screen.findByTestId('daily-rates-hint');
    expect(radio(/Точка с запятой/).checked).toBe(true);
    expect(radio(/Запятая/).checked).toBe(false);
    expect(within(choice()).getByText(/русским языком/)).toBeTruthy();
    fireEvent.click(radio(/Запятая/));
    fireEvent.click(screen.getByRole('button', { name: 'Начать работу' }));
    expect(await screen.findByText('user@example.com', { selector: '.app__user' })).toBeTruthy();
    expect(settingIn(getBinding('user@example.com')!)).toBe(',');
  });

  it('выбранная таблица с английской локалью: отмечена запятая; без изменения выбор сохраняется как есть', async () => {
    h.fake.seed('sp_picked', {});
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Войти через Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать существующую' }));
    await screen.findByTestId('daily-rates-hint');
    expect(radio(/Запятая/).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Начать работу' }));
    expect(await screen.findByText('user@example.com', { selector: '.app__user' })).toBeTruthy();
    expect(settingIn('sp_picked')).toBe(',');
  });
});

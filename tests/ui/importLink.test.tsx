// «Импорт из старой таблицы» по ссылке (G14, G19; истории 81, 88): то же поле, что при подключении, рядом с «Выбрать старую таблицу».
// Есть доступ к файлу — импорт без окна Google; нет — окно Google с этим файлом.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImportFlow, type ImportDeps } from '../../src/ui/screens/import/ImportScreen';
import { DataProvider } from '../../src/ui/DataContext';
import { LocalStore } from '../../src/store/localStore';
import { SYNTHETIC_LEGACY } from '../../fixtures/legacy/synthetic';
import { GoogleApiError } from '../../src/google/errors';
import type { PickOptions } from '../../src/google/picker';

const OLD_ID = '1OldSheetIdOldSheetIdOldSheetId0123456789ab';
const LINK = `https://docs.google.com/spreadsheets/d/${OLD_ID}/edit?usp=sharing`;
let n = 0;

/** По умолчанию доступа к файлу по ссылке нет (403) — открывается окно Google. */
function renderFlow(pick: ImportDeps['pick'], getMeta: NonNullable<ImportDeps['getMeta']> = async () => { throw new GoogleApiError(403); }) {
  const read = vi.fn(async (_id: string) => SYNTHETIC_LEGACY);
  render(
    <MemoryRouter>
      <DataProvider store={new LocalStore(`zk:t:importlink${++n}`)} today="2026-10-25">
        <ImportFlow deps={{ pick, read, getMeta, currentSpreadsheetId: 'new-sheet-id-new-sheet-id-000' }} />
      </DataProvider>
    </MemoryRouter>,
  );
  return { read };
}

afterEach(() => localStorage.clear());

describe('импорт: ссылка на старую таблицу', () => {
  it('поле стоит рядом с «Выбрать старую таблицу»', async () => {
    renderFlow(vi.fn(async () => null));
    const choose = await screen.findByRole('button', { name: 'Выбрать старую таблицу' });
    const field = screen.getByLabelText('Ссылка на старую таблицу');
    expect(choose.closest('.import__actions')?.contains(field)).toBe(true);
  });

  it('вставка ссылки, доступа нет → окно Google с этим файлом → «Выбрать» → предпросмотр', async () => {
    const pick = vi.fn(async (_o?: { fileId?: string }) => ({ id: OLD_ID, name: 'Закупки Китай AREC' }));
    const { read } = renderFlow(pick);
    fireEvent.paste(await screen.findByLabelText('Ссылка на старую таблицу'), { clipboardData: { getData: () => LINK } });
    await screen.findByText(/Предпросмотр/);
    expect(pick).toHaveBeenCalledWith(expect.objectContaining({ fileId: OLD_ID }));
    expect(read).toHaveBeenCalledWith(OLD_ID);
  });

  it('отмена в окне → ничего не происходит', async () => {
    const pick = vi.fn(async (_o?: { fileId?: string }) => null);
    const { read } = renderFlow(pick);
    fireEvent.change(await screen.findByLabelText('Ссылка на старую таблицу'), { target: { value: LINK } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть по ссылке' }));
    await waitFor(() => expect(pick).toHaveBeenCalledWith(expect.objectContaining({ fileId: OLD_ID })));
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByText(/Предпросмотр/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('неверная ссылка → ошибка у поля, окно не открывается', async () => {
    const pick = vi.fn(async () => null);
    renderFlow(pick);
    fireEvent.change(await screen.findByLabelText('Ссылка на старую таблицу'), { target: { value: 'https://drive.google.com/file/d/xyz/view' } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть по ссылке' }));
    expect(await screen.findByText('Это не ссылка на Google-таблицу')).toBeTruthy();
    expect(pick).not.toHaveBeenCalled();
  });

  it('ссылка на таблицу с доступом → предпросмотр без окна Google', async () => {
    const pick = vi.fn(async () => null);
    const getMeta = vi.fn(async () => ({ title: 'Закупки Китай AREC' }));
    const { read } = renderFlow(pick, getMeta);
    fireEvent.paste(await screen.findByLabelText('Ссылка на старую таблицу'), { clipboardData: { getData: () => LINK } });
    expect(await screen.findByText(/Предпросмотр: «Закупки Китай AREC»/)).toBeTruthy();
    expect(getMeta).toHaveBeenCalledWith(OLD_ID);
    expect(read).toHaveBeenCalledWith(OLD_ID);
    expect(pick).not.toHaveBeenCalled();
  });

  it('окно Google не вернуло ответ → подсказка, кнопки активны; поздний ответ всё равно принимается', async () => {
    let stall: (() => void) | undefined;
    let late: ((v: { id: string; name: string } | null) => void) | undefined;
    const pick = vi.fn((o?: PickOptions) => {
      stall = o?.onStall;
      return new Promise<{ id: string; name: string } | null>((r) => { late = r; });
    });
    const { read } = renderFlow(pick);
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать старую таблицу' }));
    await waitFor(() => expect(stall).toBeTypeOf('function'));
    act(() => stall!());
    expect(await screen.findByText('Окно выбора не вернуло таблицу — попробуйте ещё раз или вставьте ссылку')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Выбрать старую таблицу' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Открыть по ссылке' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => late!({ id: OLD_ID, name: 'Закупки Китай AREC' }));
    expect(await screen.findByText(/Предпросмотр/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(OLD_ID);
    expect(screen.queryByText(/Окно выбора не вернуло таблицу/)).toBeNull();
  });
});

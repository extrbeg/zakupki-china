// «Импорт из старой таблицы» по ссылке (G14, история 81): то же поле, что при подключении, рядом с «Выбрать старую таблицу».
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ImportFlow, type ImportDeps } from '../../src/ui/screens/import/ImportScreen';
import { DataProvider } from '../../src/ui/DataContext';
import { LocalStore } from '../../src/store/localStore';
import { SYNTHETIC_LEGACY } from '../../fixtures/legacy/synthetic';

const OLD_ID = '1OldSheetIdOldSheetIdOldSheetId0123456789ab';
const LINK = `https://docs.google.com/spreadsheets/d/${OLD_ID}/edit?usp=sharing`;
let n = 0;

function renderFlow(pick: ImportDeps['pick']) {
  const read = vi.fn(async (_id: string) => SYNTHETIC_LEGACY);
  render(
    <MemoryRouter>
      <DataProvider store={new LocalStore(`zk:t:importlink${++n}`)} today="2026-10-25">
        <ImportFlow deps={{ pick, read, currentSpreadsheetId: 'new-sheet-id-new-sheet-id-000' }} />
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

  it('вставка ссылки → окно Google с этим файлом → «Выбрать» → предпросмотр', async () => {
    const pick = vi.fn(async (_o?: { fileId?: string }) => ({ id: OLD_ID, name: 'Закупки Китай AREC' }));
    const { read } = renderFlow(pick);
    fireEvent.paste(await screen.findByLabelText('Ссылка на старую таблицу'), { clipboardData: { getData: () => LINK } });
    await screen.findByText(/Предпросмотр/);
    expect(pick).toHaveBeenCalledWith({ fileId: OLD_ID });
    expect(read).toHaveBeenCalledWith(OLD_ID);
  });

  it('отмена в окне → ничего не происходит', async () => {
    const pick = vi.fn(async (_o?: { fileId?: string }) => null);
    const { read } = renderFlow(pick);
    fireEvent.change(await screen.findByLabelText('Ссылка на старую таблицу'), { target: { value: LINK } });
    fireEvent.click(screen.getByRole('button', { name: 'Открыть по ссылке' }));
    await waitFor(() => expect(pick).toHaveBeenCalledWith({ fileId: OLD_ID }));
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
});

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import SettingsScreen from '../../src/ui/screens/settings/SettingsScreen';
import { DataProvider, SessionProvider, useSession } from '../../src/ui/DataContext';
import { LocalStore } from '../../src/store/localStore';
import { SheetsStore } from '../../src/store/sheetsStore';
import { StoreError, type Store } from '../../src/store/types';
import { ensureSchema } from '../../src/setup/ensureSchema';
import { FakeSheetsApi } from '../store/sheetsStoreFake';
import { sampleLine } from '../store/contract';

function renderWith(store: Store) {
  return render(
    <SessionProvider>
      <MemoryRouter>
        <DataProvider store={store} today="2026-10-25">
          <SettingsScreen />
        </DataProvider>
      </MemoryRouter>
    </SessionProvider>,
  );
}

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('экран настроек', () => {
  it('сохраняет адрес портала, ставку НДС и источник курсов в лист «Настройки» таблицы', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp', {});
    await ensureSchema(fake, 'sp');
    renderWith(new SheetsStore(fake, 'sp'));
    await waitFor(() => expect(input(/Ставка НДС/).value).toBe('22'));
    fireEvent.change(input(/портала Битрикс24/), { target: { value: 'https://demo.bitrix24.ru/' } });
    fireEvent.change(input(/Ставка НДС/), { target: { value: '20' } });
    fireEvent.change(input(/источника курсов/), { target: { value: 'https://example.com/rates' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    const rows = Object.fromEntries(fake.values('sp', 'Настройки').slice(1).map((r) => [r[0], r[1]]));
    expect(rows).toMatchObject({ bitrixPortalUrl: 'https://demo.bitrix24.ru', vatRateDefault: '20', ratesSourceUrl: 'https://example.com/rates' });
  });

  it('G27: «Разделитель в формулах» — смена сохраняется и переписывает формулы перевода в «Позициях»', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp', {});
    await ensureSchema(fake, 'sp');
    const prep = new SheetsStore(fake, 'sp');
    await prep.setSetting('formulaSeparator', ',');
    await prep.insert('lines', sampleLine);
    fake.setLocale('sp', 'ru_RU');   // формула с «,» в русской таблице не работает
    renderWith(new SheetsStore(fake, 'sp'));
    const select = await screen.findByLabelText('Разделитель в формулах') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(','));
    expect(select.selectedOptions[0].textContent).toBe('Запятая ( , )');
    fireEvent.change(select, { target: { value: ';' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    const rows = Object.fromEntries(fake.values('sp', 'Настройки').slice(1).map((r) => [r[0], r[1]]));
    expect(rows.formulaSeparator).toBe(';');
    const lines = fake.values('sp', 'Позиции');
    expect(lines[1][(lines[0] as string[]).indexOf('Name EN (авто)')]).toBe('[en] Кран шаровой');
  });

  it('G27: в демо-режиме разделитель просто сохраняется в настройках', async () => {
    const store = new LocalStore('zk:test:settings-sep', { settings: { vatRateDefault: '22' } });
    renderWith(store);
    const select = await screen.findByLabelText('Разделитель в формулах') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: ';' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await screen.findByText('Сохранено');
    expect((await store.load()).settings.formulaSeparator).toBe(';');
  });

  it('неверная ставка НДС — ошибка у поля, ничего не пишется', async () => {
    const store = new LocalStore('zk:test:settings-bad', { settings: { vatRateDefault: '22' } });
    renderWith(store);
    await waitFor(() => expect(input(/Ставка НДС/).value).toBe('22'));
    fireEvent.change(input(/Ставка НДС/), { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('От 0 до 100 %')).toBeTruthy();
    expect((await store.load()).settings.vatRateDefault).toBe('22');
  });

  it('нечисловая ставка НДС («2о») — ошибка у поля, в таблицу ничего не пишется', async () => {
    const store = new LocalStore('zk:test:settings-nan', { settings: { vatRateDefault: '22' } });
    renderWith(store);
    await waitFor(() => expect(input(/Ставка НДС/).value).toBe('22'));
    fireEvent.change(input(/Ставка НДС/), { target: { value: '2' } });
    fireEvent.change(input(/Ставка НДС/), { target: { value: '2о' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите число')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Сохранено')).toBeNull();
    expect((await store.load()).settings.vatRateDefault).toBe('22');
  });

  it('в режиме таблицы есть ссылка «Импорт из старой таблицы» на /import', async () => {
    const store = new LocalStore('zk:test:settings-import');
    function AsSheets({ children }: { children: ReactNode }) {
      const { session, startSheets } = useSession();
      useEffect(() => { startSheets(store, { email: 'u@example.com', spreadsheetId: 'sp1' }); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
      return session.mode === 'sheets' ? <>{children}</> : null;
    }
    render(
      <SessionProvider>
        <AsSheets>
          <MemoryRouter>
            <DataProvider store={store} today="2026-10-25">
              <SettingsScreen />
            </DataProvider>
          </MemoryRouter>
        </AsSheets>
      </SessionProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Импорт из старой таблицы' });
    expect(link.getAttribute('href')).toBe('/import');
  });

  it('нет связи — баннер «Нет связи с таблицей — Повторить», введённое не теряется, повтор сохраняет', async () => {
    const base = new LocalStore('zk:test:settings-net', { settings: { vatRateDefault: '22' } });
    let fail = true;
    const flaky: Store = Object.assign(Object.create(base) as Store, {
      setSetting: async (k: string, v: string) => {
        if (fail) { fail = false; throw new StoreError('network'); }
        return base.setSetting(k, v);
      },
    });
    renderWith(flaky);
    await waitFor(() => expect(input(/Ставка НДС/).value).toBe('22'));
    fireEvent.change(input(/портала Битрикс24/), { target: { value: 'https://p.bitrix24.ru' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Нет связи с таблицей');
    expect(input(/портала Битрикс24/).value).toBe('https://p.bitrix24.ru');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByText('Сохранено');
    expect((await base.load()).settings.bitrixPortalUrl).toBe('https://p.bitrix24.ru');
  });
});

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset, Rate } from '../../../src/domain/model';
import RatesScreen from '../../../src/ui/screens/rates/RatesScreen';

let counter = 0;

function renderRates(seed: Partial<Dataset>, today = '2026-10-25') {
  const store = new LocalStore(`zk:t:rates${++counter}`, seed);
  render(
    <MemoryRouter>
      <DataProvider store={store} today={today}>
        <RatesScreen />
      </DataProvider>
    </MemoryRouter>,
  );
  return { store };
}

const vtb = (date: string, currency: Rate['currency'], rate: number): Rate => ({ id: `r_${date}_${currency}_vtb`, date, currency, rate, source: 'vtb' });

const seedRates: Rate[] = [
  vtb('2026-10-22', 'USD', 81.25), vtb('2026-10-22', 'EUR', 94.5), vtb('2026-10-22', 'CNY', 11.42),
  vtb('2026-10-23', 'USD', 81.75), vtb('2026-10-23', 'EUR', 95.1), vtb('2026-10-23', 'CNY', 11.48),
  { id: 'rm1', date: '2026-10-23', currency: 'CNY', rate: 11.6, source: 'manual' },
];

const rowOf = (dateRu: string) => {
  const cell = screen.getByRole('rowheader', { name: dateRu });
  return cell.closest('tr') as HTMLElement;
};
const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

describe('экран «Курсы»: история', () => {
  it('таблица по датам × USD/EUR/CNY, новые даты сверху, источник подписан', async () => {
    renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Дата', 'USD', 'EUR', 'юань (RMB)']);
    const dates = screen.getAllByRole('rowheader').map((h) => h.textContent);
    expect(dates).toEqual(['23.10.2026', '22.10.2026']);
    const r22 = within(rowOf('22.10.2026'));
    expect(r22.getByText('81,25')).toBeTruthy();
    expect(r22.getByText('94,50')).toBeTruthy();
    expect(r22.getByText('11,42')).toBeTruthy();
    expect(r22.getAllByText('ВТБ')).toHaveLength(3);
  });

  it('ручной курс на ту же дату показан как действующий, автоматический — как заменённый', async () => {
    renderRates({ rates: seedRates });
    const row = within(await waitFor(() => rowOf('23.10.2026')));
    const cny = row.getByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ });
    expect(cny.textContent).toContain('11,60');
    expect(row.getByText('вручную')).toBeTruthy();
    expect(row.getByText(/ВТБ 11,48/).className).toContain('rate-cell__replaced');
  });
});

describe('экран «Курсы»: ручной курс', () => {
  it('«Добавить курс» сохраняет ручной курс (источник manual) и показывает его в таблице', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить курс' }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-24' } });
    fireEvent.change(field(/^Валюта/), { target: { value: 'USD' } });
    fireEvent.change(field(/^Курс/), { target: { value: '82,1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).rates).toHaveLength(8));
    const added = (await store.load()).rates.find((r) => r.date === '2026-10-24');
    expect(added).toMatchObject({ currency: 'USD', rate: 82.1, source: 'manual' });
    expect(added?.id).toBeTruthy();
    const row = within(await waitFor(() => rowOf('24.10.2026')));
    expect(row.getByText('82,10')).toBeTruthy();
  });

  it('«82о» в курсе — «Введите число», прежнее «82» не сохраняется', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить курс' }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-24' } });
    fireEvent.change(field(/^Курс/), { target: { value: '82' } });
    fireEvent.change(field(/^Курс/), { target: { value: '82о' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите число')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('курс ≤ 0 или пустой — ошибка у поля, ничего не записано', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить курс' }));
    fireEvent.change(field(/^Курс/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите курс больше нуля')).toBeTruthy();
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('правка ручного курса меняет ту же запись, дубля не появляется', async () => {
    const { store } = renderRates({ rates: seedRates });
    fireEvent.click(await screen.findByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ }));
    expect(field(/^Курс/).value).toBe('11,6');
    fireEvent.change(field(/^Курс/), { target: { value: '11,7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).rates.find((r) => r.id === 'rm1')?.rate).toBe(11.7));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('добавление ручного курса на дату и валюту, где ручной уже есть, обновляет его', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить курс' }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-23' } });
    fireEvent.change(field(/^Валюта/), { target: { value: 'CNY' } });
    fireEvent.change(field(/^Курс/), { target: { value: '11,9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).rates.find((r) => r.id === 'rm1')?.rate).toBe(11.9));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('ручной курс можно удалить; автоматический снова становится действующим', async () => {
    const { store } = renderRates({ rates: seedRates });
    fireEvent.click(await screen.findByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).rates.some((r) => r.id === 'rm1')).toBe(false));
    expect(within(rowOf('23.10.2026')).getByText('11,48')).toBeTruthy();
  });
});

describe('экран «Курсы»: статус автокурсов', () => {
  it('последней строке ВТБ больше 2 дней — «Автокурсы не обновлялись с <дата>»', async () => {
    renderRates({ rates: seedRates }, '2026-10-26');
    expect(await screen.findByText('Автокурсы не обновлялись с 23.10.2026')).toBeTruthy();
  });

  it('последней строке ВТБ 2 дня — плашки нет; ручной курс свежее не считается автокурсом', async () => {
    renderRates({ rates: [...seedRates, { id: 'rm2', date: '2026-10-26', currency: 'USD', rate: 82, source: 'manual' }] }, '2026-10-25');
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    expect(screen.queryByText(/Автокурсы не обновлялись/)).toBeNull();
  });

  it('ручной курс не продлевает автокурсы: плашка остаётся', async () => {
    renderRates({ rates: [...seedRates, { id: 'rm2', date: '2026-10-27', currency: 'USD', rate: 82, source: 'manual' }] }, '2026-10-27');
    expect(await screen.findByText('Автокурсы не обновлялись с 23.10.2026')).toBeTruthy();
  });

  it('курсов нет — пустое состояние с кнопкой «Добавить курс»', async () => {
    renderRates({ rates: [] });
    expect(await screen.findByText('Курсов пока нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить курс' })).toBeTruthy();
  });
});

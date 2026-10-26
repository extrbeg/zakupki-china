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
  it('«Курсы на дату» сохраняет ручной курс (источник manual) и показывает его в таблице', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Курсы на дату' }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-24' } });
    fireEvent.change(field(/^USD/), { target: { value: '82,1' } });
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
    fireEvent.click(screen.getByRole('button', { name: 'Курсы на дату' }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-24' } });
    fireEvent.change(field(/^USD/), { target: { value: '82' } });
    fireEvent.change(field(/^USD/), { target: { value: '82о' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите число')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('курс ≤ 0 или пустой — ошибка у поля, ничего не записано', async () => {
    const { store } = renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Курсы на дату' }));
    fireEvent.change(field(/^USD/), { target: { value: '0' } });
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

  it('правка переносит ручной курс на дату и валюту, где ручной уже есть, — вопрос; отказ ничего не пишет', async () => {
    const { store } = renderRates({ rates: [...seedRates, { id: 'rm3', date: '2026-10-23', currency: 'USD', rate: 82, source: 'manual' }] });
    fireEvent.click(await screen.findByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ }));
    fireEvent.change(field(/^Валюта/), { target: { value: 'USD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('На 23.10.2026 уже есть курс USD 82,00 — перезаписать?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Не перезаписывать' }));
    await new Promise((r) => setTimeout(r, 20));
    const rates = (await store.load()).rates;
    expect(rates).toHaveLength(8);
    expect(rates.find((r) => r.id === 'rm1')).toMatchObject({ currency: 'CNY', rate: 11.6 });
    expect(rates.find((r) => r.id === 'rm3')?.rate).toBe(82);
  });

  it('правка с подтверждением: остаётся один ручной курс на (дата, валюта), без дубля', async () => {
    const { store } = renderRates({ rates: [...seedRates, { id: 'rm3', date: '2026-10-22', currency: 'CNY', rate: 11.3, source: 'manual' }] });
    fireEvent.click(await screen.findByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ }));
    fireEvent.change(field(/^Дата/), { target: { value: '2026-10-22' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('На 22.10.2026 уже есть курс юань (RMB) 11,30 — перезаписать?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Перезаписать' }));
    await waitFor(async () => expect((await store.load()).rates.some((r) => r.id === 'rm1')).toBe(false));
    const rates = (await store.load()).rates;
    expect(rates).toHaveLength(7);
    const onDate = rates.filter((r) => r.date === '2026-10-22' && r.currency === 'CNY' && r.source === 'manual');
    expect(onDate).toHaveLength(1);
    expect(onDate[0].rate).toBe(11.6);
  });

  it('правка только значения (дата и валюта те же) вопроса не задаёт', async () => {
    renderRates({ rates: seedRates });
    fireEvent.click(await screen.findByRole('button', { name: /ручной курс юань \(RMB\) на 23\.10\.2026/ }));
    fireEvent.change(field(/^Курс/), { target: { value: '11,8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Ручной курс' })).toBeNull());
  });

  it('в заполненной таблице тоже нет кнопки «Добавить курс»', async () => {
    renderRates({ rates: seedRates });
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    expect(screen.queryByRole('button', { name: 'Добавить курс' })).toBeNull();
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

  it('курсов нет — пустое состояние с кнопкой «Курсы на дату»; одновалютной «Добавить курс» нет нигде', async () => {
    renderRates({ rates: [] });
    expect(await screen.findByText('Курсов пока нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Курсы на дату' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить курс' })).toBeNull();
  });
});

describe('экран «Курсы»: курсы трёх валют на дату', () => {
  const openMulti = async () => {
    await screen.findByRole('rowheader', { name: '23.10.2026' });
    fireEvent.click(screen.getByRole('button', { name: 'Курсы на дату' }));
    return screen.getByRole('form', { name: 'Курсы на дату' });
  };
  const setDate = (d: string) => fireEvent.change(field(/^Дата/), { target: { value: d } });
  const setRate = (label: RegExp, v: string) => fireEvent.change(field(label), { target: { value: v } });
  const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

  it('форма открывается на сегодняшней дате, три поля USD, EUR, юань пустые', async () => {
    renderRates({ rates: seedRates });
    await openMulti();
    expect(field(/^Дата/).value).toBe('2026-10-25');
    expect(field(/^USD/).value).toBe('');
    expect(field(/^EUR/).value).toBe('');
    expect(field(/^юань/).value).toBe('');
  });

  it('три валюты одной датой записываются ручными курсами, дата остаётся, поля показывают сохранённое', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-20');
    setRate(/^USD/, '82,7');
    setRate(/^EUR/, '95');
    setRate(/^юань/, '11,5');
    save();
    await waitFor(async () => expect((await store.load()).rates).toHaveLength(10));
    const added = (await store.load()).rates.filter((r) => r.date === '2026-10-20');
    expect(added.map((r) => [r.currency, r.rate, r.source]).sort()).toEqual([['CNY', 11.5, 'manual'], ['EUR', 95, 'manual'], ['USD', 82.7, 'manual']]);
    expect(new Set(added.map((r) => r.id)).size).toBe(3);
    await screen.findByRole('rowheader', { name: '20.10.2026' });
    // дата не сбросилась на сегодня, поля не очистились
    expect(field(/^Дата/).value).toBe('2026-10-20');
    expect(field(/^USD/).value).toBe('82,7');
    expect(field(/^EUR/).value).toBe('95');
    expect(field(/^юань/).value).toBe('11,5');
  });

  it('при выборе даты поля показывают уже внесённые ручные курсы; курс ВТБ за ручной не выдаётся', async () => {
    renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-23');
    expect(field(/^юань/).value).toBe('11,6');
    expect(field(/^USD/).value).toBe('');
    expect(field(/^EUR/).value).toBe('');
    setDate('2026-10-22');
    expect(field(/^юань/).value).toBe('');
  });

  it('пустое поле не удаляет существующий ручной курс, заполненные соседи сохраняются без вопросов', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-23');
    setRate(/^юань/, '');
    setRate(/^USD/, '82');
    save();
    await waitFor(async () => expect((await store.load()).rates).toHaveLength(8));
    const rates = (await store.load()).rates;
    expect(rates.find((r) => r.id === 'rm1')).toMatchObject({ rate: 11.6, source: 'manual' });
    expect(rates.find((r) => r.date === '2026-10-23' && r.currency === 'USD' && r.source === 'manual')?.rate).toBe(82);
    expect(screen.queryByText(/перезаписать/)).toBeNull();
  });

  it('другое значение поверх ручного курса — вопрос; отказ не пишет ничего, в том числе соседние валюты', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-23');
    setRate(/^юань/, '11,9');
    setRate(/^USD/, '82');
    save();
    expect(await screen.findByText('На 23.10.2026 уже есть курс юань (RMB) 11,60 — перезаписать?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Не перезаписывать' }));
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).rates).toHaveLength(7);
    expect((await store.load()).rates.find((r) => r.id === 'rm1')?.rate).toBe(11.6);
    expect(screen.queryByText(/перезаписать\?/)).toBeNull();
    expect(field(/^Дата/).value).toBe('2026-10-23');
  });

  it('подтверждение перезаписывает ту же запись без дубля и записывает остальные валюты', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-23');
    setRate(/^юань/, '11,9');
    setRate(/^USD/, '82');
    save();
    await screen.findByText(/перезаписать\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Перезаписать' }));
    await waitFor(async () => expect((await store.load()).rates.find((r) => r.id === 'rm1')?.rate).toBe(11.9));
    const rates = (await store.load()).rates;
    expect(rates).toHaveLength(8);
    expect(rates.filter((r) => r.date === '2026-10-23' && r.currency === 'CNY' && r.source === 'manual')).toHaveLength(1);
    expect(field(/^Дата/).value).toBe('2026-10-23');
  });

  it('то же значение, что уже стоит, ничего не пишет и ничего не спрашивает', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-23');
    save();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/перезаписать/)).toBeNull();
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('неверное число — ошибка у поля, ни одна валюта не записана', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-24');
    setRate(/^EUR/, '95');
    setRate(/^USD/, '82о');
    save();
    expect(await screen.findByText('Введите число')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('курс ≤ 0 — ошибка у поля; даты нет — «Укажите дату»; ничего не записано', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-24');
    setRate(/^EUR/, '0');
    save();
    expect(await screen.findByText('Введите курс больше нуля')).toBeTruthy();
    setRate(/^EUR/, '95');
    setDate('');
    save();
    expect(await screen.findByText('Укажите дату')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).rates).toHaveLength(7);
  });

  it('ничего не заполнено — подсказка, записи нет', async () => {
    const { store } = renderRates({ rates: seedRates });
    await openMulti();
    setDate('2026-10-24');
    save();
    expect(await screen.findByText('Введите курс хотя бы одной валюты')).toBeTruthy();
    expect((await store.load()).rates).toHaveLength(7);
  });
});

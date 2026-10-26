// «+ Добавить…» в полях выбора из «Списков» и «+ Новый…» для поставщика, перевозчика и получателя (истории 85, 86):
// значение сохраняется в справочник и сразу выбирается, остальное введённое в форме остаётся.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset } from '../../../src/domain/model';
import CostsScreen from '../../../src/ui/screens/costs/CostsScreen';
import { baseSeed, gatedStore, renderAt, renderWithStore } from '../orders/helpers';
import { renderAt as renderShipments, baseSeed as shipSeed } from '../shipments/helpers';
import { renderAt as renderDirs, baseSeed as dirSeed } from '../directories/helpers';
import { pickSuggestion, pickedValue } from './suggest';

const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const value = (el: HTMLElement) => (el as HTMLInputElement).value;
const header = () => screen.getByRole('region', { name: 'Шапка заказа' });
/** Выбирает пункт по видимому тексту (например «+ Добавить…»): в выпадающем списке или в подсказках поля с поиском. */
const choose = (select: HTMLElement, text: string) => {
  if (select.tagName !== 'SELECT') { pickSuggestion(select, text); return; }
  const opt = within(select).getByRole('option', { name: text }) as HTMLOptionElement;
  set(select, opt.value);
};
const selectedText = (select: HTMLElement) => {
  if (select.tagName !== 'SELECT') return (select as HTMLInputElement).value;
  const s = select as HTMLSelectElement;
  return s.options[s.selectedIndex]?.textContent ?? '';
};
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });
const listValues = async (store: LocalStore, list: string) => (await store.load()).lists.filter((l) => l.list === list).map((l) => l.value);

/** Шапка нового заказа с заполненными полями. */
async function fillHeader() {
  await screen.findByLabelText(/^Номер заказа/);
  const h = within(header());
  set(h.getByLabelText(/^Номер заказа/), '20');
  set(h.getByLabelText(/^Плательщик/), 'ООО Плательщик');
  set(h.getByLabelText(/^Заказчик/), 'Заказчик Юг');
  set(h.getByLabelText(/^Название/), 'Мой заказ');
  set(h.getByLabelText(/^ID задачи Битрикс24/), '555');
  set(h.getByLabelText(/^Комментарий/), 'длинный комментарий');
}

function expectHeaderKept() {
  const h = within(header());
  expect(value(h.getByLabelText(/^Номер заказа/))).toBe('20');
  expect(value(h.getByLabelText(/^Плательщик/))).toBe('ООО Плательщик');
  expect(value(h.getByLabelText(/^Заказчик/))).toBe('Заказчик Юг');
  expect(value(h.getByLabelText(/^Название/))).toBe('Мой заказ');
  expect(value(h.getByLabelText(/^ID задачи Битрикс24/))).toBe('555');
  expect(value(h.getByLabelText(/^Комментарий/))).toBe('длинный комментарий');
}

describe('«+ Добавить…» в шапке заказа', () => {
  it('новое подразделение сохраняется в список в конец и выбирается; введённое в шапке остаётся; повтор другим регистром не дублирует', async () => {
    const { store } = renderAt('/orders/new', baseSeed);
    await fillHeader();
    const dept = within(header()).getByLabelText(/^Подразделение/);
    choose(dept, '+ Добавить…');
    const input = within(header()).getByLabelText(/^Новое значение/);
    set(input, '  Склад ');
    enter(input);

    expect(value(dept)).toBe('Склад');
    expect(within(header()).queryByLabelText(/^Новое значение/)).toBeNull();
    expectHeaderKept();
    await waitFor(async () => expect(await listValues(store, 'department')).toEqual(['Цех', 'Склад']));
    const added = (await store.load()).lists.find((l) => l.value === 'Склад')!;
    expect(added).toMatchObject({ list: 'department', order: 2 });
    expect((await store.load()).orders).toHaveLength(2);            // Enter не отправил форму заказа

    set(dept, 'Цех');
    choose(dept, '+ Добавить…');
    set(within(header()).getByLabelText(/^Новое значение/), ' СКЛАД');
    fireEvent.click(within(header()).getByRole('button', { name: 'Добавить' }));
    expect(value(dept)).toBe('Склад');
    expectHeaderKept();
    await new Promise((r) => setTimeout(r, 20));
    expect(await listValues(store, 'department')).toEqual(['Цех', 'Склад']);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }));
    await waitFor(async () => expect((await store.load()).orders.find((o) => o.number === 20)).toMatchObject({
      department: 'Склад', payer: 'ООО Плательщик', customer: 'Заказчик Юг', title: 'Мой заказ', bitrixTaskId: '555',
    }));
  });

  it('Esc отменяет ввод; пустое — ошибка у поля, записи нет', async () => {
    const { store } = renderAt('/orders/new', baseSeed);
    await fillHeader();
    const payer = within(header()).getByLabelText(/^Плательщик/);
    choose(payer, '+ Добавить…');
    const input = within(header()).getByLabelText(/^Новое значение/);
    fireEvent.click(within(header()).getByRole('button', { name: 'Добавить' }));
    expect(within(header()).getByText('Введите название')).toBeTruthy();
    set(input, 'ООО Новый');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(within(header()).queryByLabelText(/^Новое значение/)).toBeNull();
    expect(value(payer)).toBe('ООО Плательщик');
    expectHeaderKept();
    await new Promise((r) => setTimeout(r, 20));
    expect(await listValues(store, 'payer')).toEqual(['ООО Плательщик']);
  });

  it('медленная запись: значение выбрано до окончания записи, поле не сбрасывается', async () => {
    const store = gatedStore(baseSeed);
    renderWithStore('/orders/new', store);
    await fillHeader();
    const customer = within(header()).getByLabelText(/^Заказчик/);
    choose(customer, '+ Добавить…');
    const input = within(header()).getByLabelText(/^Новое значение/);
    set(input, 'Заказчик Восток');
    enter(input);
    expect(value(customer)).toBe('Заказчик Восток');
    await waitFor(() => expect(store.pending).toBe(1));
    expect(value(within(header()).getByLabelText(/^Название/))).toBe('Мой заказ');
    store.release();
    await waitFor(async () => expect(await listValues(store, 'customer')).toContain('Заказчик Восток'));
    expect(value(customer)).toBe('Заказчик Восток');
    expect(value(within(header()).getByLabelText(/^Название/))).toBe('Мой заказ');
  });
});

describe('«+ Новый поставщик…» в реквизитах поставщика в заказе', () => {
  it('создаёт поставщика с одним названием и выбирает его; дубль по названию не создаётся; условия оплаты — «+ Добавить…»', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const form = within(screen.getByRole('region', { name: 'Новый поставщик в заказе' }));
    set(form.getByLabelText(/^Валюта/), 'USD');
    const sup = form.getByLabelText(/^Поставщик/);
    choose(sup, '+ Новый поставщик…');
    const input = form.getByLabelText(/^Название нового поставщика/);
    set(input, 'Gamma Pumps');
    enter(input);
    expect(selectedText(sup)).toBe('Gamma Pumps');
    expect(value(form.getByLabelText(/^Валюта/))).toBe('USD');
    await waitFor(async () => expect((await store.load()).suppliers.map((s) => s.name)).toContain('Gamma Pumps'));
    const created = (await store.load()).suppliers.find((s) => s.name === 'Gamma Pumps')!;
    expect(created.id).toMatch(/^sup_/);
    expect(pickedValue(sup)).toBe(created.id);

    choose(sup, '+ Новый поставщик…');
    set(form.getByLabelText(/^Название нового поставщика/), ' gamma pumps ');
    enter(form.getByLabelText(/^Название нового поставщика/));
    expect(pickedValue(sup)).toBe(created.id);
    expect(selectedText(sup)).toBe('Gamma Pumps');

    const terms = form.getByLabelText(/^Условия оплаты/);
    choose(terms, '+ Добавить…');
    set(form.getByLabelText(/^Новое значение/), '100% предоплата');
    enter(form.getByLabelText(/^Новое значение/));
    expect(value(terms)).toBe('100% предоплата');

    fireEvent.click(form.getByRole('button', { name: 'Сохранить поставщика' }));
    await waitFor(async () => expect((await store.load()).supplierOrders.find((s) => s.seq === 2)).toMatchObject({
      supplierId: created.id, currency: 'USD', paymentTerms: '100% предоплата',
    }));
    const data = await store.load();
    expect(data.suppliers.filter((s) => s.name.toLowerCase() === 'gamma pumps')).toHaveLength(1);
    expect(data.lists.filter((l) => l.list === 'paymentTerms').map((l) => l.value)).toEqual(['30/70', '100% предоплата']);
  });

  it('медленная запись: новый поставщик выбран и подписан названием до окончания записи', async () => {
    const store = gatedStore(baseSeed);
    renderWithStore('/orders/o12', store);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const form = within(screen.getByRole('region', { name: 'Новый поставщик в заказе' }));
    const sup = form.getByLabelText(/^Поставщик/);
    choose(sup, '+ Новый поставщик…');
    set(form.getByLabelText(/^Название нового поставщика/), 'Delta Steel');
    enter(form.getByLabelText(/^Название нового поставщика/));
    expect(selectedText(sup)).toBe('Delta Steel');
    await waitFor(() => expect(store.pending).toBe(1));
    store.release();
    await waitFor(async () => expect((await store.load()).suppliers.map((s) => s.name)).toContain('Delta Steel'));
    expect(selectedText(sup)).toBe('Delta Steel');
  });
});

describe('другие формы', () => {
  it('поставка: «+ Новый перевозчик…» создаёт перевозчика и выбирает его', async () => {
    const { store } = renderShipments('/shipments/new', shipSeed);
    const num = await screen.findByLabelText(/^Номер поставки/);
    set(num, 'К-9');
    const carrier = screen.getByLabelText(/^Перевозчик/);
    choose(carrier, '+ Новый перевозчик…');
    set(screen.getByLabelText(/^Название нового перевозчика/), 'Авиа-Карго');
    enter(screen.getByLabelText(/^Название нового перевозчика/));
    expect(selectedText(carrier)).toBe('Авиа-Карго');
    expect(value(num)).toBe('К-9');
    await waitFor(async () => expect((await store.load()).carriers.map((c) => c.name)).toEqual(['Море-Транс', 'Авиа-Карго']));
    choose(carrier, '+ Новый перевозчик…');
    set(screen.getByLabelText(/^Название нового перевозчика/), 'море-транс');
    enter(screen.getByLabelText(/^Название нового перевозчика/));
    expect(pickedValue(carrier)).toBe('k1');
    expect((await store.load()).carriers).toHaveLength(2);
  });

  it('затрата: тип затрат «+ Добавить…» (стандартный тип не дублируется), получатель «+ Новый…»', async () => {
    const seed: Partial<Dataset> = {
      lists: [{ id: 'l1', list: 'costType', value: 'Аванс', order: 1 }],
      suppliers: [{ id: 's1', name: 'Alpha Valve' }], agents: [{ id: 'a1', name: 'Агент Один' }],
      orders: [{ id: 'o12', number: 12, date: '2026-09-01', costsComplete: false }],
    };
    const store = new LocalStore('zk:t:inline-costs', seed);
    render(<MemoryRouter><DataProvider store={store} today="2026-10-25"><CostsScreen /></DataProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить затрату' }));
    const form = within(screen.getByRole('form', { name: 'Новая затрата' }));
    set(form.getByLabelText(/^Номер счёта/), 'INV-1');
    const type = form.getByLabelText(/^Тип затраты/);
    choose(type, '+ Добавить…');
    set(form.getByLabelText(/^Новое значение/), 'Сертификация');
    enter(form.getByLabelText(/^Новое значение/));
    expect(value(type)).toBe('Сертификация');
    choose(type, '+ Добавить…');
    set(form.getByLabelText(/^Новое значение/), 'пошлина');
    enter(form.getByLabelText(/^Новое значение/));
    expect(value(type)).toBe('Пошлина');

    set(form.getByLabelText(/^Кому платим/), 'agent');
    const payee = form.getByLabelText(/^Получатель$/);
    choose(payee, '+ Новый платёжный агент…');
    set(form.getByLabelText(/^Название нового платёжного агента/), 'Агент Два');
    enter(form.getByLabelText(/^Название нового платёжного агента/));
    expect(selectedText(payee)).toBe('Агент Два');
    expect(value(form.getByLabelText(/^Номер счёта/))).toBe('INV-1');
    await waitFor(async () => {
      const d = await store.load();
      expect(d.agents.map((a) => a.name)).toEqual(['Агент Один', 'Агент Два']);
      expect(d.lists.filter((l) => l.list === 'costType').map((l) => l.value)).toEqual(['Аванс', 'Сертификация']);
    });
  });

  it('карточка поставщика: тип компании «+ Добавить…», введённое название остаётся', async () => {
    const { store } = renderDirs('/suppliers/new', dirSeed);
    const name = await screen.findByLabelText(/^Название/);
    set(name, 'Omega Trade');
    const ct = screen.getByLabelText(/^Тип компании/);
    choose(ct, '+ Добавить…');
    set(screen.getByLabelText(/^Новое значение/), 'Дистрибьютор');
    enter(screen.getByLabelText(/^Новое значение/));
    expect(value(ct)).toBe('Дистрибьютор');
    expect(value(screen.getByLabelText(/^Название/))).toBe('Omega Trade');
    await waitFor(async () => expect(await listValues(store, 'companyType')).toContain('Дистрибьютор'));
  });
});

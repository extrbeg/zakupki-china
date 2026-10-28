import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ListItem } from '../../../src/domain/model';
import { renderAt } from './helpers';

const lists: ListItem[] = [
  { id: 'p1', list: 'payer', value: 'ООО Альфа', order: 1 },
  { id: 'p2', list: 'payer', value: 'ООО Бета', order: 2 },
  { id: 'p3', list: 'payer', value: 'ООО Гамма', order: 3 },
  { id: 'd1', list: 'department', value: 'Цех', order: 1 },
];

const section = (name: string) => screen.getByRole('region', { name });
const values = (name: string) => within(section(name)).getAllByRole('textbox')
  .filter((i) => (i as HTMLInputElement).dataset.role === 'value').map((i) => (i as HTMLInputElement).value);
const stored = async (store: { load(): Promise<{ lists: ListItem[] }> }, key: string) =>
  (await store.load()).lists.filter((l) => l.list === key).sort((a, b) => a.order - b.order).map((l) => l.value);

describe('экран «Списки»', () => {
  it('показывает все списки со значениями по порядку', async () => {
    renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const titles = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(titles).toEqual(['Плательщики', 'Подразделения', 'Заказчики', 'Типы затрат', 'Типы компании', 'Направления', 'Специализации', 'Условия оплаты', 'Единицы измерения', 'Типы поставки']);
    expect(values('Плательщики')).toEqual(['ООО Альфа', 'ООО Бета', 'ООО Гамма']);
  });

  it('добавляет значение в конец списка', async () => {
    const { store } = renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const add = within(section('Плательщики')).getByLabelText('Новое значение');
    fireEvent.change(add, { target: { value: 'ООО Дельта' } });
    fireEvent.click(within(section('Плательщики')).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Бета', 'ООО Гамма', 'ООО Дельта']));
    expect(values('Плательщики')).toContain('ООО Дельта');
  });

  it('пустое название при добавлении — ошибка у поля, ничего не пишется; дубль тоже', async () => {
    const { store } = renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const sec = within(section('Плательщики'));
    fireEvent.click(sec.getByRole('button', { name: 'Добавить' }));
    expect(await sec.findByText('Введите название')).toBeTruthy();
    fireEvent.change(sec.getByLabelText('Новое значение'), { target: { value: ' ооо бета ' } });
    fireEvent.click(sec.getByRole('button', { name: 'Добавить' }));
    expect(await sec.findByText('Такое значение уже есть')).toBeTruthy();
    expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Бета', 'ООО Гамма']);
  });

  it('переименовывает значение; пустое название — ошибка у поля и не сохраняется', async () => {
    const { store } = renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const sec = within(section('Плательщики'));
    const field = sec.getByDisplayValue('ООО Бета');
    fireEvent.change(field, { target: { value: '' } });
    expect(await sec.findByText('Введите название')).toBeTruthy();
    fireEvent.blur(field);
    expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Бета', 'ООО Гамма']);
    fireEvent.change(field, { target: { value: 'ООО Бета-2' } });
    fireEvent.blur(field);
    await waitFor(async () => expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Бета-2', 'ООО Гамма']));
  });

  it('переставляет значения вверх и вниз', async () => {
    const { store } = renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const sec = within(section('Плательщики'));
    fireEvent.click(sec.getByRole('button', { name: 'Поднять: ООО Гамма' }));
    await waitFor(async () => expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Гамма', 'ООО Бета']));
    expect(values('Плательщики')).toEqual(['ООО Альфа', 'ООО Гамма', 'ООО Бета']);
    fireEvent.click(sec.getByRole('button', { name: 'Опустить: ООО Альфа' }));
    await waitFor(async () => expect(await stored(store, 'payer')).toEqual(['ООО Гамма', 'ООО Альфа', 'ООО Бета']));
    expect(sec.queryByRole('button', { name: 'Поднять: ООО Гамма' })).toHaveProperty('disabled', true);
  });

  it('удаляет значение только своего списка', async () => {
    const { store } = renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    fireEvent.click(within(section('Плательщики')).getByRole('button', { name: 'Удалить: ООО Бета' }));
    await waitFor(async () => expect(await stored(store, 'payer')).toEqual(['ООО Альфа', 'ООО Гамма']));
    expect(await stored(store, 'department')).toEqual(['Цех']);
  });
});

describe('«Списки» → «Типы поставки» (G29)', () => {
  const types = [{ id: 't1', name: 'Море, контейнер', basis: 'cbm' as const }, { id: 't2', name: 'Авиа', basis: 'weight' as const }];
  const shipments = [{ id: 'sh1', number: 'П-2026-001', mode: 'sea_container' as const, vatRate: 22, typeId: 't1' }];
  const typeNames = () => within(section('Типы поставки')).getAllByRole('textbox')
    .filter((i) => (i as HTMLInputElement).dataset.role === 'value').map((i) => (i as HTMLInputElement).value);

  it('типы с правилом деления доставки; пустой справочник — заранее заведённые', async () => {
    renderAt('/lists', { lists, shipmentTypes: types });
    await screen.findByRole('heading', { name: 'Списки' });
    expect(typeNames()).toEqual(['Море, контейнер', 'Авиа']);
    expect((within(section('Типы поставки')).getByLabelText('Делить доставку: Авиа') as HTMLSelectElement).value).toBe('weight');
  });

  it('пустой справочник показывает заранее заведённые типы', async () => {
    renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    expect(typeNames()).toEqual(['Море, контейнер', 'Авто, контейнер', 'Ж/д, контейнер', 'Авиа', 'Авто, сборный груз']);
  });

  it('добавление с правилом, переименование и смена правила', async () => {
    const { store } = renderAt('/lists', { lists, shipmentTypes: types });
    await screen.findByRole('heading', { name: 'Списки' });
    const s = within(section('Типы поставки'));
    fireEvent.change(s.getByLabelText('Новый тип поставки'), { target: { value: 'Ж/д, контейнер' } });
    fireEvent.change(s.getByLabelText('Делить доставку'), { target: { value: 'cbm' } });
    fireEvent.click(s.getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).shipmentTypes.map((t) => [t.name, t.basis])).toContainEqual(['Ж/д, контейнер', 'cbm']));

    const input = s.getByLabelText('Тип поставки: Авиа');
    fireEvent.change(input, { target: { value: 'Авиа-экспресс' } });
    fireEvent.blur(input);
    await waitFor(async () => expect((await store.load()).shipmentTypes.find((t) => t.id === 't2')?.name).toBe('Авиа-экспресс'));
    fireEvent.change(s.getByLabelText('Делить доставку: Море, контейнер'), { target: { value: 'weight' } });
    await waitFor(async () => expect((await store.load()).shipmentTypes.find((t) => t.id === 't1')?.basis).toBe('weight'));
  });

  it('дубль названия — ошибка, ничего не пишется', async () => {
    const { store } = renderAt('/lists', { lists, shipmentTypes: types });
    await screen.findByRole('heading', { name: 'Списки' });
    const s = within(section('Типы поставки'));
    fireEvent.change(s.getByLabelText('Новый тип поставки'), { target: { value: ' авиа ' } });
    fireEvent.click(s.getByRole('button', { name: 'Добавить' }));
    expect(await s.findByText('Такой тип уже есть')).toBeTruthy();
    expect((await store.load()).shipmentTypes).toHaveLength(2);
  });

  it('тип, который используется в поставках, не удаляется; неиспользуемый — удаляется', async () => {
    const { store } = renderAt('/lists', { lists, shipmentTypes: types, shipments });
    await screen.findByRole('heading', { name: 'Списки' });
    const s = within(section('Типы поставки'));
    fireEvent.click(s.getByRole('button', { name: 'Удалить: Море, контейнер' }));
    expect(await s.findByText('Тип используется в поставках: П-2026-001')).toBeTruthy();
    fireEvent.click(s.getByRole('button', { name: 'Удалить: Авиа' }));
    fireEvent.click(s.getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).shipmentTypes.map((t) => t.id)).toEqual(['t1']));
  });
});

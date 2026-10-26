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
  it('показывает все восемь списков со значениями по порядку', async () => {
    renderAt('/lists', { lists });
    await screen.findByRole('heading', { name: 'Списки' });
    const titles = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(titles).toEqual(['Плательщики', 'Подразделения', 'Заказчики', 'Типы затрат', 'Типы компании', 'Направления', 'Специализации', 'Условия оплаты']);
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

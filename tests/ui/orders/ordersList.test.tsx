import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { baseSeed, renderAt } from './helpers';

describe('список заказов', () => {
  it('пустой список: кнопки «Создать заказ» и «Импорт из старой таблицы»', async () => {
    renderAt('/', {});
    expect(await screen.findByRole('button', { name: 'Создать заказ' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Импорт из старой таблицы' }));
    expect(await screen.findByText('экран импорта')).toBeTruthy();
  });

  it('показывает заказы по убыванию номера', async () => {
    renderAt('/', baseSeed);
    await screen.findByText('Краны');
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('12')).toBeTruthy();
    expect(within(rows[1]).getByText('6')).toBeTruthy();
  });

  it('поиск: по номеру, заказчику, ID задачи заказа и ID задачи поставщика', async () => {
    renderAt('/', baseSeed);
    await screen.findByText('Краны');
    const search = screen.getByLabelText(/^Поиск/);
    const shown = () => screen.queryByText('Краны') !== null;
    const shownCable = () => screen.queryByText('Кабель') !== null;

    fireEvent.change(search, { target: { value: '6' } });
    expect(shown()).toBe(false);
    expect(shownCable()).toBe(true);

    fireEvent.change(search, { target: { value: 'юг' } });
    expect(shown()).toBe(false);
    expect(shownCable()).toBe(true);

    fireEvent.change(search, { target: { value: '7001' } });   // ID задачи заказа 12
    expect(shown()).toBe(true);
    expect(shownCable()).toBe(false);

    fireEvent.change(search, { target: { value: '8002' } });   // ID задачи поставщика в заказе 12
    expect(shown()).toBe(true);
    expect(shownCable()).toBe(false);

    fireEvent.change(search, { target: { value: 'нет такого' } });
    expect(await screen.findByText('Ничего не найдено')).toBeTruthy();
  });

  it('строка ведёт в карточку заказа', async () => {
    renderAt('/', baseSeed);
    fireEvent.click(await screen.findByText('Краны'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/orders/o12'));
  });
});

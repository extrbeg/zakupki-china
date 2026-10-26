import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { baseSeed, renderAt } from './helpers';

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(input(label), { target: { value } });

const seed = {
  ...baseSeed,
  agents: [
    { id: 'a1', name: 'Агент Один', city: 'Нинбо', province: 'Чжэцзян' },
    { id: 'a2', name: 'Платёжный Два' },
  ],
  carriers: [
    { id: 'k1', name: 'Море-Транс', type: 'Экспедитор' },
    { id: 'k2', name: 'Авто-Карго', contractSigned: true },
  ],
  costs: [{ id: 'cs1', entryDate: '2026-10-01', status: 'fact' as const, targetType: 'order' as const, targetId: 'o6', costType: 'Комиссия агента', payeeType: 'agent' as const, payeeId: 'a1', currency: 'CNY' as const, rateManual: false }],
  shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container' as const, carrierId: 'k1', vatRate: 22 }],
};

describe('платёжные агенты', () => {
  it('создаёт агента со всеми полями истории 64; провинция по городу подставляется сама', async () => {
    const { store } = renderAt('/agents', seed);
    await screen.findByText('Агент Один');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить агента' }));
    type(/^Наименование/, 'Новый агент');
    type(/^Контактное лицо/, 'Ван');
    type(/^Юридический адрес/, 'Шэньчжэнь, 1');
    type(/^Город/, 'Гуанчжоу');
    expect(input(/^Провинция/).value).toBe('Гуандун');
    type(/^Телефон/, '+86 1');
    type(/^email/i, 'x@y.cn');
    type(/^Реквизиты/, 'IBAN 1');
    type(/^Комментарий/, 'ком');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).agents).toHaveLength(3));
    const a = (await store.load()).agents.find((x) => x.name === 'Новый агент');
    expect(a).toMatchObject({
      contactPerson: 'Ван', legalAddress: 'Шэньчжэнь, 1', city: 'Гуанчжоу', province: 'Гуандун',
      phone: '+86 1', email: 'x@y.cn', requisites: 'IBAN 1', comment: 'ком',
    });
  });

  it('поиск по названию; пустое название — ошибка у поля', async () => {
    const { store } = renderAt('/agents', seed);
    await screen.findByText('Агент Один');
    fireEvent.change(screen.getByLabelText('Поиск по названию'), { target: { value: 'платёж' } });
    expect(screen.queryByText('Агент Один')).toBeNull();
    expect(screen.getByText('Платёжный Два')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить агента' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите название')).toBeTruthy();
    expect((await store.load()).agents).toHaveLength(2);
  });

  it('карточка существующего агента редактируется и удаляется', async () => {
    const { store } = renderAt('/agents', seed);
    fireEvent.click(await screen.findByText('Платёжный Два'));
    type(/^Телефон/, '777');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).agents.find((a) => a.id === 'a2')?.phone).toBe('777'));
    fireEvent.click(await screen.findByText('Платёжный Два'));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).agents.map((a) => a.id)).toEqual(['a1']));
  });
});

describe('удаление агента', () => {
  it('агент из затрат не удаляется: сообщение с числом затрат', async () => {
    const { store } = renderAt('/agents', seed);
    fireEvent.click(await screen.findByText('Агент Один'));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Агент используется в затратах: 1')).toBeTruthy();
    expect((await store.load()).agents).toHaveLength(2);
  });
});

describe('перевозчики', () => {
  it('создаёт перевозчика со всеми полями истории 64, включая договор', async () => {
    const { store } = renderAt('/carriers', seed);
    await screen.findByText('Море-Транс');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить перевозчика' }));
    type(/^Наименование/, 'Новый перевозчик');
    type(/^Тип/, 'Авто');
    type(/^Специализация/, 'Сборные грузы');
    type(/^Контактное лицо/, 'Ли');
    type(/^Телефон/, '+7 1');
    type(/^Почта/, 'c@d.ru');
    type(/^Сайт/, 'https://car.example');
    type(/^Договоры/, 'Д-1 от 2026');
    type(/^Срок действия договора/, '2027-01-31');
    fireEvent.click(screen.getByLabelText(/^Договор подписан/));
    type(/^Комментарий/, 'ок');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).carriers).toHaveLength(3));
    const c = (await store.load()).carriers.find((x) => x.name === 'Новый перевозчик');
    expect(c).toMatchObject({
      type: 'Авто', specialization: 'Сборные грузы', contactPerson: 'Ли', phone: '+7 1', email: 'c@d.ru', website: 'https://car.example',
      contracts: 'Д-1 от 2026', contractValidUntil: '2027-01-31', contractSigned: true, comment: 'ок',
    });
  });

  it('поиск по названию и пустое состояние с кнопкой добавления', async () => {
    renderAt('/carriers', seed);
    await screen.findByText('Море-Транс');
    fireEvent.change(screen.getByLabelText('Поиск по названию'), { target: { value: 'авто' } });
    expect(screen.queryByText('Море-Транс')).toBeNull();
    expect(screen.getByText('Авто-Карго')).toBeTruthy();
  });

  it('нет перевозчиков — пустое состояние открывает форму добавления', async () => {
    renderAt('/carriers', {});
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить перевозчика' }));
    expect(screen.getByLabelText(/^Наименование/)).toBeTruthy();
  });

  it('перевозчик из поставки не удаляется: сообщение с номерами поставок', async () => {
    const { store } = renderAt('/carriers', seed);
    fireEvent.click(await screen.findByText('Море-Транс'));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Перевозчик используется в поставках: К-7')).toBeTruthy();
    expect((await store.load()).carriers).toHaveLength(2);
  });
});

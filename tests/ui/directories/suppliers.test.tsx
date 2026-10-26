import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { baseSeed, renderAt } from './helpers';

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(input(label), { target: { value } });

describe('карточка поставщика: город и провинция', () => {
  it('известный город — провинция подставляется сама, подсказки берутся из справочника городов', async () => {
    const { container } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Город/, 'Гуан');
    const options = [...container.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'));
    expect(options).toContain('Гуанчжоу');
    expect(options).not.toContain('Нинбо');
    type(/^Город/, 'Гуанчжоу');
    expect(input(/^Провинция/).value).toBe('Гуандун');
  });

  it('провинцию, подставленную сама, можно поправить руками — поставщик сохраняется с поправкой', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Эпсилон');
    type(/^Город/, 'Нинбо');
    expect(input(/^Провинция/).value).toBe('Чжэцзян');
    type(/^Провинция/, 'Фуцзянь');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers.some((s) => s.name === 'Эпсилон')).toBe(true));
    const saved = (await store.load()).suppliers.find((s) => s.name === 'Эпсилон');
    expect(saved).toMatchObject({ city: 'Нинбо', province: 'Фуцзянь' });
  });

  it('неизвестный город без провинции не сохраняется — ошибка у поля провинции', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Эпсилон');
    type(/^Город/, 'Сямынь');
    expect(input(/^Провинция/).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Для нового города выберите провинцию')).toBeTruthy();
    const ds = await store.load();
    expect(ds.suppliers).toHaveLength(4);
    expect(ds.cities).toHaveLength(3);
  });

  it('неизвестный город с выбранной провинцией — пара попадает в справочник городов', async () => {
    const { store, findByTestId } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Эпсилон');
    type(/^Город/, 'Сямынь');
    type(/^Провинция/, 'Фуцзянь');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).cities).toHaveLength(4));
    const ds = await store.load();
    expect(ds.cities.find((c) => c.city === 'Сямынь')).toMatchObject({ province: 'Фуцзянь' });
    expect(ds.suppliers.find((s) => s.name === 'Эпсилон')).toMatchObject({ city: 'Сямынь', province: 'Фуцзянь' });
    expect((await findByTestId('where')).textContent).toBe('/suppliers');
  });
});

describe('карточка поставщика: поля и сохранение', () => {
  it('сохраняет все поля истории 16, включая банковские реквизиты', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    const fields: [RegExp, string][] = [
      [/^Название/, 'Омега Трейд'], [/^Продукция/, 'Краны, фитинги'], [/^Цена/, 'от 5 до 9 юаней'],
      [/^Контактное лицо/, 'Ли Мэй'], [/^Телефон/, '+86 123'], [/^Почта/, 'a@b.cn'],
      [/^Адрес$/, 'ул. Тестовая, 1'], [/^Сайт/, 'https://omega.example'],
      [/^Получатель/, 'Omega Trade Co'], [/^Банк$/, 'Bank of Test'], [/^Счёт/, '622202'],
      [/^SWIFT/, 'TESTCNBJ'], [/^Адрес банка/, 'Test Road 5'], [/^Комментарий/, 'проверка'],
    ];
    for (const [l, v] of fields) type(l, v);
    fireEvent.change(screen.getByLabelText(/^Специализация/), { target: { value: 'Краны' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(5));
    const s = (await store.load()).suppliers.find((x) => x.name === 'Омега Трейд');
    expect(s).toMatchObject({
      products: 'Краны, фитинги', priceNote: 'от 5 до 9 юаней', contactPerson: 'Ли Мэй', phone: '+86 123', email: 'a@b.cn',
      address: 'ул. Тестовая, 1', website: 'https://omega.example', bankBeneficiary: 'Omega Trade Co', bankName: 'Bank of Test',
      bankAccount: '622202', bankSwift: 'TESTCNBJ', bankAddress: 'Test Road 5', comment: 'проверка', specialization: 'Краны',
    });
    expect(s?.id).toMatch(/^sup_/);
  });

  it('пустое название — ошибка у поля, запись не создаётся', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Введите название')).toBeTruthy();
    expect((await store.load()).suppliers).toHaveLength(4);
  });

  it('редактирование существующего поставщика меняет запись, а не добавляет новую', async () => {
    const { store } = renderAt('/suppliers/s2', baseSeed);
    await screen.findByRole('heading', { name: 'Beta Cable' });
    type(/^Телефон/, '555');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers.find((s) => s.id === 's2')?.phone).toBe('555'));
    expect((await store.load()).suppliers).toHaveLength(4);
  });
});

describe('удаление поставщика', () => {
  it('поставщик из заказов не удаляется: сообщение с номерами заказов', async () => {
    const { store } = renderAt('/suppliers/s1', baseSeed);
    await screen.findByRole('heading', { name: 'Alpha Valve' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(await screen.findByText('Поставщик используется в заказах: 6, 12')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Да, удалить' })).toBeNull();
    expect((await store.load()).suppliers.some((s) => s.id === 's1')).toBe(true);
  });

  it('поставщик без заказов удаляется после подтверждения', async () => {
    const { store, findByTestId } = renderAt('/suppliers/s4', baseSeed);
    await screen.findByRole('heading', { name: 'Delta Unknown' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).suppliers.some((s) => s.id === 's4')).toBe(false));
    expect((await findByTestId('where')).textContent).toBe('/suppliers');
  });
});

describe('список поставщиков', () => {
  it('группирует по провинции, внутри — по городу; без места — в конце', async () => {
    renderAt('/suppliers', baseSeed);
    await screen.findByRole('heading', { name: 'Поставщики' });
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(['Гуандун', 'Чжэцзян', 'Без провинции']);
    const h3 = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(h3).toEqual(['Гуанчжоу', 'Вэньчжоу', 'Нинбо', 'Без города']);
  });

  it('поиск по названию и фильтры по провинции, городу, специализации', async () => {
    renderAt('/suppliers', baseSeed);
    await screen.findByRole('heading', { name: 'Поставщики' });
    const names = () => screen.queryAllByRole('link').map((a) => a.textContent);

    fireEvent.change(screen.getByLabelText('Поиск по названию'), { target: { value: 'cable' } });
    expect(names()).toEqual(['Beta Cable']);
    fireEvent.change(screen.getByLabelText('Поиск по названию'), { target: { value: '' } });

    fireEvent.change(screen.getByLabelText('Провинция'), { target: { value: 'Чжэцзян' } });
    expect(names().sort()).toEqual(['Alpha Valve', 'Gamma Fittings']);
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: 'Нинбо' } });
    expect(names()).toEqual(['Alpha Valve']);
    fireEvent.change(screen.getByLabelText('Город'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Провинция'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Специализация'), { target: { value: 'Кабель' } });
    expect(names()).toEqual(['Beta Cable']);
  });

  it('нет поставщиков — пустое состояние с кнопкой «Добавить поставщика», она ведёт в новую карточку', async () => {
    const { findByTestId } = renderAt('/suppliers', { cities: baseSeed.cities });
    const btn = await screen.findByRole('button', { name: 'Добавить поставщика' });
    fireEvent.click(btn);
    expect((await findByTestId('where')).textContent).toBe('/suppliers/new');
  });

  it('клик по названию открывает карточку', async () => {
    const { findByTestId } = renderAt('/suppliers', baseSeed);
    await screen.findByRole('heading', { name: 'Поставщики' });
    fireEvent.click(screen.getByRole('link', { name: 'Alpha Valve' }));
    expect((await findByTestId('where')).textContent).toBe('/suppliers/s1');
  });
});

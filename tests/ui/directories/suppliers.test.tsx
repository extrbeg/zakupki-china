import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { baseSeed, renderAt } from './helpers';
import { pickSuggestion, suggestionTexts, suggestionValues } from '../components/suggest';
import { ADD_OPTION_VALUE } from '../../../src/ui/components';

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(input(label), { target: { value } });
/** «+ Добавить…» в поле выбора: ввод нового названия и Enter. */
function addNew(label: RegExp, action: string, name: string, inputLabel: string) {
  pickSuggestion(input(label), action, name);
  const field = screen.getByLabelText(inputLabel);
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

describe('карточка поставщика: город и провинция', () => {
  it('известный город — провинция подставляется сама, подсказки берутся из справочника городов', async () => {
    renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Город/, 'Гуан');
    const options = suggestionValues(input(/^Город/));
    expect(options).toContain('Гуанчжоу');
    expect(options).not.toContain('Нинбо');
    type(/^Город/, 'Гуанчжоу');
    expect(input(/^Провинция/).value).toBe('Гуандун');
  });

  it('выбор провинции сужает список городов до её городов; город из другой провинции при смене снимается', async () => {
    renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    pickSuggestion(input(/^Провинция/), 'Чжэцзян', 'Чжэ');
    act(() => input(/^Город/).focus());
    expect(suggestionValues(input(/^Город/)).sort()).toEqual(['Вэньчжоу', 'Нинбо']);
    pickSuggestion(input(/^Город/), 'Нинбо');
    pickSuggestion(input(/^Провинция/), 'Гуандун', 'Гуан');
    expect(input(/^Город/).value).toBe('');
    expect(input(/^Провинция/).value).toBe('Гуандун');
  });

  it('город не из справочника не вводится текстом: ушли из поля — значение не меняется', async () => {
    renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    act(() => input(/^Город/).focus());
    type(/^Город/, 'Сямынь');
    expect(suggestionTexts(input(/^Город/))).toEqual([]);
    act(() => input(/^Город/).blur());
    expect(input(/^Город/).value).toBe('');
  });

  it('«+ Добавить город…» без провинции — ошибка у провинции, запись не создаётся', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Эпсилон');
    addNew(/^Город/, '+ Добавить город…', 'Сямынь', 'Новый город');
    expect(input(/^Город/).value).toBe('Сямынь');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Для нового города выберите провинцию')).toBeTruthy();
    const ds = await store.load();
    expect(ds.suppliers).toHaveLength(4);
    expect(ds.cities).toHaveLength(3);
  });

  it('новый город и новая провинция через «+ Добавить…» — пара попадает в справочник', async () => {
    const { store, findByTestId } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Эпсилон');
    addNew(/^Провинция/, '+ Добавить провинцию…', 'Фуцзянь', 'Новая провинция');
    addNew(/^Город/, '+ Добавить город…', 'Сямынь', 'Новый город');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).cities).toHaveLength(4));
    const ds = await store.load();
    expect(ds.cities.find((c) => c.city === 'Сямынь')).toMatchObject({ province: 'Фуцзянь' });
    expect(ds.suppliers.find((s) => s.name === 'Эпсилон')).toMatchObject({ city: 'Сямынь', province: 'Фуцзянь' });
    expect((await findByTestId('where')).textContent).toBe('/suppliers');
  });
});

describe('карточка поставщика: несколько специализаций', () => {
  it('выбранные значения — плашками, в листе одной ячейкой через «; »; плашку можно убрать', async () => {
    const { store } = renderAt('/suppliers/new', baseSeed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Мульти');
    const spec = () => screen.getByLabelText(/^Специализация/) as HTMLSelectElement;
    fireEvent.change(spec(), { target: { value: 'Краны' } });
    fireEvent.change(spec(), { target: { value: 'Кабель' } });
    expect(within(screen.getByRole('list', { name: 'Выбрано: Специализация' })).getAllByRole('listitem').map((li) => li.firstChild?.textContent))
      .toEqual(['Краны', 'Кабель']);
    expect([...spec().options].map((o) => o.textContent)).not.toContain('Краны');
    fireEvent.click(screen.getByRole('button', { name: 'Убрать «Краны»' }));
    fireEvent.change(spec(), { target: { value: 'Краны' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(5));
    expect((await store.load()).suppliers.find((x) => x.name === 'Мульти')?.specialization).toBe('Кабель; Краны');
  });

  it('старое значение через «;» открывается плашками; «+ Добавить…» пишет новое значение в «Списки»', async () => {
    const seed = { ...baseSeed, suppliers: [{ id: 's9', name: 'Старый', specialization: 'Краны;Фитинги, отводы' }] };
    const { store } = renderAt('/suppliers/s9', seed);
    await screen.findByRole('heading', { name: 'Старый' });
    expect(within(screen.getByRole('list', { name: 'Выбрано: Специализация' })).getAllByRole('listitem').map((li) => li.firstChild?.textContent))
      .toEqual(['Краны', 'Фитинги, отводы']);
    fireEvent.change(screen.getByLabelText(/^Специализация/), { target: { value: ADD_OPTION_VALUE } });
    const name = screen.getByLabelText('Новое значение: Специализация');
    fireEvent.change(name, { target: { value: 'Насосы' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers[0].specialization).toBe('Краны; Фитинги, отводы; Насосы'));
    expect((await store.load()).lists.some((l) => l.list === 'specialization' && l.value === 'Насосы')).toBe(true);
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
  it('одна таблица без групп, по названию: Название, Страна, Тип компании, Направление, Специализация', async () => {
    renderAt('/suppliers', baseSeed);
    await screen.findByRole('heading', { name: 'Поставщики' });
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Название', 'Страна', 'Тип компании', 'Направление', 'Специализация']);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Alpha Valve', 'Beta Cable', 'Delta Unknown', 'Gamma Fittings']);
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[1].textContent).toBe('Китай');   // старая строка с городом — Китай
  });

  it('поиск без выбранных полей — во всех полях; с выбранными — только в них', async () => {
    const seed = {
      ...baseSeed,
      suppliers: [
        ...baseSeed.suppliers!,
        { id: 's5', name: 'Epsilon', contactPerson: 'Ли Нин', products: 'Краны шаровые' },
      ],
    };
    renderAt('/suppliers', seed);
    await screen.findByRole('heading', { name: 'Поставщики' });
    const names = () => screen.queryAllByRole('link').map((a) => a.textContent);
    const find = (text: string) => fireEvent.change(screen.getByLabelText('Найти'), { target: { value: text } });
    const toggle = (field: string) => fireEvent.click(within(screen.getByRole('group', { name: 'Где искать' })).getByRole('button', { name: field }));

    find('нин');
    expect(names()).toEqual(['Alpha Valve', 'Epsilon']);       // город «Нинбо» и контакт «Ли Нин»
    toggle('Контактное лицо');
    expect(names()).toEqual(['Epsilon']);
    toggle('Город');
    expect(names()).toEqual(['Alpha Valve', 'Epsilon']);
    expect(screen.getByRole('status').textContent).toBe('Найдено: 2 из 5');

    find('кран');
    toggle('Контактное лицо');
    toggle('Город');
    toggle('Специализация');
    expect(names()).toEqual(['Alpha Valve', 'Gamma Fittings']);
    toggle('Продукция');
    expect(names()).toEqual(['Alpha Valve', 'Epsilon', 'Gamma Fittings']);

    find('чжэцзян');
    toggle('Специализация');
    toggle('Продукция');
    toggle('Провинция');
    expect(names()).toEqual(['Alpha Valve', 'Gamma Fittings']);
    find('нет такого');
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить поиск' }));
    expect(names()).toHaveLength(5);
    expect(within(screen.getByRole('group', { name: 'Где искать' })).getByRole('button', { name: 'Провинция' }).getAttribute('aria-pressed')).toBe('false');
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

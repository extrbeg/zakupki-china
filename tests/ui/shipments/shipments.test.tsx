import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { baseSeed, renderAt, rubCost, shipment, squash } from './helpers';
import { pickByValue, pickSuggestion, pickedValue, suggestionTexts } from '../components/suggest';

const typeInto = (label: RegExp | string | HTMLElement, value: string) =>
  fireEvent.change(typeof label === 'object' && !(label instanceof RegExp) ? label : screen.getByLabelText(label), { target: { value } });

describe('список и создание поставки', () => {
  it('пустой список — кнопка «Создать поставку»; новая поставка берёт НДС из настроек и открывается в карточке', async () => {
    const { store } = renderAt('/shipments', baseSeed);
    fireEvent.click(await screen.findByRole('link', { name: 'Создать поставку' }));
    expect(await screen.findByLabelText(/^Номер поставки/)).toBeTruthy();
    expect((screen.getByLabelText(/^НДС, %/) as HTMLInputElement).value).toBe('20');
    typeInto(/^Номер поставки/, 'К-1');
    pickByValue(screen.getByLabelText('Тип поставки'), 'stp_air');   // G29: тип — из «Типов поставки»
    pickSuggestion(screen.getByLabelText('Перевозчик'), 'Море-Транс');
    typeInto('Отправка в РФ', '2026-11-01');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поставку' }));
    await waitFor(async () => expect((await store.load()).shipments).toHaveLength(1));
    const saved = (await store.load()).shipments[0];
    expect(saved).toMatchObject({ number: 'К-1', typeId: 'stp_air', mode: 'air', carrierId: 'k1', sentDate: '2026-11-01', vatRate: 20 });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(`/shipments/${saved.id}`));
  });

  it('список показывает поставки с типом и перевозчиком; строка ведёт в карточку', async () => {
    renderAt('/shipments', { ...baseSeed, shipments: [shipment('sh1', 'К-7', { carrierId: 'k1' })] });
    fireEvent.click(await screen.findByText('К-7'));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/shipments/sh1'));
  });

  it('даты в списке — дд.мм.гггг, тип — общей подписью, пустая дата — «—»', async () => {
    renderAt('/shipments', { ...baseSeed, shipments: [shipment('sh1', 'К-7', { sentDate: '2026-10-08' })] });
    const row = (await screen.findByText('К-7')).closest('tr')!;
    expect(within(row).getByText('08.10.2026')).toBeTruthy();
    expect(within(row).queryByText('2026-10-08')).toBeNull();
    expect(within(row).getByText('Море, контейнер')).toBeTruthy();
    expect(within(row).getByText('—')).toBeTruthy();   // прибытие не указано
  });

  it('пустой номер — ошибка у поля, ничего не записано', async () => {
    const { store } = renderAt('/shipments/new', baseSeed);
    typeInto(await screen.findByLabelText(/^Номер поставки/), '');   // номер присваивается сам — стёрли руками
    fireEvent.click(await screen.findByRole('button', { name: 'Сохранить поставку' }));
    expect(await screen.findByText('Введите номер поставки')).toBeTruthy();
    expect((await store.load()).shipments).toHaveLength(0);
  });
});

describe('номер и тип поставки (G28, G29)', () => {
  it('номер присваивается сам: П-ГГГГ-NNN по году отправки в РФ, пока его не правили; номер контейнера — отдельным полем', async () => {
    const { store } = renderAt('/shipments/new', { ...baseSeed, shipments: [shipment('sh1', 'П-2026-004'), shipment('sh2', '32-1')] });
    const number = (await screen.findByLabelText(/^Номер поставки/)) as HTMLInputElement;
    expect(number.value).toBe('П-2026-005');
    typeInto('Отправка в РФ', '2027-01-10');
    expect(number.value).toBe('П-2027-001');
    typeInto(/^Номер контейнера/, 'MSCU1234567');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поставку' }));
    await waitFor(async () => expect((await store.load()).shipments).toHaveLength(3));
    expect((await store.load()).shipments.find((s) => s.number === 'П-2027-001')).toMatchObject({ containerNo: 'MSCU1234567', typeId: 'stp_sea', mode: 'sea_container' });
  });

  it('номер правится; занятый — ошибка', async () => {
    const { store } = renderAt('/shipments/new', { ...baseSeed, shipments: [shipment('sh1', 'П-2026-004')] });
    typeInto(await screen.findByLabelText(/^Номер поставки/), 'п-2026-004');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поставку' }));
    expect(await screen.findByText('Поставка «п-2026-004» уже есть')).toBeTruthy();
    expect((await store.load()).shipments).toHaveLength(1);
  });

  it('«+ Добавить…» в типе: название и правило — тип записан в «Типы поставки» и выбран', async () => {
    const { store } = renderAt('/shipments/new', { ...baseSeed, shipmentTypes: [{ id: 'stp_sea', name: 'Море, контейнер', basis: 'cbm' }] });
    pickSuggestion(await screen.findByLabelText('Тип поставки'), '+ Добавить…', 'Ж/д, сборный');
    typeInto(screen.getByLabelText('Новый тип поставки'), 'Ж/д, сборный');
    typeInto(screen.getByLabelText('Делить доставку'), 'weight');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).shipmentTypes).toHaveLength(2));
    const added = (await store.load()).shipmentTypes.find((t) => t.name === 'Ж/д, сборный')!;
    expect(added).toMatchObject({ basis: 'weight' });
    await waitFor(() => expect(pickedValue(screen.getByLabelText('Тип поставки'))).toBe(added.id));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить поставку' }));
    await waitFor(async () => expect((await store.load()).shipments).toHaveLength(1));
    expect((await store.load()).shipments[0]).toMatchObject({ typeId: added.id, mode: 'other' });
  });

  it('список: тип — названием из «Типов поставки»', async () => {
    renderAt('/shipments', { ...baseSeed, shipmentTypes: [{ id: 't1', name: 'Ж/д, контейнер', basis: 'cbm' }], shipments: [shipment('sh1', 'П-2026-001', { typeId: 't1' })] });
    const row = (await screen.findByText('П-2026-001')).closest('tr')!;
    expect(within(row).getByText('Ж/д, контейнер')).toBeTruthy();
  });
});

describe('партии', () => {
  const seed = { ...baseSeed, shipments: [shipment('sh1', 'К-1')] };

  it('поиск по поставщику/названию сужает позиции; незакупаемые не показываются', async () => {
    renderAt('/shipments/sh1', seed);
    const field = (await screen.findByLabelText(/^Позиция/)) as HTMLInputElement;
    act(() => field.focus());
    expect(suggestionTexts(field).some((t) => /Не закупаем/.test(t))).toBe(false);
    typeInto(field, 'beta');
    expect(suggestionTexts(field).some((t) => /Кабель силовой/.test(t))).toBe(true);
    expect(suggestionTexts(field).some((t) => /Кран шаровой/.test(t))).toBe(false);
    typeInto(field, '12');
    expect(suggestionTexts(field).some((t) => /Кран шаровой/.test(t))).toBe(true);
    expect(suggestionTexts(field).some((t) => /Кабель силовой/.test(t))).toBe(false);
  });

  it('количество больше остатка — «В партиях 1200 из 1000 шт»; верное — партия с CBM и весом пропорционально', async () => {
    const { store } = renderAt('/shipments/sh1', seed);
    await screen.findByRole('button', { name: 'Добавить партию' });
    pickByValue(screen.getByLabelText(/^Позиция/), 'l1');
    typeInto(/^Кол-во в партии/, '1200');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить партию' }));
    expect(await screen.findByText('В партиях 1200 из 1000 шт')).toBeTruthy();
    expect((await store.load()).batches).toHaveLength(0);

    typeInto(/^Кол-во в партии/, '600');
    expect((screen.getByLabelText('CBM') as HTMLInputElement).value).toBe('6');
    expect((screen.getByLabelText('Вес, кг') as HTMLInputElement).value).toBe('300');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить партию' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(1));
    expect((await store.load()).batches[0]).toMatchObject({ shipmentId: 'sh1', lineId: 'l1', qty: 600, cbm: 6, weight: 300, places: 12 });
  });

  it('«1о00» в количестве — ошибка «Введите число», партия не записана (а не 1 шт)', async () => {
    const { store } = renderAt('/shipments/sh1', seed);
    await screen.findByRole('button', { name: 'Добавить партию' });
    pickByValue(screen.getByLabelText(/^Позиция/), 'l1');
    typeInto(/^Кол-во в партии/, '1');
    typeInto(/^Кол-во в партии/, '1о00');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить партию' }));
    expect(await screen.findByText('Введите число')).toBeTruthy();
    expect((screen.getByLabelText(/^Кол-во в партии/) as HTMLInputElement).value).toBe('1о00');
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.load()).batches).toHaveLength(0);
  });

  it('удаление партии — через подтверждение «Да, удалить»', async () => {
    const { store } = renderAt('/shipments/sh1', { ...seed, batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 600 }] });
    const row = await screen.findByTestId('batch-row-b1');
    fireEvent.click(within(row).getByRole('button', { name: /Удалить партию.*Кран шаровой/ }));
    expect((await store.load()).batches).toHaveLength(1);
    fireEvent.click(within(row).getByRole('button', { name: 'Не удалять' }));
    expect((await store.load()).batches).toHaveLength(1);
    fireEvent.click(within(row).getByRole('button', { name: /Удалить партию.*Кран шаровой/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(0));
  });

  it('правка партии проверяет остаток с учётом других партий позиции', async () => {
    const { store } = renderAt('/shipments/sh1', {
      ...seed,
      shipments: [shipment('sh1', 'К-1'), shipment('sh2', 'К-2')],
      batches: [
        { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 600 },
        { id: 'b2', shipmentId: 'sh2', lineId: 'l1', qty: 400 },
      ],
    });
    fireEvent.click(await screen.findByRole('button', { name: /Изменить партию.*Кран шаровой/ }));
    typeInto(/^Кол-во в партии/, '700');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить партию' }));
    expect(await screen.findByText('В партиях 1100 из 1000 шт')).toBeTruthy();
    expect((await store.load()).batches.find((b) => b.id === 'b1')?.qty).toBe(600);
  });

  it('позиция по частям в двух поставках: у каждой партии своя себестоимость единицы и средняя по позиции', async () => {
    const data = {
      ...seed,
      shipments: [shipment('sh1', 'К-1'), shipment('sh2', 'К-2')],
      batches: [
        { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 600, cbm: 6, weight: 300 },
        { id: 'b2', shipmentId: 'sh2', lineId: 'l1', qty: 400, cbm: 4, weight: 200 },
      ],
      costs: [rubCost('c1', 'shipment', 'sh1', 'Доставка', 600), rubCost('c2', 'shipment', 'sh2', 'Доставка', 200)],
    };
    const first = renderAt('/shipments/sh1', data);
    const row1 = (await screen.findByText('Кран шаровой')).closest('tr')!;
    expect(within(row1).getByTestId('unit-cost').textContent).toBe('1,00');   // 600 ₽ / 600 шт
    expect(within(row1).getByTestId('line-avg-cost').textContent).toBe('0,80'); // 800 ₽ / 1000 шт
    first.unmount();
    renderAt('/shipments/sh2', data);
    const row2 = (await screen.findByText('Кран шаровой')).closest('tr')!;
    expect(within(row2).getByTestId('unit-cost').textContent).toBe('0,50');   // 200 ₽ / 400 шт
  });
});

describe('декларации', () => {
  const seed = {
    ...baseSeed,
    shipments: [shipment('sh1', 'К-1')],
    declarations: [{ id: 'd0', shipmentId: 'sh1', number: 'ДТ-0' }],
    batches: [
      { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 300, cbm: 3, weight: 150 },
      { id: 'b2', shipmentId: 'sh1', lineId: 'l4', qty: 50, cbm: 1, weight: 20, declarationId: 'd0' },
      { id: 'b3', shipmentId: 'sh1', lineId: 'l2', qty: 40, cbm: 1, weight: 20 },
    ],
  };

  it('добавляет декларацию с номером ДТ и датой', async () => {
    const { store } = renderAt('/shipments/sh1', { ...baseSeed, shipments: [shipment('sh1', 'К-1')] });
    await screen.findByRole('button', { name: 'Добавить декларацию' });
    typeInto('Номер новой ДТ', '10000/261025/1');
    typeInto('Дата новой ДТ', '2026-10-25');
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить декларацию' }));
    await waitFor(async () => expect((await store.load()).declarations).toHaveLength(1));
    expect((await store.load()).declarations[0]).toMatchObject({ shipmentId: 'sh1', number: '10000/261025/1', date: '2026-10-25' });
  });

  it('партию назначают на декларацию вручную', async () => {
    const { store } = renderAt('/shipments/sh1', seed);
    typeInto(await screen.findByLabelText(/Декларация для партии.*Кабель силовой/), 'd0');
    await waitFor(async () => expect((await store.load()).batches.find((b) => b.id === 'b3')?.declarationId).toBe('d0'));
  });

  it('«По декларации на поставщика» раскладывает только по нажатию и не трогает назначенные', async () => {
    const { store } = renderAt('/shipments/sh1', seed);
    const button = await screen.findByRole('button', { name: 'По декларации на поставщика' });
    // до нажатия — ничего не разложено
    expect((await store.load()).batches.find((b) => b.id === 'b1')?.declarationId).toBeUndefined();
    fireEvent.click(button);
    await waitFor(async () => expect((await store.load()).declarations).toHaveLength(2));
    const ds = await store.load();
    const byId = (id: string) => ds.batches.find((b) => b.id === id)!;
    expect(byId('b2').declarationId).toBe('d0');                       // уже была назначена
    expect(byId('b1').declarationId).toBe('d0');                       // тот же поставщик Alpha — в ту же декларацию
    const created = ds.declarations.find((d) => d.id !== 'd0')!;
    expect(byId('b3').declarationId).toBe(created.id);                 // Beta — новая декларация
    expect(created.comment).toBe('Поставщик: Beta Cable');
    expect(ds.declarations.find((d) => d.id === 'd0')).toMatchObject({ number: 'ДТ-0' });
  });

  it('плановые пошлина и НДС видны до факта: стоимость 10 × 100 × 12, пошлина 10 %, НДС 20 %', async () => {
    renderAt('/shipments/sh1', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1')],
      declarations: [{ id: 'd1', shipmentId: 'sh1', number: 'ДТ-1' }],
      batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 10, declarationId: 'd1' }],
    });
    const box = await screen.findByTestId('declaration-d1');
    const text = squash(box.textContent);
    expect(text).toContain('Таможеннаястоимость12000,00');
    expect(text).toContain('Плановаяпошлина1200,00');
    expect(text).toContain('ПлановыйНДС(20%)2640,00');
  });
});

describe('предупреждения движка', () => {
  it('нет CBM, нет веса, партии без декларации — в карточке, со ссылками на партии', async () => {
    renderAt('/shipments/sh1', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1')],
      declarations: [{ id: 'd1', shipmentId: 'sh1', number: 'ДТ-1' }],
      batches: [{ id: 'b3', shipmentId: 'sh1', lineId: 'l2', qty: 40 }],
      costs: [rubCost('c1', 'shipment', 'sh1', 'Доставка', 100)],
    });
    const region = await screen.findByRole('region', { name: 'Предупреждения' });
    expect(within(region).getByText(/нет CBM у партий/)).toBeTruthy();
    expect(within(region).getByText(/нет веса у партий/)).toBeTruthy();
    expect(within(region).getByText(/партии без декларации/)).toBeTruthy();
    const link = within(region).getAllByRole('button', { name: /Кабель силовой/ })[0];
    fireEvent.click(link);
    expect(screen.getByTestId('batch-row-b3').getAttribute('data-highlight')).toBe('true');
  });

  it('когда всё в порядке — предупреждений нет', async () => {
    renderAt('/shipments/sh1', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1')],
      batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 10, cbm: 1, weight: 5 }],
    });
    await screen.findByText('Что едет');
    expect(screen.queryByRole('region', { name: 'Предупреждения' })).toBeNull();
  });
});

describe('удаление', () => {
  it('поставка с затратами не удаляется — запрет с перечислением', async () => {
    const { store } = renderAt('/shipments/sh1', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1')],
      declarations: [{ id: 'd1', shipmentId: 'sh1' }],
      costs: [rubCost('c1', 'shipment', 'sh1', 'Доставка', 600), rubCost('c2', 'declaration', 'd1', 'Пошлина', 50)],
    });
    const form = await screen.findByTestId('shipment-form');
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить' }));
    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toMatch(/«Доставка»/);
    expect(alert.textContent).toMatch(/«Пошлина»/);
    expect(within(form).queryByRole('button', { name: 'Да, удалить' })).toBeNull();
    expect((await store.load()).shipments).toHaveLength(1);
  });

  it('декларация с затратами не удаляется; без затрат — удаляется, партии остаются без декларации', async () => {
    const { store } = renderAt('/shipments/sh1', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1')],
      declarations: [{ id: 'd1', shipmentId: 'sh1', number: 'ДТ-1' }, { id: 'd2', shipmentId: 'sh1', number: 'ДТ-2' }],
      batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 10, cbm: 1, weight: 5, declarationId: 'd2' }],
      costs: [rubCost('c1', 'declaration', 'd1', 'Пошлина', 50)],
    });
    const d1 = await screen.findByTestId('declaration-d1');
    fireEvent.click(within(d1).getByRole('button', { name: 'Удалить' }));
    expect((await within(d1).findByRole('alert')).textContent).toMatch(/«Пошлина»/);
    expect((await store.load()).declarations).toHaveLength(2);

    const d2 = screen.getByTestId('declaration-d2');
    fireEvent.click(within(d2).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(d2).getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).declarations.map((d) => d.id)).toEqual(['d1']));
    expect((await store.load()).batches[0].declarationId).toBeUndefined();
  });

  it('поставка без затрат удаляется вместе с партиями и декларациями', async () => {
    const { store } = renderAt('/shipments/sh2', {
      ...baseSeed,
      shipments: [shipment('sh1', 'К-1'), shipment('sh2', 'К-2')],
      declarations: [{ id: 'd1', shipmentId: 'sh2' }],
      batches: [
        { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 10 },
        { id: 'b2', shipmentId: 'sh2', lineId: 'l1', qty: 20, declarationId: 'd1' },
      ],
    });
    const form = await screen.findByTestId('shipment-form');
    fireEvent.click(within(form).getByRole('button', { name: 'Удалить' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).shipments.map((s) => s.id)).toEqual(['sh1']));
    const ds = await store.load();
    expect(ds.batches.map((b) => b.id)).toEqual(['b1']);
    expect(ds.declarations).toHaveLength(0);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/shipments'));
  });
});

describe('затраты поставки', () => {
  it('«Добавить затрату» с привязкой к поставке и «Все затраты» с фильтром по поставке', async () => {
    renderAt('/shipments/sh1', { ...baseSeed, shipments: [shipment('sh1', 'К-1')] });
    const section = (await screen.findByRole('heading', { name: 'Затраты поставки' })).closest('section')!;
    expect(within(section).getByRole('link', { name: 'Добавить затрату' }).getAttribute('href')).toBe('/costs?add=shipment:sh1');
    expect(within(section).getByRole('link', { name: 'Все затраты' }).getAttribute('href')).toBe('/costs?shipment=sh1');
  });
});

describe('что едет (G32)', () => {
  const seed = {
    ...baseSeed,
    orders: [
      { id: 'o1', number: 12, code: 'З-2026-012', date: '2026-09-01', customer: 'ТНК', costsComplete: false },
      { id: 'o2', number: 6, code: 'З-2026-006', date: '2026-08-01', customer: 'Газстрой', costsComplete: false },
    ],
    shipments: [shipment('sh1', 'П-2026-001')],
  };

  it('группы заказ → поставщик → товар, по номеру заказа; итоги поставки — CBM, вес, мест', async () => {
    renderAt('/shipments/sh1', {
      ...seed,
      batches: [
        { id: 'b1', shipmentId: 'sh1', lineId: 'l1', qty: 600, cbm: 6, weight: 300, places: 12 },
        { id: 'b2', shipmentId: 'sh1', lineId: 'l2', qty: 100, cbm: 1.5, weight: 80, places: 3 },
      ],
    });
    const section = await screen.findByRole('region', { name: 'Что едет' });
    const groups = within(section).getAllByRole('rowheader').map((h) => h.textContent);
    expect(groups).toEqual(['Заказ З-2026-006 · Газстрой', 'Заказ З-2026-012 · ТНК']);
    expect(within(section).getByText('Поставщик: Beta Cable')).toBeTruthy();
    expect(within(section).getByText('Поставщик: Alpha Valve')).toBeTruthy();
    expect(within(section).getByRole('link', { name: 'З-2026-012' }).getAttribute('href')).toBe('/orders/o1');
    const totals = within(section).getByTestId('shipment-totals');
    expect(within(totals).getByTestId('total-cbm').textContent).toBe('7,5');
    expect(within(totals).getByTestId('total-weight').textContent).toBe('380');
    expect(within(totals).getByTestId('total-places').textContent).toBe('15');
  });

  it('«Добавить из заказа»: поиск заказа по заказчику → товары с остатком целиком → партии пропорционально', async () => {
    const { store } = renderAt('/shipments/sh1', { ...seed, batches: [{ id: 'b0', shipmentId: 'sh1', lineId: 'l1', qty: 400 }] });
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить из заказа' }));
    const form = screen.getByRole('form', { name: 'Добавить из заказа' });
    pickSuggestion(within(form).getByLabelText(/^Заказ/), /З-2026-012/, 'тнк');
    const qty = within(form).getByLabelText('В поставку: Кран шаровой') as HTMLInputElement;
    expect(qty.value).toBe('600');
    expect((within(form).getByLabelText('В поставку: Фланец') as HTMLInputElement).value).toBe('100');
    expect(within(form).queryByLabelText('В поставку: Не закупаем')).toBeNull();
    typeInto(qty, '700');
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    expect(await within(form).findByText('В партиях 1100 из 1000 шт')).toBeTruthy();
    expect((await store.load()).batches).toHaveLength(1);
    typeInto(qty, '500');
    typeInto(within(form).getByLabelText('В поставку: Фланец'), '0');
    fireEvent.click(within(form).getByRole('button', { name: 'Добавить' }));
    await waitFor(async () => expect((await store.load()).batches).toHaveLength(2));
    expect((await store.load()).batches.find((b) => b.id !== 'b0')).toMatchObject({ shipmentId: 'sh1', lineId: 'l1', qty: 500, cbm: 5, weight: 250, places: 10 });
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});

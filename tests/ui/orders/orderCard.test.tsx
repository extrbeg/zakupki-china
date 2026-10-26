import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Dataset } from '../../../src/domain/model';
import { baseSeed, closedHistory, merge, renderAt } from './helpers';

const flat = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]/g, '');
const header = () => screen.getByRole('region', { name: 'Шапка заказа' });
const block = (code: string) => screen.getByRole('region', { name: `Поставщик в заказе ${code}` });
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const totalOf = (label: string) => flat(screen.getByText(label).nextElementSibling?.textContent);
const cell = (row: HTMLElement, col: string) => flat(row.querySelector(`[data-col="${col}"]`)?.textContent);

describe('создание заказа', () => {
  it('номер по умолчанию — следующий свободный; повтор — ошибка у поля, введённое остаётся', async () => {
    const { store } = renderAt('/orders/new', baseSeed);
    const number = (await screen.findByLabelText(/^Номер заказа/)) as HTMLInputElement;
    expect(number.value).toBe('13');
    set(number, '12');
    set(screen.getByLabelText(/^Название/), 'Мой заказ');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }));
    expect(await screen.findByText('Заказ № 12 уже есть')).toBeTruthy();
    expect((screen.getByLabelText(/^Номер заказа/) as HTMLInputElement).value).toBe('12');
    expect((screen.getByLabelText(/^Название/) as HTMLInputElement).value).toBe('Мой заказ');
    expect((await store.load()).orders).toHaveLength(2);
  });

  it('сохраняет все поля шапки и открывает карточку', async () => {
    const { store } = renderAt('/orders/new', baseSeed);
    await screen.findByLabelText(/^Номер заказа/);
    set(screen.getByLabelText(/^Номер заказа/), '20');
    set(screen.getByLabelText(/^Дата заказа/), '2026-10-24');
    set(screen.getByLabelText(/^Подразделение/), 'Цех');
    set(screen.getByLabelText(/^Плательщик/), 'ООО Плательщик');
    set(screen.getByLabelText(/^Заказчик/), 'Заказчик Юг');
    set(screen.getByLabelText(/^Название/), 'Новый');
    set(screen.getByLabelText(/^ID задачи Битрикс24/), '555');
    set(screen.getByLabelText(/^Комментарий/), 'ком');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toMatch(/^\/orders\/ord_/));
    const o = (await store.load()).orders.find((x) => x.number === 20);
    expect(o).toMatchObject({ date: '2026-10-24', department: 'Цех', payer: 'ООО Плательщик', customer: 'Заказчик Юг', title: 'Новый', bitrixTaskId: '555', comment: 'ком', costsComplete: false });
  });
});

describe('ID задачи Битрикс24 — ссылка', () => {
  it('при заданном адресе портала ID — ссылки в новой вкладке (заказ и поставщик)', async () => {
    renderAt('/orders/o12', { ...baseSeed, settings: { bitrixPortalUrl: 'https://b24.example.ru/' } });
    const orderLink = (await screen.findByRole('link', { name: 'Задача 7001 в Битрикс24' })) as HTMLAnchorElement;
    expect(orderLink.href).toBe('https://b24.example.ru/company/personal/user/0/tasks/task/view/7001/');
    expect(orderLink.target).toBe('_blank');
    const soLink = within(block('12-1')).getByRole('link', { name: 'Задача 8002 в Битрикс24' }) as HTMLAnchorElement;
    expect(soLink.href).toBe('https://b24.example.ru/company/personal/user/0/tasks/task/view/8002/');
  });

  it('без адреса портала ссылок нет', async () => {
    renderAt('/orders/o12', baseSeed);
    await screen.findByLabelText(/^Название/);
    expect(screen.queryByRole('link', { name: /в Битрикс24/ })).toBeNull();
  });
});

describe('шапка существующего заказа', () => {
  it('правка названия и ID задачи сохраняется', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    await screen.findByLabelText(/^Название/);
    set(within(header()).getByLabelText(/^Название/), 'Краны 2');
    set(within(header()).getByLabelText(/^ID задачи Битрикс24/), '9999');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить заказ' }));
    await waitFor(async () => expect((await store.load()).orders.find((o) => o.id === 'o12')).toMatchObject({ title: 'Краны 2', bitrixTaskId: '9999' }));
  });

  it('смена даты расчёта сразу пересчитывает ₽ по курсу и прогноз в итогах', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    await screen.findByText('Итоги заказа');
    // дата расчёта 01.10: курс 10 → Z = 1000 × 5 × 10; AB·qty = 1000 × 50 × 1,5
    expect(totalOf('В рублях по курсу расчёта')).toBe('50000,00₽');
    expect(totalOf('Прогноз суммы в РФ')).toBe('75000,00₽');
    set(within(header()).getByLabelText(/^Дата расчёта/), '2026-10-20');   // курс 12
    await waitFor(() => expect(totalOf('В рублях по курсу расчёта')).toBe('60000,00₽'));
    expect(totalOf('Прогноз суммы в РФ')).toBe('90000,00₽');
    await waitFor(async () => expect((await store.load()).orders.find((o) => o.id === 'o12')?.calcDate).toBe('2026-10-20'));
  });

  it('итоги: сумма по валютам без альтернативных позиций', async () => {
    renderAt('/orders/o12', baseSeed);
    await screen.findByText('Итоги заказа');
    expect(totalOf('Сумма заказа')).toBe('5000,00CNY');
  });
});

describe('поставщики в заказе', () => {
  it('новый поставщик: код заказ-№, плановая готовность = запуск + срок, все поля сохраняются', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const b = screen.getByRole('region', { name: 'Новый поставщик в заказе' });
    set(within(b).getByLabelText(/^Поставщик/), 's2');
    set(within(b).getByLabelText(/^Валюта/), 'USD');
    set(within(b).getByLabelText(/^Условия оплаты/), '30/70');
    set(within(b).getByLabelText(/^План\. тип доставки/), 'air');
    set(within(b).getByLabelText(/^Дата запуска/), '2026-10-01');
    set(within(b).getByLabelText(/^Срок изготовления/), '20');
    expect(within(b).getByText('21.10.2026')).toBeTruthy();
    set(within(b).getByLabelText(/^Факт\. готовность/), '2026-10-22');
    set(within(b).getByLabelText(/^ID задачи Битрикс24/), '4444');
    fireEvent.click(within(b).getByRole('button', { name: 'Сохранить поставщика' }));
    await waitFor(async () => expect((await store.load()).supplierOrders).toHaveLength(2));
    const so = (await store.load()).supplierOrders.find((s) => s.seq === 2);
    expect(so).toMatchObject({
      orderId: 'o12', supplierId: 's2', currency: 'USD', paymentTerms: '30/70', plannedMode: 'air',
      launchDate: '2026-10-01', productionDays: 20, actualReadyDate: '2026-10-22', bitrixTaskId: '4444',
    });
    expect(await screen.findByRole('region', { name: 'Поставщик в заказе 12-2' })).toBeTruthy();
  });

  it('не выбран поставщик — ошибка у поля, ничего не сохранено', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const b = screen.getByRole('region', { name: 'Новый поставщик в заказе' });
    fireEvent.click(within(b).getByRole('button', { name: 'Сохранить поставщика' }));
    expect(await within(b).findByText('Выберите поставщика')).toBeTruthy();
    expect((await store.load()).supplierOrders).toHaveLength(1);
  });

  it('курс на дату расчёта показан с датой курса; ручной курс переопределяет расчёт', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const b = block('12-1');
    expect(within(b).getByText(/курс 10,00 на 01\.10\.2026 \(ВТБ\)/)).toBeTruthy();
    fireEvent.click(within(b).getByRole('button', { name: 'Реквизиты поставщика' }));
    expect(within(b).getByText(/Курс на 01\.10\.2026: 10,00/)).toBeTruthy();
    set(within(b).getByLabelText(/^Курс расчёта/), '11');
    fireEvent.click(within(b).getByRole('button', { name: 'Сохранить поставщика' }));
    await waitFor(async () => expect((await store.load()).supplierOrders[0].calcRate).toBe(11));
    await waitFor(() => expect(totalOf('В рублях по курсу расчёта')).toBe('55000,00₽'));
    expect(within(b).getByText(/курс 11,00 на 01\.10\.2026 \(задан вручную\)/)).toBeTruthy();
  });
});

describe('позиции', () => {
  it('показывает X, Y, Z, AB, AD; альтернативная позиция приглушена и не в итогах', async () => {
    renderAt('/orders/o12', baseSeed);
    const row = (await screen.findByText('Кран DN50')).closest('tr') as HTMLElement;
    expect(cell(row, 'X')).toBe('5000,00');
    expect(cell(row, 'Y')).toBe('50,00');
    expect(cell(row, 'Z')).toBe('50000,00');
    expect(cell(row, 'AB')).toBe('75,00');
    expect(cell(row, 'AD')).toBe('1,5');
    const alt = screen.getByText('Кран DN25 альт.');
    expect(alt.closest('.is-alt')).not.toBeNull();
    expect(within(alt.closest('tr') as HTMLElement).getByText('не в работе')).toBeTruthy();
  });

  it('неверный ввод: ошибки у полей, строка не сохраняется, введённое остаётся', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 1' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    set(within(form).getByLabelText(/^Кол-во/), '0');
    set(within(form).getByLabelText(/^Цена в валюте/), 'abc');
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить позицию' }));
    expect(await within(form).findByText('Количество должно быть больше нуля')).toBeTruthy();
    expect(within(form).getByText('Введите число')).toBeTruthy();
    expect((within(form).getByLabelText(/^Кол-во/) as HTMLInputElement).value).toBe('0');
    expect((within(form).getByLabelText(/^Цена в валюте/) as HTMLInputElement).value).toBe('abc');
    set(within(form).getByLabelText(/^Кол-во/), '5');
    set(within(form).getByLabelText(/^Цена в валюте/), '-1');
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить позицию' }));
    expect(await within(form).findByText('Цена не может быть отрицательной')).toBeTruthy();
    expect((await store.load()).lines.find((l) => l.id === 'ln1')).toMatchObject({ qty: 1000, unitPrice: 5 });
  });

  it('новая позиция: строка ввода, затем «Подробнее» — все поля сохраняются, суммы видны сразу', async () => {
    const { store } = renderAt('/orders/o12', baseSeed);
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    set(within(b).getByLabelText('Товар новой позиции'), 'Новая позиция');
    set(within(b).getByLabelText('Кол-во новой позиции'), '4');
    set(within(b).getByLabelText('Цена новой позиции'), '2,5');
    fireEvent.keyDown(within(b).getByLabelText('Цена новой позиции'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 3' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    const f = (label: RegExp, v: string) => set(within(form).getByLabelText(label), v);
    expect((within(form).getByLabelText(/^Название от заказчика/) as HTMLInputElement).value).toBe('Новая позиция');
    f(/^Тех\. параметры/, 'PN16');
    f(/^Название в документах/, 'Valve');
    f(/^Название у поставщика/, 'Ball valve');
    f(/^HS-код/, '8481');
    f(/^Пошлина/, '5');
    f(/^Упаковка/, 'ящик');
    f(/^Размер упаковки/, '10x10x10');
    f(/^CBM/, '0,5');
    f(/^Вес/, '12');
    f(/^Мест/, '3');
    f(/^Коэффициент AD/, '1,6');
    f(/^Комментарий/, 'ок');
    const inWork = within(form).getByLabelText('В работу') as HTMLInputElement;
    expect(inWork.checked).toBe(false);                        // новая позиция — запрос цены, не в работе
    fireEvent.click(inWork);                                   // отметить «В работу»
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить позицию' }));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.customerName === 'Новая позиция')?.hsCode).toBe('8481'));
    expect((await store.load()).lines).toHaveLength(3);
    const line = (await store.load()).lines.find((l) => l.customerName === 'Новая позиция');
    expect(line).toMatchObject({
      orderId: 'o12', supplierOrderId: 'so1', seq: 3, techParams: 'PN16', docName: 'Valve', supplierName: 'Ball valve',
      qty: 4, unitPrice: 2.5, purchased: true, hsCode: '8481', dutyRate: 5, packaging: 'ящик', packageSize: '10x10x10',
      cbm: 0.5, weight: 12, places: 3, coef: 1.6, comment: 'ок',
    });
    const row = (await screen.findByText('Новая позиция')).closest('tr') as HTMLElement;
    expect([cell(row, 'X'), cell(row, 'Y'), cell(row, 'Z'), cell(row, 'AB')]).toEqual(['10,00', '25,00', '100,00', '40,00']);
  });

  it('поля перевода «Name EN (авто)» и «Tech EN (авто)» — только чтение', async () => {
    const seed: Partial<Dataset> = { ...baseSeed, lines: [{ ...baseSeed.lines![0], customerNameEn: 'Ball valve DN50' }, baseSeed.lines![1]] };
    renderAt('/orders/o12', seed);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 1' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    const en = within(form).getByLabelText(/^Name EN/) as HTMLInputElement;
    expect(en.value).toBe('Ball valve DN50');
    expect(en.disabled || en.readOnly).toBe(true);
    const tech = within(form).getByLabelText(/^Tech EN/) as HTMLInputElement;
    expect(tech.disabled || tech.readOnly).toBe(true);
    expect(tech.placeholder).toBe('перевод появится в Google-таблице');
  });

  it('«отгружено N из M»', async () => {
    const seed: Partial<Dataset> = {
      ...baseSeed,
      shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container', vatRate: 22 }],
      batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'ln1', qty: 600 }],
    };
    renderAt('/orders/o12', seed);
    expect(await screen.findByText('отгружено 600 из 1000')).toBeTruthy();
  });
});

describe('подсказка AD', () => {
  const withHistory = (aws: number[]) => merge(baseSeed, closedHistory(aws));

  it('«подсказка 1,50 (по 3 закрытым позициям)»; клик подставляет, поле остаётся редактируемым', async () => {
    const { store } = renderAt('/orders/o12', withHistory([1.4, 1.6, 1.5]));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 1' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    const ad = within(form).getByLabelText(/^Коэффициент AD/) as HTMLInputElement;
    set(ad, '2');
    fireEvent.click(within(form).getByRole('button', { name: /подсказка 1,50 \(по 3 закрытым позициям\)/ }));
    expect(ad.value).toBe('1,5');
    set(ad, '1,7');
    expect(ad.value).toBe('1,7');
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить позицию' }));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln1')?.coef).toBe(1.7));
  });

  it('мало данных', async () => {
    renderAt('/orders/o12', withHistory([1.4, 1.6]));
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 1' }));
    expect(within(screen.getByRole('form', { name: 'Позиция' })).getByText('мало данных для подсказки')).toBeTruthy();
  });
});

describe('AV / AW и отклонение', () => {
  it('закрытый заказ: AW и отклонение от AD с цветом (хуже / лучше прогноза)', async () => {
    const hist = closedHistory([1.5, 1.65, 1.35]);
    const { unmount } = renderAt('/orders/h1', merge(baseSeed, hist));
    await screen.findByText('Позиция истории 1');
    expect(screen.queryByText('предварительно')).toBeNull();
    expect(cell(screen.getByTestId('line-hl1'), 'AW')).toBe('1,65');
    const dev = screen.getByTestId('dev-hl1');
    expect(dev.textContent).toBe('+10,0 %');
    expect(dev.className).toContain('dev--worse');
    unmount();
    renderAt('/orders/h2', merge(baseSeed, hist));
    await screen.findByText('Позиция истории 2');
    const better = screen.getByTestId('dev-hl2');
    expect(better.textContent).toBe('−10,0 %');
    expect(better.className).toContain('dev--better');
  });

  it('незакрытый заказ: AW серый с подписью «предварительно»', async () => {
    const hist = closedHistory([1.65]);
    hist.orders![0] = { ...hist.orders![0], costsComplete: false };
    renderAt('/orders/h0', merge(baseSeed, hist));
    await screen.findByText('Позиция истории 0');
    const aw = screen.getByTestId('line-hl0').querySelector('[data-col="AW"]') as HTMLElement;
    expect(aw.className).toContain('is-provisional');
    expect(within(aw).getByText('предварительно')).toBeTruthy();
  });
});

describe('удаление', () => {
  const seed: Partial<Dataset> = {
    ...baseSeed,
    shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container', vatRate: 22 }],
    batches: [{ id: 'b1', shipmentId: 'sh1', lineId: 'ln1', qty: 600 }],
    costs: [{ id: 'c1', entryDate: '2026-10-02', status: 'fact', targetType: 'supplierOrder', targetId: 'so1', costType: 'Аванс', currency: 'CNY', rateManual: false, amount: 100 }],
  };

  it('позиция с партиями — запрет с перечислением поставок', async () => {
    const { store } = renderAt('/orders/o12', seed);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 1' }));
    fireEvent.click(within(screen.getByRole('form', { name: 'Позиция' })).getByRole('button', { name: 'Удалить позицию' }));
    expect(await screen.findByText(/Нельзя удалить позицию.*партии в поставках К-7/)).toBeTruthy();
    expect((await store.load()).lines).toHaveLength(2);
  });

  it('позиция без партий и затрат удаляется после подтверждения', async () => {
    const { store } = renderAt('/orders/o12', seed);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 2' }));
    fireEvent.click(within(screen.getByRole('form', { name: 'Позиция' })).getByRole('button', { name: 'Удалить позицию' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).lines.map((l) => l.id)).toEqual(['ln1']));
  });

  it('поставщик с партиями и затратами — запрет с перечислением', async () => {
    const { store } = renderAt('/orders/o12', seed);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    fireEvent.click(within(block('12-1')).getByRole('button', { name: 'Реквизиты поставщика' }));
    fireEvent.click(within(block('12-1')).getByRole('button', { name: 'Удалить поставщика' }));
    const msg = await screen.findByText(/Нельзя удалить поставщика из заказа/);
    expect(msg.textContent).toContain('К-7');
    expect(msg.textContent).toContain('Аванс');
    expect((await store.load()).supplierOrders).toHaveLength(1);
  });
});

describe('лента платежей', () => {
  it('затраты заказа, поставщика и позиции по датам; план отдельно от факта', async () => {
    const seed: Partial<Dataset> = {
      ...baseSeed,
      costs: [
        { id: 'c1', entryDate: '2026-10-05', paymentDate: '2026-10-06', status: 'fact', targetType: 'supplierOrder', targetId: 'so1', costType: 'Итоговый расчёт', currency: 'CNY', rateManual: false, amount: 100, rate: 10, rateDate: '2026-10-06', amountRub: 1000 },
        { id: 'c2', entryDate: '2026-10-01', paymentDate: '2026-10-02', status: 'fact', targetType: 'order', targetId: 'o12', costType: 'Аванс', currency: 'CNY', rateManual: false, amount: 50, rate: 10, rateDate: '2026-10-02', amountRub: 500 },
        { id: 'c3', entryDate: '2026-10-10', status: 'plan', targetType: 'line', targetId: 'ln1', costType: 'Прочее', currency: 'CNY', rateManual: false, amount: 10 },
        { id: 'c4', entryDate: '2026-10-03', paymentDate: '2026-10-03', status: 'fact', targetType: 'order', targetId: 'o6', costType: 'Чужая', currency: 'CNY', rateManual: false, amount: 1 },
      ],
    };
    renderAt('/orders/o12', seed);
    const fact = await screen.findByRole('table', { name: 'Факт' });
    const rows = within(fact).getAllByRole('row').slice(1).map((r) => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Аванс');
    expect(rows[1]).toContain('Итоговый расчёт');
    const plan = screen.getByRole('table', { name: 'План' });
    expect(within(plan).getByText('Прочее')).toBeTruthy();
    expect(screen.queryByText('Чужая')).toBeNull();
  });

  it('в ленте есть «Добавить затрату» с привязкой к заказу и «Все затраты» с фильтром по заказу', async () => {
    renderAt('/orders/o12', baseSeed);
    const feed = await screen.findByRole('region', { name: 'Лента платежей' });
    expect(within(feed).getByRole('link', { name: 'Добавить затрату' }).getAttribute('href')).toBe('/costs?add=order:o12');
    expect(within(feed).getByRole('link', { name: 'Все затраты' }).getAttribute('href')).toBe('/costs?order=o12');
  });
});

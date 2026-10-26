// Блок поставщика в заказе (G02–G08): товары сразу под заголовком, расчёт по каждой позиции, AD поставщика,
// строка быстрого ввода, вставка из Excel, итоги = суммы строк, 100 позиций.
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Dataset, Line } from '../../../src/domain/model';
import { baseSeed, gatedStore, renderAt, renderWithStore } from './helpers';

const flat = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]/g, '');
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const block = (code: string) => screen.getByRole('region', { name: `Поставщик в заказе ${code}` });
const cell = (row: HTMLElement, col: string) => flat(row.querySelector(`[data-col="${col}"]`)?.textContent);
const num = (s: string) => Number(s.replace('−', '-').replace(',', '.'));
const AD_FIELD = /^Расчётный коэффициент себестоимости доставки \(для всех товаров поставщика\)/;
/** Ячейка «Расч. коэфф.» строки — поле ввода: своё значение в value, иначе коэффициент поставщика в placeholder. */
const adInput = (row: HTMLElement) => row.querySelector('[data-col="AD"] input') as HTMLInputElement;
const adShown = (row: HTMLElement) => adInput(row).value || adInput(row).placeholder;
const termOf = (scope: HTMLElement, label: string) => flat(within(scope).getByText(label).nextElementSibling?.textContent);

/**
 * Заказ 12, дата расчёта 01.10 (CNY = 10).
 * 12-1 (CNY, AD поставщика 1,4): ln1 1000 × 5, своё AD 1,5; ln3 10 × 20 без своего AD; ln2 — альтернатива.
 *   Факт «Итоговый расчёт» 5200 CNY по курсу 10 = 52 000 ₽ на поставщика → делится по сумме в валюте: ln1 50 000, ln3 2 000.
 * 12-2 (USD, ручной курс 90, AD 1,2): ln4 2 × 100.
 */
const adSeed = (): Partial<Dataset> => ({
  ...baseSeed,
  supplierOrders: [
    { ...baseSeed.supplierOrders![0], coef: 1.4, paymentTerms: '30/70' },
    { id: 'so2', orderId: 'o12', seq: 2, supplierId: 's2', currency: 'USD', calcRate: 90, coef: 1.2 },
  ],
  lines: [
    ...baseSeed.lines!,
    { id: 'ln3', orderId: 'o12', supplierOrderId: 'so1', seq: 3, customerName: 'Задвижка', qty: 10, unitPrice: 20, purchased: true },
    { id: 'ln4', orderId: 'o12', supplierOrderId: 'so2', seq: 1, customerName: 'Кабель', qty: 2, unitPrice: 100, purchased: true },
  ],
  costs: [
    { id: 'c1', entryDate: '2026-10-02', paymentDate: '2026-10-02', status: 'fact', targetType: 'supplierOrder', targetId: 'so1', costType: 'Итоговый расчёт', amount: 5200, currency: 'CNY', rate: 10, rateDate: '2026-10-02', amountRub: 52000, rateManual: false },
  ],
});

describe('блок поставщика: заголовок и таблица товаров', () => {
  it('заголовок: код, поставщик, валюта, курс с датой, AD поставщика; таблица сразу под ним; реквизиты свёрнуты', async () => {
    renderAt('/orders/o12', adSeed());
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const head = within(b).getByRole('heading', { level: 2 });
    expect(head.textContent).toContain('12-1');
    expect(head.textContent).toContain('Alpha Valve');
    expect(within(b).getByText(/юань \(RMB\)/)).toBeTruthy();
    expect(within(b).getByText(/10,00 на 01\.10\.2026/)).toBeTruthy();
    expect((within(b).getByLabelText(AD_FIELD) as HTMLInputElement).value).toBe('1,4');
    expect(within(b).getByRole('table', { name: 'Товары 12-1' })).toBeTruthy();
    expect(within(b).getByText('Кран DN50')).toBeTruthy();
    // реквизиты свёрнуты
    expect(within(b).queryByLabelText(/^Условия оплаты/)).toBeNull();
    const toggle = within(b).getByRole('button', { name: 'Реквизиты поставщика' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect((within(b).getByLabelText(/^Условия оплаты/) as HTMLSelectElement).value).toBe('30/70');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('колонки по порядку: В работу, №, товар, кол-во, цена, сумма в валюте, ₽/шт, сумма ₽, AD, AB, прогноз на кол-во, AV, себестоимость на кол-во, AW, отклонение', async () => {
    renderAt('/orders/o12', adSeed());
    const table = await screen.findByRole('table', { name: 'Товары 12-1' });
    const heads = within(table).getAllByRole('columnheader').map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
    expect(heads.slice(0, 15)).toEqual([
      'В работу', '№', 'Товар', 'Кол-во', 'Цена, CNY', 'Сумма, CNY', 'Цена ₽/шт', 'Сумма ₽', 'Расч. коэфф.',
      'Прогноз ₽/шт', 'Прогноз ₽ на кол-во', 'Себест. ₽/шт', 'Себест. ₽ на кол-во', 'Факт. коэфф.', 'Откл.',
    ]);
  });

  it('расчёт по каждой позиции: AB, прогноз на кол-во, AV, себестоимость на кол-во, AW, отклонение — по действующему AD', async () => {
    renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const r1 = screen.getByTestId('line-ln1');
    expect([cell(r1, 'qty'), cell(r1, 'price'), cell(r1, 'X'), cell(r1, 'Y'), cell(r1, 'Z')]).toEqual(['1000', '5,00', '5000,00', '50,00', '50000,00']);
    expect([adShown(r1), cell(r1, 'AB'), cell(r1, 'ABqty')]).toEqual(['1,5', '75,00', '75000,00']);
    expect([cell(r1, 'AV'), cell(r1, 'AVqty')]).toEqual(['50,00', '50000,00']);
    expect(cell(r1, 'AW')).toMatch(/^1,00/);
    expect(cell(r1, 'dev')).toBe('−33,3%');
    // ln3 без своего AD — берёт AD поставщика 1,4
    const r3 = screen.getByTestId('line-ln3');
    expect([adShown(r3), cell(r3, 'AB'), cell(r3, 'ABqty')]).toEqual(['1,4', '280,00', '2800,00']);
    expect([cell(r3, 'AV'), cell(r3, 'AVqty')]).toEqual(['200,00', '2000,00']);
    expect(cell(r3, 'dev')).toBe('−28,6%');
    // своё AD выделено, AD поставщика — нет
    expect(adInput(r1).classList.contains('ad-own')).toBe(true);
    expect(adInput(r1).value).toBe('1,5');
    expect(adInput(r3).classList.contains('ad-own')).toBe(false);
    expect(adInput(r3).value).toBe('');           // пусто — коэффициент поставщика показан приглушённо подсказкой
    expect(adInput(r3).placeholder).toBe('1,4');
  });
});

describe('расчётный коэффициент поставщика', () => {
  it('сохраняется сразу; позиции без своего AD пересчитываются, со своим — нет', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    set(within(block('12-1')).getByLabelText(AD_FIELD), '2');
    await waitFor(() => expect(cell(screen.getByTestId('line-ln3'), 'AB')).toBe('400,00'));
    expect(cell(screen.getByTestId('line-ln1'), 'AB')).toBe('75,00');
    await waitFor(async () => expect((await store.load()).supplierOrders.find((s) => s.id === 'so1')?.coef).toBe(2));
  });

  it('неверный AD — ошибка у поля, не сохраняется', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const ad = within(block('12-1')).getByLabelText(AD_FIELD);
    set(ad, '0');
    expect(await within(block('12-1')).findByText('Расчётный коэффициент должен быть больше нуля')).toBeTruthy();
    set(ad, 'abc');
    expect(within(block('12-1')).getByText('Введите число')).toBeTruthy();
    expect((await store.load()).supplierOrders.find((s) => s.id === 'so1')?.coef).toBe(1.4);
  });

  it('подсказка AD по истории в заголовке; клик подставляет и сохраняет', async () => {
    const seed = adSeed();
    seed.supplierOrders = [{ ...seed.supplierOrders![0], coef: undefined }, seed.supplierOrders![1]];
    for (let i = 0; i < 3; i++) {
      seed.orders!.push({ id: `h${i}`, number: 100 + i, date: '2026-01-01', costsComplete: true });
      seed.supplierOrders.push({ id: `hs${i}`, orderId: `h${i}`, seq: 1, supplierId: 's1', currency: 'RUB', plannedMode: 'sea_container' });
      seed.lines!.push({ id: `hl${i}`, orderId: `h${i}`, supplierOrderId: `hs${i}`, seq: 1, qty: 10, unitPrice: 100, purchased: true, coef: 1.5 });
      seed.costs!.push({ id: `hc${i}`, entryDate: '2026-01-01', status: 'fact', targetType: 'line', targetId: `hl${i}`, costType: 'Прочее', amount: [1.4, 1.6, 1.5][i] * 1000, currency: 'RUB', rateManual: false });
    }
    const { store } = renderAt('/orders/o12', seed);
    await screen.findByText('Задвижка');
    fireEvent.click(within(block('12-1')).getByRole('button', { name: /подсказка 1,50 \(по 3 закрытым позициям\)/ }));
    await waitFor(async () => expect((await store.load()).supplierOrders.find((s) => s.id === 'so1')?.coef).toBe(1.5));
    expect((within(block('12-1')).getByLabelText(AD_FIELD) as HTMLInputElement).value).toBe('1,5');
  });

  it('«как у поставщика» снимает своё AD позиции', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    fireEvent.click(within(screen.getByTestId('line-ln1')).getByRole('button', { name: 'Расчётный коэффициент позиции 1: как у поставщика' }));
    await waitFor(() => expect(cell(screen.getByTestId('line-ln1'), 'AB')).toBe('70,00'));
    const ln1 = (await store.load()).lines.find((l) => l.id === 'ln1');
    expect(ln1?.coef).toBeUndefined();
    expect(ln1?.customerName).toBe('Кран DN50');
    expect(screen.getByTestId('line-ln1').querySelector('.ad-own')).toBeNull();
    expect(adInput(screen.getByTestId('line-ln1')).value).toBe('');
  });
});

describe('итоги поставщика и заказа = суммы строк', () => {
  it('сумма в валюте, сумма ₽, прогноз, себестоимость — без альтернатив; итоги заказа — по всем поставщикам', async () => {
    renderAt('/orders/o12', adSeed());
    await screen.findByText('Кабель');
    const b1 = block('12-1');
    // по строкам: X 5000 + 200; Z 50 000 + 2 000; прогноз 75 000 + 2 800; себестоимость 50 000 + 2 000
    expect(termOf(b1, 'Итого в валюте')).toBe('5200,00CNY');
    expect(termOf(b1, 'Итого ₽')).toBe('52000,00₽');
    expect(termOf(b1, 'Итого прогноз ₽')).toBe('77800,00₽');
    expect(termOf(b1, 'Итого себестоимость ₽')).toBe('52000,00₽');
    const b2 = block('12-2');
    expect(termOf(b2, 'Итого ₽')).toBe('18000,00₽');
    expect(termOf(b2, 'Итого прогноз ₽')).toBe('21600,00₽');
    // сверка с суммой ячеек строк «В работу»
    const rows = [...document.querySelectorAll<HTMLElement>('tr[data-testid^="line-"]')].filter((r) => !r.classList.contains('is-alt-row'));
    const sum = (col: string) => rows.reduce((s, r) => s + (cell(r, col) === '—' ? 0 : num(cell(r, col))), 0);
    expect(sum('Z')).toBeCloseTo(70000, 6);
    expect(sum('ABqty')).toBeCloseTo(99400, 6);
    expect(sum('AVqty')).toBeCloseTo(52000, 6);
    const totals = screen.getByRole('region', { name: 'Итоги заказа' });
    expect(termOf(totals, 'Сумма заказа')).toBe('5200,00CNY200,00USD');
    expect(termOf(totals, 'В рублях по курсу расчёта')).toBe('70000,00₽');
    expect(termOf(totals, 'Прогноз суммы в РФ')).toBe('99400,00₽');
    expect(termOf(totals, 'Себестоимость позиций')).toBe('52000,00₽');
  });
});

describe('строка быстрого ввода', () => {
  it('Enter сохраняет позицию не в работе (запрос цены) и ставит фокус в товар новой пустой строки', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const name = within(b).getByLabelText('Товар новой позиции') as HTMLInputElement;
    const qty = within(b).getByLabelText('Кол-во новой позиции') as HTMLInputElement;
    const price = within(b).getByLabelText('Цена новой позиции') as HTMLInputElement;
    set(name, 'Фланец');
    set(qty, '1 200');
    set(price, '3,5');
    fireEvent.keyDown(price, { key: 'Enter' });
    await waitFor(async () => expect((await store.load()).lines).toHaveLength(5));
    const saved = (await store.load()).lines.find((l) => l.customerName === 'Фланец');
    expect(saved).toMatchObject({ orderId: 'o12', supplierOrderId: 'so1', seq: 4, qty: 1200, unitPrice: 3.5, purchased: false });
    const row = (await within(b).findByText('Фланец')).closest('tr') as HTMLElement;
    expect(cell(row, 'Z')).toBe('42000,00');
    expect(cell(row, 'AB')).toBe('49,00');   // 35 ₽ × AD поставщика 1,4
    await waitFor(() => expect(document.activeElement).toBe(within(b).getByLabelText('Товар новой позиции')));
    expect((within(b).getByLabelText('Товар новой позиции') as HTMLInputElement).value).toBe('');
    expect((within(b).getByLabelText('Кол-во новой позиции') as HTMLInputElement).value).toBe('');
    expect((within(b).getByLabelText('Цена новой позиции') as HTMLInputElement).value).toBe('');
  });

  it('неверный ввод — ошибки у полей, ничего не сохраняется, введённое остаётся', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const qty = within(b).getByLabelText('Кол-во новой позиции') as HTMLInputElement;
    const price = within(b).getByLabelText('Цена новой позиции') as HTMLInputElement;
    set(qty, '0');
    set(price, 'abc');
    fireEvent.keyDown(qty, { key: 'Enter' });
    expect(await within(b).findByText('Введите товар')).toBeTruthy();
    expect(within(b).getByText('Количество должно быть больше нуля')).toBeTruthy();
    expect(within(b).getByText('Введите число')).toBeTruthy();
    expect(qty.value).toBe('0');
    expect(price.value).toBe('abc');
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    expect((await store.load()).lines).toHaveLength(4);
  });
});

describe('«Подробнее» — полная форма позиции', () => {
  it('открывает все поля позиции; «как у поставщика» в форме очищает своё AD', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    fireEvent.click(within(block('12-1')).getByRole('button', { name: 'Подробнее о позиции 1' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    for (const label of [/^Название от заказчика/, /^Тех\. параметры/, /^Название в документах/, /^Название у поставщика/, /^Кол-во/, /^Цена в валюте/, /^HS-код/, /^Пошлина/, /^Упаковка/, /^Размер упаковки/, /^CBM/, /^Вес/, /^Мест/, /^Расчётный коэффициент себестоимости доставки/, /^Комментарий/]) {
      expect(within(form).getByLabelText(label)).toBeTruthy();
    }
    expect(within(form).getByLabelText('В работу')).toBeTruthy();
    expect(within(form).queryByLabelText('Закупка')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'как у поставщика' }));
    expect((within(form).getByLabelText(/^Расчётный коэффициент себестоимости доставки/) as HTMLInputElement).value).toBe('');
    fireEvent.click(within(form).getByRole('button', { name: 'Сохранить позицию' }));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln1')?.coef).toBeUndefined());
  });
});

describe('вставка из Excel', () => {
  it('предпросмотр со статусом каждой строки; «Добавить N позиций» добавляет только корректные', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    fireEvent.click(within(b).getByRole('button', { name: 'Вставить из Excel' }));
    const panel = within(b).getByRole('region', { name: 'Вставка из Excel' });
    set(within(panel).getByLabelText(/^Строки из Excel/), 'Товар\tКол-во\tЦена\nОтвод 90°\t1 234\t2,5\t7307\t0,4\t120\nТройник\t0\t1\nЗаглушка\t10\t1234.5\n');
    const preview = within(panel).getByRole('table', { name: 'Предпросмотр вставки' });
    const rows = within(preview).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('заголовок — пропущена');
    expect(rows[1].textContent).toContain('ок');
    expect(rows[2].textContent).toContain('кол-во должно быть больше нуля');
    expect(rows[3].textContent).toContain('ок');
    fireEvent.click(within(panel).getByRole('button', { name: 'Добавить 2 позиции' }));
    await waitFor(async () => expect((await store.load()).lines).toHaveLength(6));
    const lines = (await store.load()).lines;
    expect(lines.find((l) => l.customerName === 'Отвод 90°')).toMatchObject({ supplierOrderId: 'so1', seq: 4, qty: 1234, unitPrice: 2.5, hsCode: '7307', cbm: 0.4, weight: 120, purchased: false });
    expect(lines.find((l) => l.customerName === 'Заглушка')).toMatchObject({ seq: 5, qty: 10, unitPrice: 1234.5, purchased: false });
    expect(lines.some((l) => l.customerName === 'Тройник')).toBe(false);
    await waitFor(() => expect(within(b).queryByRole('region', { name: 'Вставка из Excel' })).toBeNull());
    expect(within(b).getByText('Заглушка')).toBeTruthy();
  });

  it('нет корректных строк — кнопка добавления недоступна', async () => {
    renderAt('/orders/o12', adSeed());
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    fireEvent.click(within(b).getByRole('button', { name: 'Вставить из Excel' }));
    const panel = within(b).getByRole('region', { name: 'Вставка из Excel' });
    set(within(panel).getByLabelText(/^Строки из Excel/), 'Тройник\t0\t1');
    expect((within(panel).getByRole('button', { name: 'Добавить 0 позиций' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('100 позиций у поставщика', () => {
  it('таблица отрисовывает 100 строк; 101-я добавляется строкой ввода', async () => {
    const lines: Line[] = Array.from({ length: 100 }, (_, i) => ({
      id: `big${i + 1}`, orderId: 'o12', supplierOrderId: 'so1', seq: i + 1, customerName: `Товар ${i + 1}`, qty: 10, unitPrice: 1 + i, purchased: true,
    }));
    const { store } = renderAt('/orders/o12', { ...adSeed(), lines, costs: [] });
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    expect(within(b).getAllByTestId(/^line-/)).toHaveLength(100);
    set(within(b).getByLabelText('Товар новой позиции'), 'Товар 101');
    set(within(b).getByLabelText('Кол-во новой позиции'), '1');
    set(within(b).getByLabelText('Цена новой позиции'), '7');
    fireEvent.keyDown(within(b).getByLabelText('Товар новой позиции'), { key: 'Enter' });
    await waitFor(() => expect(within(b).getAllByTestId(/^line-/)).toHaveLength(101));
    expect((await store.load()).lines.find((l) => l.customerName === 'Товар 101')).toMatchObject({ seq: 101, qty: 1, unitPrice: 7, purchased: false });
    // сумма в валюте поставщика: 10 × (1 + … + 100); 101-я — запрос цены, не в работе
    expect(termOf(b, 'Итого в валюте')).toBe('50500,00CNY');
  }, 20000);
});

describe('медленная запись (как в Sheets)', () => {
  it('быстрый ввод: набранное во время записи не стирается, сохранённые поля очищаются', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    const b = await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const name = () => within(b).getByLabelText('Товар новой позиции') as HTMLInputElement;
    const qty = () => within(b).getByLabelText('Кол-во новой позиции') as HTMLInputElement;
    const price = () => within(b).getByLabelText('Цена новой позиции') as HTMLInputElement;
    set(name(), 'Фланец');
    set(qty(), '2');
    set(price(), '3');
    fireEvent.keyDown(price(), { key: 'Enter' });
    await waitFor(() => expect(store.pending).toBe(1));
    set(name(), 'Следующий товар');          // пока запись идёт, пользователь уже вводит следующий
    store.release();
    await within(b).findByText('Фланец');
    expect((await store.load()).lines.find((l) => l.customerName === 'Фланец')).toMatchObject({ qty: 2, unitPrice: 3 });
    expect(name().value).toBe('Следующий товар');
    expect(qty().value).toBe('');
    expect(price().value).toBe('');
  });

  it('AD поставщика: ответ на промежуточную запись не откатывает текст поля; записан итоговый AD 1,58', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    await screen.findByText('Задвижка');
    const ad = () => within(block('12-1')).getByLabelText(AD_FIELD) as HTMLInputElement;
    set(ad(), '1');
    await waitFor(() => expect(store.pending).toBe(1));   // идёт запись промежуточного AD = 1
    set(ad(), '1,');
    set(ad(), '1,5');
    store.release();                              // промежуточная запись завершилась посреди ввода
    await waitFor(async () => expect((await store.load()).supplierOrders.find((s) => s.id === 'so1')?.coef).toBe(1));
    await waitFor(() => expect(store.pending).toBe(1));   // следом идёт запись 1,5
    expect(ad().value).toBe('1,5');
    set(ad(), '1,58');
    store.gated = false;
    store.release();
    await waitFor(async () => expect((await store.load()).supplierOrders.find((s) => s.id === 'so1')?.coef).toBe(1.58));
    await waitFor(() => expect(cell(screen.getByTestId('line-ln3'), 'AB')).toBe('316,00'));   // 200 ₽ × 1,58
    expect(ad().value).toBe('1,58');
  });
});

describe('флажок «В работу» в строке таблицы товаров', () => {
  const box = (label: string) => screen.getByRole('checkbox', { name: `В работу: позиция ${label}` }) as HTMLInputElement;

  it('флажок в каждой строке, отмечен у позиций «В работу»', async () => {
    renderAt('/orders/o12', adSeed());
    await screen.findByText('Кабель');
    expect([box('12-1-1').checked, box('12-1-2').checked, box('12-1-3').checked, box('12-2-1').checked]).toEqual([true, false, true, true]);
    expect(document.querySelectorAll('tr[data-testid^="line-"] input[type="checkbox"]')).toHaveLength(4);
  });

  it('переключение сохраняется сразу; итоги поставщика и заказа меняются, не дожидаясь записи', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    await screen.findByText('Кабель');
    fireEvent.click(box('12-1-2'));   // ln2: 10 × 3 CNY, курс 10, AD поставщика 1,4 → +30 CNY, +300 ₽, прогноз +420 ₽
    expect(box('12-1-2').checked).toBe(true);
    expect(screen.getByTestId('line-ln2').classList.contains('is-alt-row')).toBe(false);
    await waitFor(() => expect(store.pending).toBe(1));   // запись ещё идёт
    const b1 = block('12-1');
    expect(termOf(b1, 'Итого в валюте')).toBe('5230,00CNY');
    expect(termOf(b1, 'Итого ₽')).toBe('52300,00₽');
    expect(termOf(b1, 'Итого прогноз ₽')).toBe('78220,00₽');
    const totals = screen.getByRole('region', { name: 'Итоги заказа' });
    expect(termOf(totals, 'Сумма заказа')).toBe('5230,00CNY200,00USD');
    expect(termOf(totals, 'В рублях по курсу расчёта')).toBe('70300,00₽');
    expect(termOf(totals, 'Прогноз суммы в РФ')).toBe('99820,00₽');
    store.gated = false;
    store.release();
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')?.purchased).toBe(true));
    expect(box('12-1-2').checked).toBe(true);
    expect(termOf(block('12-1'), 'Итого в валюте')).toBe('5230,00CNY');
    // снять обратно
    fireEvent.click(box('12-1-2'));
    expect(termOf(block('12-1'), 'Итого в валюте')).toBe('5200,00CNY');
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')?.purchased).toBe(false));
  });

  it('медленная запись: быстрые клики не теряются и не откатываются ответами на промежуточные записи', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    await screen.findByText('Кабель');
    fireEvent.click(box('12-1-2'));          // вкл
    await waitFor(() => expect(store.pending).toBe(1));
    fireEvent.click(box('12-1-1'));          // выкл
    fireEvent.click(box('12-1-2'));          // выкл
    fireEvent.click(box('12-1-2'));          // снова вкл
    fireEvent.click(box('12-2-1'));          // выкл
    fireEvent.click(box('12-2-1'));          // и сразу вкл
    const marks = () => ['12-1-1', '12-1-2', '12-1-3', '12-2-1'].map((c) => box(c).checked);
    expect(marks()).toEqual([false, true, true, true]);
    store.release();                          // первая запись завершилась посреди кликов
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')?.purchased).toBe(true));
    expect(marks()).toEqual([false, true, true, true]);
    store.gated = false;
    store.release();
    await waitFor(async () => {
      const ls = (await store.load()).lines;
      expect(ls.filter((l) => l.purchased).map((l) => l.id).sort()).toEqual(['ln2', 'ln3', 'ln4']);
    });
    await waitFor(() => expect(store.pending).toBe(0));
    expect(marks()).toEqual([false, true, true, true]);
    // 12-1 по строкам ln2 + ln3: 30 + 200 CNY
    expect(termOf(block('12-1'), 'Итого в валюте')).toBe('230,00CNY');
  });

  it('отметка в таблице поставщика видна в «Сравнении цен» и наоборот', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Кабель');
    fireEvent.click(box('12-1-2'));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')?.purchased).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Сравнение цен' }));
    expect(box('12-1-2').checked).toBe(true);
    fireEvent.click(box('12-1-2'));
    fireEvent.click(screen.getByRole('tab', { name: 'Поставщики и товары' }));
    expect(box('12-1-2').checked).toBe(false);
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')?.purchased).toBe(false));
  });
});

describe('таблица товаров на ноутбуке (≈1024 px)', () => {
  // На 769–1279 px скрываются колонки с классом lines-col--minor (orders.css). Цена ₽/шт, прогноз ₽/шт и себестоимость ₽/шт —
  // главное для пользователя, они не скрываются; вместо них скрываются суммы «на кол-во».
  it('колонки ₽/шт (Y, AB, AV) не скрываются; скрываются суммы «на кол-во» (Z, AB на кол-во, AV на кол-во)', async () => {
    renderAt('/orders/o12', adSeed());
    const table = await screen.findByRole('table', { name: 'Товары 12-1' });
    const head = (title: string) => within(table).getAllByRole('columnheader').find((th) => (th.textContent ?? '').trim() === title) as HTMLElement;
    for (const title of ['Цена ₽/шт', 'Прогноз ₽/шт', 'Себест. ₽/шт']) expect(head(title).classList.contains('lines-col--minor')).toBe(false);
    for (const title of ['Сумма ₽', 'Прогноз ₽ на кол-во', 'Себест. ₽ на кол-во']) expect(head(title).classList.contains('lines-col--minor')).toBe(true);
    const r1 = screen.getByTestId('line-ln1');
    for (const col of ['Y', 'AB', 'AV']) expect(r1.querySelector(`[data-col="${col}"]`)?.closest('td')?.classList.contains('lines-col--minor')).toBe(false);
    for (const col of ['Z', 'ABqty', 'AVqty']) expect(r1.querySelector(`[data-col="${col}"]`)?.closest('td')?.classList.contains('lines-col--minor')).toBe(true);
    // строка ввода: число ячеек совпадает с шапкой, скрываемые — те же колонки
    const heads = within(table).getAllByRole('columnheader');
    const entry = table.querySelector('tfoot tr') as HTMLTableRowElement;
    const cells = [...entry.cells].flatMap((td) => Array.from({ length: td.colSpan }, () => td));
    expect(cells).toHaveLength(heads.length);
    heads.forEach((th, i) => {
      if (th.classList.contains('lines-col--minor')) expect(cells[i].classList.contains('lines-col--minor')).toBe(true);
      else expect(cells[i].classList.contains('lines-col--minor')).toBe(false);
    });
  });
});

describe('названия коэффициентов (G22)', () => {
  it('шапка таблицы: «Расч. коэфф.» / «Факт. коэфф.», полное название — в подсказке; буквы AD и AW — только в скобках', async () => {
    renderAt('/orders/o12', adSeed());
    const table = await screen.findByRole('table', { name: 'Товары 12-1' });
    const heads = within(table).getAllByRole('columnheader');
    const ad = heads.find((th) => th.textContent === 'Расч. коэфф.') as HTMLElement;
    const aw = heads.find((th) => th.textContent === 'Факт. коэфф.') as HTMLElement;
    expect(ad.title).toMatch(/^Расчётный коэффициент себестоимости доставки \(AD\)/);
    expect(aw.title).toMatch(/^Фактический коэффициент себестоимости доставки \(AW\)/);
    expect(heads.some((th) => th.textContent === 'AD' || th.textContent === 'AW')).toBe(false);
  });

  it('поле поставщика называется полным именем, прежней подписи «AD поставщика» нет', async () => {
    renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const b = block('12-1');
    expect(within(b).getByLabelText('Расчётный коэффициент себестоимости доставки (для всех товаров поставщика)')).toBeTruthy();
    expect(within(b).queryByLabelText(/^AD поставщика/)).toBeNull();
  });

  it('форма позиции: поле называется «Расчётный коэффициент себестоимости доставки», в подсказке — коэффициент поставщика', async () => {
    renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    fireEvent.click(within(block('12-1')).getByRole('button', { name: 'Подробнее о позиции 3' }));
    const form = screen.getByRole('form', { name: 'Позиция' });
    expect(within(form).getByLabelText(/^Расчётный коэффициент себестоимости доставки/)).toBeTruthy();
    expect(within(form).getByText(/пусто — как у поставщика \(1,4\)/)).toBeTruthy();
  });
});

describe('расчётный коэффициент прямо в таблице (G23)', () => {
  const lineCoef = async (store: { load: () => Promise<Dataset> }, id: string) => (await store.load()).lines.find((l) => l.id === id)?.coef;

  it('Enter сохраняет своё значение позиции и пересчитывает прогноз; значение выделено', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const row = () => screen.getByTestId('line-ln3');
    expect(adInput(row()).value).toBe('');
    set(adInput(row()), '2,5');
    expect(await lineCoef(store, 'ln3')).toBeUndefined();          // пока не нажат Enter — не сохранено
    fireEvent.keyDown(adInput(row()), { key: 'Enter' });
    await waitFor(async () => expect(await lineCoef(store, 'ln3')).toBe(2.5));
    await waitFor(() => expect(cell(row(), 'AB')).toBe('500,00'));   // 200 ₽ × 2,5
    expect(adInput(row()).value).toBe('2,5');
    expect(adInput(row()).classList.contains('ad-own')).toBe(true);
    // итоги поставщика пересчитаны: ln1 75 000 + ln3 10 × 500
    expect(termOf(block('12-1'), 'Итого прогноз ₽')).toBe('80000,00₽');
  });

  it('уход с поля тоже сохраняет; значение, равное сохранённому, повторно не пишется', async () => {
    const store = gatedStore(adSeed());
    store.gated = false;
    renderWithStore('/orders/o12', store);
    await screen.findByText('Задвижка');
    const input = () => adInput(screen.getByTestId('line-ln3'));
    set(input(), '1,9');
    fireEvent.blur(input());
    await waitFor(async () => expect(await lineCoef(store, 'ln3')).toBe(1.9));
    store.gated = true;
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.blur(input());
    expect(store.pending).toBe(0);
  });

  it('неверное значение — ошибка в ячейке, не сохраняется; ноль и отрицательное тоже', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const row = () => screen.getByTestId('line-ln3');
    set(adInput(row()), 'abc');
    fireEvent.keyDown(adInput(row()), { key: 'Enter' });
    expect(within(row()).getByText('Введите число')).toBeTruthy();
    expect(adInput(row()).getAttribute('aria-invalid')).toBe('true');
    set(adInput(row()), '0');
    fireEvent.keyDown(adInput(row()), { key: 'Enter' });
    expect(within(row()).getByText('Больше нуля')).toBeTruthy();
    set(adInput(row()), '-1');
    fireEvent.blur(adInput(row()));
    expect(within(row()).getByText('Больше нуля')).toBeTruthy();
    expect(adInput(row()).value).toBe('-1');
    expect(await lineCoef(store, 'ln3')).toBeUndefined();
    set(adInput(row()), '1,8');
    fireEvent.keyDown(adInput(row()), { key: 'Enter' });
    await waitFor(async () => expect(await lineCoef(store, 'ln3')).toBe(1.8));
    expect(within(row()).queryByText('Больше нуля')).toBeNull();
  });

  it('пустое значение снимает своё: позиция снова берёт коэффициент поставщика', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    const row = () => screen.getByTestId('line-ln1');
    expect(adInput(row()).value).toBe('1,5');
    set(adInput(row()), '');
    fireEvent.keyDown(adInput(row()), { key: 'Enter' });
    await waitFor(async () => expect(await lineCoef(store, 'ln1')).toBeUndefined());
    await waitFor(() => expect(cell(row(), 'AB')).toBe('70,00'));      // 50 ₽ × 1,4
    expect(adInput(row()).placeholder).toBe('1,4');
    expect(adInput(row()).classList.contains('ad-own')).toBe(false);
    expect((await store.load()).lines.find((l) => l.id === 'ln1')?.customerName).toBe('Кран DN50');
  });

  it('кнопка «×» возвращает «как у поставщика»; у позиции без своего значения её нет', async () => {
    const { store } = renderAt('/orders/o12', adSeed());
    await screen.findByText('Задвижка');
    expect(within(screen.getByTestId('line-ln3')).queryByRole('button', { name: /как у поставщика/ })).toBeNull();
    fireEvent.click(within(screen.getByTestId('line-ln1')).getByRole('button', { name: 'Расчётный коэффициент позиции 1: как у поставщика' }));
    await waitFor(async () => expect(await lineCoef(store, 'ln1')).toBeUndefined());
    expect(adInput(screen.getByTestId('line-ln1')).value).toBe('');
  });

  it('медленная запись: текст в ячейке не откатывается, записывается последнее подтверждённое значение', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    await screen.findByText('Задвижка');
    const input = () => adInput(screen.getByTestId('line-ln3'));
    set(input(), '2');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(store.pending).toBe(1));
    set(input(), '2,2');
    fireEvent.keyDown(input(), { key: 'Enter' });
    store.release();                                   // запись «2» завершилась
    await waitFor(async () => expect(await lineCoef(store, 'ln3')).toBe(2));
    await waitFor(() => expect(store.pending).toBe(1));
    expect(input().value).toBe('2,2');
    set(input(), '2,25');                               // набирает дальше, ещё не подтвердил
    store.gated = false;
    store.release();
    await waitFor(async () => expect(await lineCoef(store, 'ln3')).toBe(2.2));
    await waitFor(() => expect(cell(screen.getByTestId('line-ln3'), 'AB')).toBe('440,00'));
    expect(input().value).toBe('2,25');
  });

  it('очередь общая с флажком «В работу»: запись коэффициента не стирает отметку и наоборот', async () => {
    const store = gatedStore(adSeed());
    renderWithStore('/orders/o12', store);
    await screen.findByText('Задвижка');
    const input = () => adInput(screen.getByTestId('line-ln2'));
    set(input(), '1,7');
    fireEvent.keyDown(input(), { key: 'Enter' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'В работу: позиция 12-1-2' }));
    store.gated = false;
    store.release();
    await waitFor(async () => {
      const ln2 = (await store.load()).lines.find((l) => l.id === 'ln2');
      expect(ln2).toMatchObject({ coef: 1.7, purchased: true });
    });
  });
});

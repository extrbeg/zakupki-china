// Вкладка «Сравнение цен» карточки заказа (G09–G12, истории 78–80): товары × поставщики, выбор «В работу» кликом,
// итоги по выбранным и по всем; расчёт заказа и движок — только по выбранным; медленная запись не теряет клики.
import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { computeCosting } from '../../../src/domain/costing';
import type { Dataset, Line } from '../../../src/domain/model';
import { baseSeed, gatedStore, renderAt, renderWithStore } from './helpers';

const flat = (s: string | null | undefined) => (s ?? '').replace(/[\s  ]/g, '');
const totalOf = (scope: HTMLElement, label: string) => flat(within(scope).getByText(label).nextElementSibling?.textContent);
const box = (code: string) => screen.getByLabelText(`В работу: позиция ${code}`) as HTMLInputElement;
const offerCol = (code: string, col: string) => flat(box(code).closest('label')?.querySelector(`[data-col="${col}"]`)?.textContent);

/**
 * Пример пользователя: заказ 20, расчёт 01.10 (CNY = 10). Поставщик 1 — товар 1; 2 — товары 1, 2; 3 — товар 1; 4 — товары 1, 2, 3.
 * 20-1 CNY AD 1,5: a1 «Кран DN50» 100 × 10 → Y 100, AB 150
 * 20-2 CNY AD 1,5: b1 «кран dn50 » 100 × 9 → Y 90, AB 135; b2 «Задвижка» 20 × 50 → Y 500, AB 750
 * 20-3 USD курс 90 вручную, AD 1,5: c1 «Кран DN50» 100 × 1,2 → Y 108, AB 162
 * 20-4 CNY AD 1,2: d1 «КРАН DN50» 100 × 9,5 → Y 95, AB 114 (лучший); d2 «Задвижка» 20 × 48 → Y 480, AB 576; d3 «Фланец» 50 × 4 → Y 40, AB 48
 * Все — запросы цены (не в работе).
 */
const exampleSeed = (extra: Line[] = []): Partial<Dataset> => {
  const L = (id: string, so: string, seq: number, customerName: string, qty: number, unitPrice: number): Line =>
    ({ id, orderId: 'o20', supplierOrderId: so, seq, customerName, qty, unitPrice, purchased: false });
  return {
    ...baseSeed,
    suppliers: [{ id: 's1', name: 'Alpha Valve' }, { id: 's2', name: 'Beta Cable' }, { id: 's3', name: 'Gamma Steel' }, { id: 's4', name: 'Delta Pipe' }],
    orders: [{ id: 'o20', number: 20, date: '2026-09-15', title: 'Сравнение', costsComplete: false, calcDate: '2026-10-01' }],
    supplierOrders: [
      { id: 'soA', orderId: 'o20', seq: 1, supplierId: 's1', currency: 'CNY', coef: 1.5 },
      { id: 'soB', orderId: 'o20', seq: 2, supplierId: 's2', currency: 'CNY', coef: 1.5 },
      { id: 'soC', orderId: 'o20', seq: 3, supplierId: 's3', currency: 'USD', calcRate: 90, coef: 1.5 },
      { id: 'soD', orderId: 'o20', seq: 4, supplierId: 's4', currency: 'CNY', coef: 1.2 },
    ],
    lines: [
      L('a1', 'soA', 1, 'Кран DN50', 100, 10),
      L('b1', 'soB', 1, 'кран dn50 ', 100, 9), L('b2', 'soB', 2, 'Задвижка', 20, 50),
      L('c1', 'soC', 1, 'Кран DN50', 100, 1.2),
      L('d1', 'soD', 1, 'КРАН DN50', 100, 9.5), L('d2', 'soD', 2, 'Задвижка', 20, 48), L('d3', 'soD', 3, 'Фланец', 50, 4),
      ...extra,
    ],
    costs: [],
  };
};

const openCompare = async () => {
  fireEvent.click(await screen.findByRole('tab', { name: 'Сравнение цен' }));
  return screen.getByRole('table', { name: 'Сравнение цен' });
};
const column = (table: HTMLElement, code: string) =>
  within(table).getAllByRole('columnheader').find((th) => (th.textContent ?? '').includes(code)) as HTMLElement;

describe('вкладки карточки заказа', () => {
  it('«Поставщики и товары» открыта по умолчанию; «Сравнение цен» показывает матрицу вместо блоков поставщиков', async () => {
    renderAt('/orders/o20', exampleSeed());
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Поставщики и товары', 'Сравнение цен']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region', { name: 'Поставщик в заказе 20-1' })).toBeTruthy();
    await openCompare();
    expect(screen.getByRole('tab', { name: 'Сравнение цен' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Поставщик в заказе 20-1' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Итоги заказа' })).toBeTruthy();
  });
});

describe('матрица «Сравнение цен»', () => {
  it('пример пользователя: 3 товара × 4 поставщика, пустые ячейки там, где предложения нет', async () => {
    renderAt('/orders/o20', exampleSeed());
    const table = await openCompare();
    const heads = within(table).getAllByRole('columnheader');
    expect(heads).toHaveLength(5);
    expect(heads[0].textContent).toBe('Товар');
    ['20-1', '20-2', '20-3', '20-4'].forEach((code, i) => expect(heads[i + 1].textContent).toContain(code));
    expect(heads[4].textContent).toContain('Delta Pipe');
    const body = within(table).getAllByRole('rowgroup')[1];
    const rows = within(body).getAllByRole('row');
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual(['Кран DN50', 'Задвижка', 'Фланец']);
    const filled = rows.map((r) => within(r).getAllByRole('cell').map((c) => within(c).queryAllByRole('checkbox').length));
    expect(filled).toEqual([[1, 1, 1, 1], [0, 1, 0, 1], [0, 0, 0, 1]]);
    for (const r of rows) for (const c of within(r).getAllByRole('cell')) if (within(c).queryAllByRole('checkbox').length === 0) expect(flat(c.textContent)).toBe('');
  });

  it('ячейка: кол-во, цена в валюте, ₽/шт, прогноз ₽/шт по действующему AD; лучший прогноз в строке подсвечен', async () => {
    renderAt('/orders/o20', exampleSeed());
    await openCompare();
    expect([offerCol('20-2-1', 'qty'), offerCol('20-2-1', 'price'), offerCol('20-2-1', 'Y'), offerCol('20-2-1', 'AB')])
      .toEqual(['100шт', '9,00CNY', '90,00₽/шт', '135,00₽/шт']);
    expect([offerCol('20-3-1', 'price'), offerCol('20-3-1', 'Y'), offerCol('20-3-1', 'AB')]).toEqual(['1,20USD', '108,00₽/шт', '162,00₽/шт']);
    expect(offerCol('20-4-1', 'AB')).toBe('114,00₽/шт');
    const best = (code: string) => within(box(code).closest('td') as HTMLElement).queryByText('лучший прогноз') !== null;
    expect(['20-1-1', '20-2-1', '20-3-1', '20-4-1'].map(best)).toEqual([false, false, false, true]);
    expect([best('20-2-2'), best('20-4-2')]).toEqual([false, true]);
  });

  it('две позиции с одним названием у поставщика — обе в одной ячейке, каждая со своей отметкой', async () => {
    renderAt('/orders/o20', exampleSeed([{ id: 'd4', orderId: 'o20', supplierOrderId: 'soD', seq: 4, customerName: ' фланец', qty: 10, unitPrice: 5, purchased: false }]));
    const table = await openCompare();
    expect(within(within(table).getAllByRole('rowgroup')[1]).getAllByRole('row')).toHaveLength(3);
    expect(box('20-4-3').closest('td')).toBe(box('20-4-4').closest('td'));
  });
});

describe('выбор «В работу»', () => {
  it('пример: товар 1 у поставщиков 2 и 4, товар 3 у поставщика 4 → итоги заказа и computeCosting — ровно эти три позиции', async () => {
    const { store } = renderAt('/orders/o20', exampleSeed());
    const table = await openCompare();
    fireEvent.click(box('20-2-1'));                                   // чекбокс
    fireEvent.click(box('20-4-1').closest('td') as HTMLElement);      // клик по ячейке
    fireEvent.click(box('20-4-3'));
    expect([box('20-2-1').checked, box('20-4-1').checked, box('20-4-3').checked]).toEqual([true, true, true]);
    await waitFor(async () => expect((await store.load()).lines.filter((l) => l.purchased).map((l) => l.id).sort()).toEqual(['b1', 'd1', 'd3']));
    const ds = await store.load();
    // b1 900 CNY / 9 000 ₽ / прогноз 13 500; d1 950 / 9 500 / 11 400; d3 200 / 2 000 / 2 400
    const engine = computeCosting(ds, '2026-10-25');
    expect(engine.lines.map((l) => l.lineId).sort()).toEqual(['b1', 'd1', 'd3']);
    const eo = engine.orders.find((o) => o.orderId === 'o20')!;
    expect(eo.sumByCurrency).toEqual({ CNY: 2050 });
    expect(eo.rubAtCalc).toBeCloseTo(20500, 6);
    expect(eo.forecastRub).toBeCloseTo(27300, 6);
    const totals = screen.getByRole('region', { name: 'Итоги заказа' });
    await waitFor(() => expect(totalOf(totals, 'Сумма заказа')).toBe('2050,00CNY'));
    expect(totalOf(totals, 'В рублях по курсу расчёта')).toBe('20500,00₽');
    expect(totalOf(totals, 'Прогноз суммы в РФ')).toBe('27300,00₽');
    // итог заказа в сравнении — тоже только по выбранным
    const sum = screen.getByRole('group', { name: 'Итог заказа по выбранным' });
    expect(flat(sum.textContent)).toContain('2050,00CNY');
    expect(flat(sum.textContent)).toContain('27300,00₽');
    // итоги под поставщиками: по выбранным и по всем предложениям
    const foot = within(table).getAllByRole('rowgroup')[2];
    const cell = (label: string, code: string) => {
      const row = within(foot).getAllByRole('row').find((r) => within(r).getByRole('rowheader').textContent === label) as HTMLElement;
      const idx = within(table).getAllByRole('columnheader').indexOf(column(table, code));
      return flat(within(row).getAllByRole('cell')[idx - 1].textContent);
    };
    expect(cell('В работе', '20-4')).toBe('2позиции1150,00CNYпрогноз13800,00₽');
    expect(cell('Все предложения', '20-4')).toBe('3позиции2110,00CNYпрогноз25320,00₽');
    expect(cell('В работе', '20-2')).toBe('1позиция900,00CNYпрогноз13500,00₽');
    expect(cell('Все предложения', '20-2')).toBe('2позиции1900,00CNYпрогноз28500,00₽');
    expect(cell('В работе', '20-1')).toBe('—');
    // повторный клик снимает выбор
    fireEvent.click(box('20-4-3'));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'd3')?.purchased).toBe(false));
  });

  it('«Всё у этого поставщика» и «Снять всё»', async () => {
    const { store } = renderAt('/orders/o20', exampleSeed());
    const table = await openCompare();
    fireEvent.click(within(column(table, '20-4')).getByRole('button', { name: 'Всё у этого поставщика' }));
    expect(['20-4-1', '20-4-2', '20-4-3'].map((c) => box(c).checked)).toEqual([true, true, true]);
    await waitFor(async () => expect((await store.load()).lines.filter((l) => l.purchased).map((l) => l.id).sort()).toEqual(['d1', 'd2', 'd3']));
    fireEvent.click(box('20-2-2'));
    fireEvent.click(within(column(table, '20-4')).getByRole('button', { name: 'Снять всё' }));
    expect(['20-4-1', '20-4-2', '20-4-3'].map((c) => box(c).checked)).toEqual([false, false, false]);
    await waitFor(async () => expect((await store.load()).lines.filter((l) => l.purchased).map((l) => l.id)).toEqual(['b2']));
  });

  it('медленная запись: быстрые клики не теряются и не откатываются ответами на промежуточные записи', async () => {
    const store = gatedStore(exampleSeed());
    renderWithStore('/orders/o20', store);
    await openCompare();
    fireEvent.click(box('20-2-1'));          // вкл
    await waitFor(() => expect(store.pending).toBe(1));
    fireEvent.click(box('20-4-1'));          // вкл
    fireEvent.click(box('20-2-1'));          // выкл
    fireEvent.click(box('20-2-1'));          // снова вкл
    fireEvent.click(box('20-1-1'));          // вкл
    fireEvent.click(box('20-1-1'));          // и сразу выкл
    const marks = () => ['20-1-1', '20-2-1', '20-4-1'].map((c) => box(c).checked);
    expect(marks()).toEqual([false, true, true]);
    store.release();                          // первая запись завершилась посреди кликов
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'b1')?.purchased).toBe(true));
    expect(marks()).toEqual([false, true, true]);
    store.gated = false;
    store.release();
    await waitFor(async () => {
      const ls = (await store.load()).lines;
      expect(ls.filter((l) => l.purchased).map((l) => l.id).sort()).toEqual(['b1', 'd1']);
    });
    await waitFor(() => expect(store.pending).toBe(0));
    expect(marks()).toEqual([false, true, true]);
    const totals = screen.getByRole('region', { name: 'Итоги заказа' });
    await waitFor(() => expect(totalOf(totals, 'Сумма заказа')).toBe('1850,00CNY'));
  });
});

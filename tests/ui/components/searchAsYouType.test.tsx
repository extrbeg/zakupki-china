// Поиск при вводе (история 93, G24): товар из прошлых позиций с подстановкой данных, поставщик и место — по части названия.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Dataset } from '../../../src/domain/model';
import { applyGeoSeed, planGeoSeed, type GeoData } from '../../../src/data/geo';
import { baseSeed, renderAt } from '../orders/helpers';
import { renderAt as renderDirs } from '../directories/helpers';
import { pickedValue, pickSuggestion, suggestionList, suggestionTexts } from './suggest';

const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const key = (el: HTMLElement, k: string) => fireEvent.keyDown(el, { key: k });
const block = (code: string) => screen.getByRole('region', { name: `Поставщик в заказе ${code}` });

/** Прошлый заказ с катафотами: у жёлтого — две позиции, данные берутся из последней. */
const history: Partial<Dataset> = {
  ...baseSeed,
  suppliers: [...baseSeed.suppliers!, { id: 's3', name: 'Gamma Reflectors Ltd' }, { id: 's4', name: 'Delta Steel' }],
  orders: [...baseSeed.orders!, { id: 'o3', number: 3, date: '2026-03-01', costsComplete: false }, { id: 'o4', number: 4, date: '2026-04-01', costsComplete: false }],
  supplierOrders: [
    ...baseSeed.supplierOrders!,
    { id: 'so3', orderId: 'o3', seq: 1, supplierId: 's3', currency: 'CNY' },
    { id: 'so4', orderId: 'o4', seq: 1, supplierId: 's3', currency: 'CNY' },
  ],
  lines: [
    ...baseSeed.lines!,
    { id: 'h1', orderId: 'o3', supplierOrderId: 'so3', seq: 1, customerName: 'Катафот желтый', qty: 100, unitPrice: 1, purchased: true, hsCode: '1111', weight: 99 },
    { id: 'h2', orderId: 'o4', supplierOrderId: 'so4', seq: 1, customerName: 'Катафот желтый', qty: 200, unitPrice: 1, purchased: true,
      hsCode: '8714109000', dutyRate: 5, packaging: 'коробка', packageSize: '40×30×20', supplierName: 'Yellow reflector', weight: 40, cbm: 0.4 },
    { id: 'h3', orderId: 'o4', supplierOrderId: 'so4', seq: 2, customerName: 'Катафот красный', qty: 50, unitPrice: 1, purchased: true, hsCode: '8714109001' },
  ],
};

describe('товар: подсказки из прошлых позиций', () => {
  it('«катаф» в строке быстрого ввода показывает «Катафот желтый» и «Катафот красный», совпадение подсвечено', async () => {
    renderAt('/orders/o12', history);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const name = within(block('12-1')).getByLabelText('Товар новой позиции');
    set(name, 'катаф');
    // свежие первыми: красный записан в заказе №4 позже жёлтого
    expect(suggestionTexts(name).map((t) => t.replace(/\s*HS.*$/, ''))).toEqual(['Катафот красный', 'Катафот желтый']);
    expect([...suggestionList(name).querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Катаф', 'Катаф']);
    set(name, 'КАТАФОТ  ЖЁЛТ ');
    expect(suggestionTexts(name).map((t) => t.replace(/\s*HS.*$/, ''))).toEqual(['Катафот желтый']);
  });

  it('выбор подсказки: позиция получает HS, пошлину, упаковку, название у поставщика, вес и CBM на единицу × кол-во', async () => {
    const { store } = renderAt('/orders/o12', history);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const b = within(block('12-1'));
    const name = b.getByLabelText('Товар новой позиции');
    pickSuggestion(name, /^Катафот желтый/, 'катаф');
    expect((name as HTMLInputElement).value).toBe('Катафот желтый');
    set(b.getByLabelText('Кол-во новой позиции'), '30');
    set(b.getByLabelText('Цена новой позиции'), '2');
    key(b.getByLabelText('Цена новой позиции'), 'Enter');
    await waitFor(async () => expect((await store.load()).lines.filter((l) => l.supplierOrderId === 'so1')).toHaveLength(3));
    const line = (await store.load()).lines.find((l) => l.supplierOrderId === 'so1' && l.seq === 3)!;
    expect(line).toMatchObject({
      customerName: 'Катафот желтый', qty: 30, unitPrice: 2,
      hsCode: '8714109000', dutyRate: 5, packaging: 'коробка', packageSize: '40×30×20', supplierName: 'Yellow reflector',
    });
    expect(line.weight).toBeCloseTo(6);       // 40 кг / 200 шт × 30
    expect(line.cbm).toBeCloseTo(0.06);       // 0,4 / 200 × 30
  });

  it('клавиатура: ↓ подсвечивает, Enter подставляет и не сохраняет строку, Esc закрывает список, следующий Enter сохраняет', async () => {
    const { store } = renderAt('/orders/o12', history);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const b = within(block('12-1'));
    const name = b.getByLabelText('Товар новой позиции') as HTMLInputElement;
    act(() => name.focus());
    set(name, 'красн');
    expect(name.getAttribute('aria-expanded')).toBe('true');
    key(name, 'ArrowDown');
    const active = name.getAttribute('aria-activedescendant')!;
    expect(document.getElementById(active)?.textContent).toMatch(/^Катафот красный/);
    key(name, 'Enter');
    expect(name.value).toBe('Катафот красный');
    expect(name.getAttribute('aria-expanded')).toBe('false');
    set(name, 'Катафот красный ');
    expect(name.getAttribute('aria-expanded')).toBe('true');
    key(name, 'Escape');
    expect(name.getAttribute('aria-expanded')).toBe('false');
    expect((await store.load()).lines.filter((l) => l.supplierOrderId === 'so1')).toHaveLength(2);
    set(b.getByLabelText('Кол-во новой позиции'), '4');
    set(b.getByLabelText('Цена новой позиции'), '1');
    key(name, 'Enter');
    await waitFor(async () => expect((await store.load()).lines.filter((l) => l.supplierOrderId === 'so1')).toHaveLength(3));
    expect((await store.load()).lines.find((l) => l.supplierOrderId === 'so1' && l.seq === 3)).toMatchObject({ customerName: 'Катафот красный', hsCode: '8714109001' });
  });

  it('полная форма позиции: выбор подставляет пустые поля, введённые вручную не перетирает; вес пересчитывается по кол-ву', async () => {
    const { store } = renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 2' }));
    const form = within(screen.getByRole('form', { name: 'Позиция' }));
    const field = (label: RegExp) => form.getByLabelText(label) as HTMLInputElement;
    set(field(/^HS-код/), '9999');
    pickSuggestion(field(/^Название от заказчика/), /^Катафот желтый/, 'желт');
    expect(field(/^Название от заказчика/).value).toBe('Катафот желтый');
    expect(field(/^HS-код/).value).toBe('9999');
    expect(field(/^Пошлина/).value).toBe('5');
    expect(field(/^Упаковка/).value).toBe('коробка');
    expect(field(/^Название у поставщика/).value).toBe('Yellow reflector');
    expect(field(/^Вес/).value).toBe('2');          // 0,2 кг × 10 шт
    expect(field(/^CBM/).value).toBe('0,02');
    set(field(/^Кол-во/), '50');
    expect(field(/^Вес/).value).toBe('10');
    fireEvent.click(form.getByRole('button', { name: 'Сохранить позицию' }));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.id === 'ln2')).toMatchObject({
      customerName: 'Катафот желтый', hsCode: '9999', dutyRate: 5, weight: 10, qty: 50,
    }));
  });
});

describe('поставщик: поиск по части названия', () => {
  it('«refl» находит поставщика; ничего не найдено — «Нет совпадений» и «+ Новый поставщик…» с введённым текстом', async () => {
    const { store } = renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const form = within(screen.getByRole('region', { name: 'Новый поставщик в заказе' }));
    const sup = form.getByLabelText(/^Поставщик/);
    act(() => sup.focus());
    set(sup, 'REFL');
    expect(suggestionTexts(sup)).toEqual(['Gamma Reflectors Ltd']);
    key(sup, 'Enter');
    expect(pickedValue(sup)).toBe('s3');
    expect((sup as HTMLInputElement).value).toBe('Gamma Reflectors Ltd');

    set(sup, 'Омега');
    expect(within(suggestionList(sup)).queryAllByRole('option').map((o) => o.textContent)).toEqual(['+ Новый поставщик…']);
    expect(screen.getByText('Нет совпадений')).toBeTruthy();
    fireEvent.click(within(suggestionList(sup)).getByRole('option', { name: '+ Новый поставщик…' }));
    const input = form.getByLabelText(/^Название нового поставщика/) as HTMLInputElement;
    expect(input.value).toBe('Омега');
    key(input, 'Enter');
    await waitFor(async () => expect((await store.load()).suppliers.map((s) => s.name)).toContain('Омега'));
    expect((sup as HTMLInputElement).value).toBe('Омега');
  });

  it('ушли из поля, не выбрав, — остаётся прежний выбор; Esc возвращает его же', async () => {
    renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const form = within(screen.getByRole('region', { name: 'Новый поставщик в заказе' }));
    const sup = form.getByLabelText(/^Поставщик/) as HTMLInputElement;
    pickSuggestion(sup, 'Delta Steel', 'delta');
    set(sup, 'Alp');
    fireEvent.blur(sup);
    expect(sup.value).toBe('Delta Steel');
    expect(pickedValue(sup)).toBe('s4');
    act(() => sup.focus());
    set(sup, 'Bet');
    key(sup, 'Escape');
    key(sup, 'Escape');
    expect(sup.value).toBe('Delta Steel');
  });
});

describe('страна, город, провинция: поиск при вводе', () => {
  const geo = (): Partial<Dataset> => {
    const empty: GeoData = { countries: [], provinces: [], cities: [] };
    const china = applyGeoSeed(empty, planGeoSeed(empty));
    return { ...china, countries: [...china.countries, { id: 'cnt_vn', name: 'Вьетнам' }] };
  };

  it('город показывает провинцию в подсказке, выбор подставляет её; провинция и страна — по части названия', async () => {
    const { store } = renderDirs('/suppliers/new', geo());
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    set(screen.getByLabelText(/^Название/), 'Тест');
    const city = screen.getByLabelText(/^Город/) as HTMLInputElement;
    act(() => city.focus());
    set(city, 'ningb');
    const option = within(suggestionList(city)).getAllByRole('option')[0];
    expect(option.textContent).toBe('NingboZhejiang');
    expect(option.querySelector('.suggest__hint')?.textContent).toBe('Zhejiang');
    fireEvent.click(option);
    expect(city.value).toBe('Ningbo');
    expect((screen.getByLabelText(/^Провинция/) as HTMLInputElement).value).toBe('Zhejiang');

    const province = screen.getByLabelText(/^Провинция/) as HTMLInputElement;
    pickSuggestion(province, 'Fujian', 'fuj');
    expect(province.value).toBe('Fujian');

    const country = screen.getByLabelText(/^Страна/);
    act(() => country.focus());
    set(country, 'вьет');
    expect(suggestionTexts(country)).toEqual(['Вьетнам']);
    fireEvent.click(within(suggestionList(country)).getByRole('option', { name: 'Вьетнам' }));
    expect(pickedValue(country)).toBe('Вьетнам');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ country: 'Вьетнам' });
  });
});

describe('дозапрос после ревью', () => {
  it('Enter в поле выбора с поиском без подсвеченного пункта не отправляет форму', async () => {
    renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить поставщика в заказ' }));
    const form = within(screen.getByRole('region', { name: 'Новый поставщик в заказе' }));
    const sup = form.getByLabelText(/^Поставщик/);
    act(() => sup.focus());                                        // список открыт, пункт не подсвечен
    expect(fireEvent.keyDown(sup, { key: 'Enter' })).toBe(false);  // false — действие по умолчанию (отправка формы) отменено
    pickSuggestion(sup, 'Delta Steel', 'delta');
    key(sup, 'Escape');                                            // список закрыт
    expect(fireEvent.keyDown(sup, { key: 'Enter' })).toBe(false);
    expect(pickedValue(sup)).toBe('s4');
  });

  it('быстрый ввод: после сохранения выбранная подсказка сброшена — следующая строка берёт данные последней позиции', async () => {
    const { store } = renderAt('/orders/o12', history);
    await screen.findByRole('region', { name: 'Поставщик в заказе 12-1' });
    const b = within(block('12-1'));
    const addLine = async (qty: string, count: number) => {
      set(b.getByLabelText('Кол-во новой позиции'), qty);
      set(b.getByLabelText('Цена новой позиции'), '1');
      key(b.getByLabelText('Цена новой позиции'), 'Enter');
      await waitFor(async () => expect((await store.load()).lines.filter((l) => l.supplierOrderId === 'so1')).toHaveLength(count));
    };
    pickSuggestion(b.getByLabelText('Товар новой позиции'), /^Катафот желтый/, 'катаф');
    await addLine('10', 3);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 3' }));
    const form = within(screen.getByRole('form', { name: 'Позиция' }));
    set(form.getByLabelText(/^HS-код/), '1234');
    fireEvent.click(form.getByRole('button', { name: 'Сохранить позицию' }));
    await waitFor(async () => expect((await store.load()).lines.find((l) => l.supplierOrderId === 'so1' && l.seq === 3)?.hsCode).toBe('1234'));
    set(within(block('12-1')).getByLabelText('Товар новой позиции'), 'Катафот желтый');
    await addLine('5', 4);
    expect((await store.load()).lines.find((l) => l.supplierOrderId === 'so1' && l.seq === 4)?.hsCode).toBe('1234');
  });

  it('полная форма: ручная правка названия после выбора подсказки снимает пересчёт веса и CBM по старому товару', async () => {
    renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 2' }));
    const form = within(screen.getByRole('form', { name: 'Позиция' }));
    const field = (label: RegExp) => form.getByLabelText(label) as HTMLInputElement;
    pickSuggestion(field(/^Название от заказчика/), /^Катафот желтый/, 'желт');
    expect(field(/^Вес/).value).toBe('2');
    set(field(/^Название от заказчика/), 'Другой товар');
    set(field(/^Кол-во/), '50');
    expect(field(/^Вес/).value).toBe('2');
    expect(field(/^CBM/).value).toBe('0,02');
  });

  it('полная форма, как и быстрый ввод: точно набранное название подставляет данные в пустые поля и подписывает «Из прошлой позиции»', async () => {
    renderAt('/orders/o12', history);
    fireEvent.click(await screen.findByRole('button', { name: 'Подробнее о позиции 2' }));
    const form = within(screen.getByRole('form', { name: 'Позиция' }));
    const field = (label: RegExp) => form.getByLabelText(label) as HTMLInputElement;
    set(field(/^Упаковка/), 'мешок');
    set(field(/^Название от заказчика/), ' катафот ЖЁЛТЫЙ');
    expect(field(/^Название от заказчика/).value).toBe(' катафот ЖЁЛТЫЙ');
    expect(field(/^HS-код/).value).toBe('8714109000');
    expect(field(/^Упаковка/).value).toBe('мешок');
    expect(field(/^Вес/).value).toBe('2');
    expect(form.getByText(/^Из прошлой позиции: HS-код/)).toBeTruthy();
  });
});

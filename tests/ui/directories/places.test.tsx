import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderAt } from './helpers';
import { applyGeoSeed, CHINA_COUNTRY_ID, planGeoSeed, type GeoData } from '../../../src/data/geo';
import type { Dataset } from '../../../src/domain/model';
import { pickSuggestion, suggestionValues } from '../components/suggest';

const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp, value: string) => fireEvent.change(input(label), { target: { value } });
/** Подсказки поля «Город» — значения, которые подставит выбор. */
const optionValues = () => suggestionValues(input(/^Город/));
/** Ввести запрос в поле выбора и нажать Enter — выбирается первая (подсвеченная) подсказка. */
function enter(label: RegExp, query: string) {
  act(() => input(label).focus());
  type(label, query);
  fireEvent.keyDown(input(label), { key: 'Enter' });
  act(() => input(label).blur());
}
/** «+ Добавить…» в поле выбора: ввод нового названия и Enter. */
function addNew(label: RegExp, action: string, name: string, inputLabel: string) {
  pickSuggestion(input(label), action, name);
  const field = screen.getByLabelText(inputLabel);
  fireEvent.change(field, { target: { value: name } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

function seed(): Partial<Dataset> {
  const empty: GeoData = { countries: [], provinces: [], cities: [] };
  const china = applyGeoSeed(empty, planGeoSeed(empty));
  return {
    countries: [...china.countries, { id: 'cnt_vn', name: 'Вьетнам' }],
    provinces: [...china.provinces, { id: 'prv_hn', name: 'Ханой', countryId: 'cnt_vn' }],
    cities: [...china.cities, { id: 'city_hn', city: 'Ханой', province: 'Ханой', countryId: 'cnt_vn' }],
    agents: [{ id: 'a1', name: 'Агент Один' }],
  };
}

async function newSupplier() {
  const utils = renderAt('/suppliers/new', seed());
  await screen.findByRole('heading', { name: 'Новый поставщик' });
  type(/^Название/, 'Тест');
  return utils;
}

describe('поставщик: страна, город, провинция (G21)', () => {
  it('страна по умолчанию — Китай; одноимённые города разных провинций подсказываются с провинцией, выбор подставляет нужную', async () => {
    const { store } = await newSupplier();
    expect((screen.getByLabelText(/^Страна/) as HTMLSelectElement).value).toBe('Китай');
    type(/^Город/, 'Taiz');
    expect(optionValues()).toEqual(expect.arrayContaining(['Taizhou — Zhejiang', 'Taizhou — Jiangsu']));
    pickSuggestion(input(/^Город/), 'Taizhou — Jiangsu', 'Taiz');
    expect(input(/^Город/).value).toBe('Taizhou');
    expect(input(/^Провинция/).value).toBe('Jiangsu');
    pickSuggestion(input(/^Провинция/), 'Zhejiang', 'Zhej');
    expect(input(/^Город/).value).toBe('Taizhou');   // тёзка есть и в Zhejiang — город остаётся
    expect(input(/^Провинция/).value).toBe('Zhejiang');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ country: 'Китай', city: 'Taizhou', province: 'Zhejiang' });
  });

  it('F1: город из нескольких провинций — первым в списке самый крупный тёзка, Enter выбирает его с провинцией', async () => {
    const { store } = await newSupplier();
    enter(/^Город/, 'Taizhou');
    expect(input(/^Провинция/).value).toBe('Jiangsu');   // у Taizhou (Zhejiang) население в справочнике не указано
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ city: 'Taizhou', province: 'Jiangsu' });
  });

  it('F1/F2: Wuxi → Jiangsu, Haikou → Hainan, Suzhou → Jiangsu; тёзки в подсказках по убыванию населения, другой можно выбрать', async () => {
    await newSupplier();
    for (const [city, province] of [['Wuxi', 'Jiangsu'], ['Haikou', 'Hainan'], ['Suzhou', 'Jiangsu']]) {
      enter(/^Город/, city);
      expect(input(/^Провинция/).value).toBe(province);
      enter(/^Провинция/, '');   // снять провинцию — список городов снова вся страна
    }
    type(/^Город/, 'Wuxi');
    expect(optionValues().filter((v) => v?.startsWith('Wuxi'))).toEqual(['Wuxi — Jiangsu', 'Wuxi — Hunan']);
    type(/^Город/, 'Haikou');
    expect(optionValues().filter((v) => v?.startsWith('Haikou'))).toEqual(['Haikou — Hainan', 'Haikou — Yunnan']);
    pickSuggestion(input(/^Город/), 'Wuxi — Hunan', 'Wuxi');
    expect(input(/^Город/).value).toBe('Wuxi');
    expect(input(/^Провинция/).value).toBe('Hunan');
  });

  it('строка без провинции (старый импорт, крупное население) не перебивает тёзок: Wuxi → Jiangsu и при вводе, и при сохранении с пустой провинцией', async () => {
    const base = seed();
    const withBlank = { ...base, cities: [{ id: 'blank_wuxi', city: 'Wuxi', province: '', population: 99_000_000 }, ...base.cities!] };
    const { store } = renderAt('/suppliers/new', withBlank);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Тест');
    type(/^Город/, 'Wuxi');
    expect(input(/^Провинция/).value).toBe('Jiangsu');
    type(/^Провинция/, '');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ city: 'Wuxi', province: 'Jiangsu' });
  });

  it('старые строки Wuxi, Haikou без провинции и без населения после внесения справочника: ввод подставляет крупного тёзку, подсказки — он первым', async () => {
    const legacy: GeoData = { countries: [], provinces: [], cities: [
      { id: 'old_wuxi', city: 'Wuxi', province: '' },
      { id: 'old_haikou', city: 'Haikou', province: '' },
    ] };
    const geo = applyGeoSeed(legacy, planGeoSeed(legacy));
    const { store } = renderAt('/suppliers/new', { ...geo, agents: [{ id: 'a1', name: 'Агент Один' }] });
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Тест');
    enter(/^Город/, 'Wuxi');
    expect(input(/^Провинция/).value).toBe('Jiangsu');
    enter(/^Провинция/, '');
    type(/^Город/, 'Wux');
    expect(optionValues().filter((v) => v?.startsWith('Wuxi'))).toEqual(['Wuxi — Jiangsu', 'Wuxi — Hunan']);
    enter(/^Город/, 'Haikou');
    expect(input(/^Провинция/).value).toBe('Hainan');
    enter(/^Провинция/, '');
    type(/^Город/, 'Haiko');
    expect(optionValues().filter((v) => v?.startsWith('Haikou'))).toEqual(['Haikou — Hainan', 'Haikou — Yunnan']);
    pickSuggestion(input(/^Город/), 'Haikou — Hainan', 'Haik');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ city: 'Haikou', province: 'Hainan' });
  });

  it('F3: страна по умолчанию — Китай под текущим названием; после переименования в «КНР» новый город не заводит вторую страну', async () => {
    const base = seed();
    const renamed = { ...base, countries: base.countries!.map((c) => (c.id === CHINA_COUNTRY_ID ? { ...c, name: 'КНР' } : c)) };
    const { store } = renderAt('/suppliers/new', renamed);
    await screen.findByRole('heading', { name: 'Новый поставщик' });
    type(/^Название/, 'Тест');
    expect((screen.getByLabelText(/^Страна/) as HTMLSelectElement).value).toBe('КНР');
    enter(/^Город/, 'Ningbo');
    expect(input(/^Провинция/).value).toBe('Zhejiang');
    addNew(/^Город/, '+ Добавить город…', 'Новоград', 'Новый город');
    expect(input(/^Провинция/).value).toBe('Zhejiang');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    const ds = await store.load();
    expect(ds.countries.map((c) => c.name).sort()).toEqual(['Вьетнам', 'КНР']);
    expect(ds.cities.find((c) => c.city === 'Новоград')).toMatchObject({ province: 'Zhejiang', countryId: CHINA_COUNTRY_ID });
    expect(ds.suppliers[0]).toMatchObject({ country: 'КНР', city: 'Новоград' });
  });

  it('другая страна: подсказки — только её города, провинция подставляется из её справочника', async () => {
    const { store } = await newSupplier();
    fireEvent.change(screen.getByLabelText(/^Страна/), { target: { value: 'Вьетнам' } });
    type(/^Город/, 'Ха');
    expect(optionValues()).toEqual(['Ханой']);
    type(/^Город/, 'Ningbo');
    expect(optionValues()).toEqual([]);
    enter(/^Город/, 'Ханой');
    expect(input(/^Провинция/).value).toBe('Ханой');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    expect((await store.load()).suppliers[0]).toMatchObject({ country: 'Вьетнам', city: 'Ханой', province: 'Ханой' });
  });

  it('новый город с новой провинцией в другой стране — оба попадают в справочник этой страны', async () => {
    const { store } = await newSupplier();
    fireEvent.change(screen.getByLabelText(/^Страна/), { target: { value: 'Вьетнам' } });
    addNew(/^Город/, '+ Добавить город…', 'Хайфон', 'Новый город');
    addNew(/^Провинция/, '+ Добавить провинцию…', 'Хайфон-регион', 'Новая провинция');
    expect(input(/^Город/).value).toBe('Хайфон');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).suppliers).toHaveLength(1));
    const ds = await store.load();
    expect(ds.cities.find((c) => c.city === 'Хайфон')).toMatchObject({ province: 'Хайфон-регион', countryId: 'cnt_vn' });
    expect(ds.provinces.find((p) => p.name === 'Хайфон-регион')).toMatchObject({ countryId: 'cnt_vn' });
    expect(ds.cities.find((c) => c.city === 'Ningbo')?.countryId).toBe(CHINA_COUNTRY_ID);
  });

  it('«+ Добавить страну…» заводит страну в справочнике и выбирает её; повтор названия не дублирует', async () => {
    const { store } = await newSupplier();
    pickSuggestion(screen.getByLabelText(/^Страна/), '+ Добавить страну…');
    const name = screen.getByLabelText('Новая страна');
    fireEvent.change(name, { target: { value: 'Индия' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(async () => expect((await store.load()).countries.map((c) => c.name)).toContain('Индия'));
    await waitFor(() => expect((screen.getByLabelText(/^Страна/) as HTMLSelectElement).value).toBe('Индия'));
    pickSuggestion(screen.getByLabelText(/^Страна/), '+ Добавить страну…');
    const again = screen.getByLabelText('Новая страна');
    fireEvent.change(again, { target: { value: ' вьетнам ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await waitFor(() => expect((screen.getByLabelText(/^Страна/) as HTMLSelectElement).value).toBe('Вьетнам'));
    expect((await store.load()).countries.filter((c) => c.name.toLowerCase().includes('вьетнам'))).toHaveLength(1);
  });
});

describe('платёжный агент: страна (G21)', () => {
  it('агент сохраняется со страной; провинция подставляется по городу страны', async () => {
    const { store } = renderAt('/agents', seed());
    await screen.findByText('Агент Один');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить агента' }));
    type(/^Название/, 'Агент Ханой');
    fireEvent.change(screen.getByLabelText(/^Страна/), { target: { value: 'Вьетнам' } });
    enter(/^Город/, 'Ханой');
    expect(input(/^Провинция/).value).toBe('Ханой');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).agents).toHaveLength(2));
    expect((await store.load()).agents.find((a) => a.name === 'Агент Ханой')).toMatchObject({ country: 'Вьетнам', city: 'Ханой', province: 'Ханой' });
  });
});

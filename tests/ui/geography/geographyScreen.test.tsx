import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Dataset, EntityName } from '../../../src/domain/model';
import { StoreError } from '../../../src/store/types';
import GeographyScreen from '../../../src/ui/screens/geography/GeographyScreen';

let counter = 0;

const seed = (): Partial<Dataset> => ({
  countries: [{ id: 'cn', name: 'Китай' }, { id: 'in', name: 'Индия' }],
  provinces: [
    { id: 'p_zj', name: 'Zhejiang', countryId: 'cn' },
    { id: 'p_js', name: 'Jiangsu', countryId: 'cn' },
  ],
  cities: [
    { id: 'c_nb', city: 'Ningbo', province: 'Zhejiang', countryId: 'cn' },
    { id: 'c_tz1', city: 'Taizhou', province: 'Zhejiang', countryId: 'cn' },
    { id: 'c_tz2', city: 'Taizhou', province: 'Jiangsu', countryId: 'cn' },
  ],
  suppliers: [{ id: 's1', name: 'Поставщик', country: 'Китай', city: 'Ningbo', province: 'Zhejiang' }],
});

/** Хранилище, у которого одна запись (update с номером failAt) падает сетью. */
class FlakyStore extends LocalStore {
  updates = 0;
  failAt = 0;
  override async update<E extends EntityName>(entity: E, record: Dataset[E][number]): Promise<void> {
    if (++this.updates === this.failAt) throw new StoreError('network');
    return super.update(entity, record);
  }
}

function renderGeo(failAt = 0) {
  const store = new FlakyStore(`zk:t:geo${++counter}`, seed());
  store.failAt = failAt;
  render(
    <MemoryRouter initialEntries={['/geography']}>
      <DataProvider store={store} today="2026-10-26">
        <Routes><Route path="/geography" element={<GeographyScreen />} /></Routes>
      </DataProvider>
    </MemoryRouter>,
  );
  return store;
}

const column = (name: string) => screen.getByRole('region', { name });
const pick = (col: string, item: string) => fireEvent.click(within(column(col)).getByRole('button', { name: item }));

describe('экран «География» (G21)', () => {
  it('страны → провинции страны → города провинции', async () => {
    renderGeo();
    await screen.findByRole('heading', { name: 'География' });
    expect(within(column('Страны')).getByRole('button', { name: 'Китай' })).toBeTruthy();
    pick('Страны', 'Китай');
    expect(within(column('Провинции')).getAllByRole('button', { name: /^(Jiangsu|Zhejiang)$/ }).map((b) => b.textContent)).toEqual(['Jiangsu', 'Zhejiang']);
    pick('Провинции', 'Zhejiang');
    expect([...column('Города').querySelectorAll('.geo-item__name')].map((b) => b.textContent)).toEqual(['Ningbo', 'Taizhou']);
  });

  it('добавляет страну, провинцию в неё и город в провинцию; повтор названия — ошибка у поля', async () => {
    const store = renderGeo();
    await screen.findByRole('heading', { name: 'География' });
    fireEvent.change(screen.getByLabelText('Новая страна'), { target: { value: 'Вьетнам' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страну' }));
    await waitFor(async () => expect((await store.load()).countries.map((c) => c.name)).toContain('Вьетнам'));
    pick('Страны', 'Вьетнам');
    fireEvent.change(screen.getByLabelText('Новая провинция'), { target: { value: 'Ханой' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить провинцию' }));
    await waitFor(async () => expect((await store.load()).provinces.some((p) => p.name === 'Ханой')).toBe(true));
    pick('Провинции', 'Ханой');
    fireEvent.change(screen.getByLabelText('Новый город'), { target: { value: 'Ханой' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить город' }));
    await waitFor(async () => expect((await store.load()).cities.some((c) => c.city === 'Ханой')).toBe(true));
    const ds = await store.load();
    const vn = ds.countries.find((c) => c.name === 'Вьетнам')!;
    expect(ds.provinces.find((p) => p.name === 'Ханой')).toMatchObject({ countryId: vn.id });
    expect(ds.cities.find((c) => c.city === 'Ханой')).toMatchObject({ province: 'Ханой', countryId: vn.id });

    fireEvent.change(screen.getByLabelText('Новая страна'), { target: { value: ' китай ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить страну' }));
    expect(await screen.findByText('Уже есть: Китай')).toBeTruthy();
    expect((await store.load()).countries).toHaveLength(3);
  });

  it('переименование провинции переписывает её города и поставщиков', async () => {
    const store = renderGeo();
    await screen.findByRole('heading', { name: 'География' });
    pick('Страны', 'Китай');
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать: Zhejiang' }));
    fireEvent.change(screen.getByLabelText('Новое название: Zhejiang'), { target: { value: 'Чжэцзян' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).provinces.find((p) => p.id === 'p_zj')?.name).toBe('Чжэцзян'));
    const ds = await store.load();
    expect(ds.cities.filter((c) => c.province === 'Чжэцзян').map((c) => c.id).sort()).toEqual(['c_nb', 'c_tz1']);
    expect(ds.suppliers[0]).toMatchObject({ province: 'Чжэцзян', city: 'Ningbo' });
  });

  it('сбой записи на середине переименования: ошибка видна, повтор «Сохранить» доводит переименование до конца', async () => {
    const store = renderGeo(2);   // первый город записан, второй — сбой
    await screen.findByRole('heading', { name: 'География' });
    pick('Страны', 'Китай');
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать: Zhejiang' }));
    fireEvent.change(screen.getByLabelText('Новое название: Zhejiang'), { target: { value: 'Чжэцзян' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    let ds = await store.load();
    expect(ds.provinces.find((p) => p.id === 'p_zj')?.name).toBe('Zhejiang');
    expect(ds.cities.filter((c) => c.province === 'Чжэцзян')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).provinces.find((p) => p.id === 'p_zj')?.name).toBe('Чжэцзян'));
    ds = await store.load();
    expect(ds.cities.filter((c) => c.province === 'Чжэцзян').map((c) => c.id).sort()).toEqual(['c_nb', 'c_tz1']);
    expect(ds.suppliers[0]).toMatchObject({ province: 'Чжэцзян' });
    expect(ds.cities.some((c) => c.province === 'Zhejiang')).toBe(false);
  });

  it('удаление: используемое — отказ с причиной; неиспользуемое — после подтверждения', async () => {
    const store = renderGeo();
    await screen.findByRole('heading', { name: 'География' });
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Китай' }));
    expect(await screen.findByText(/^Страна используется: провинции — 2/)).toBeTruthy();
    pick('Страны', 'Китай');
    pick('Провинции', 'Zhejiang');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Ningbo' }));
    expect(await screen.findByText('Город используется: поставщики — 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить: Индия' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).countries.map((c) => c.name)).toEqual(['Китай']));
    expect((await store.load()).cities).toHaveLength(3);
  });

  it('поиск по названию: одноимённые города с путём, выбор открывает провинцию', async () => {
    renderGeo();
    await screen.findByRole('heading', { name: 'География' });
    fireEvent.change(screen.getByLabelText('Поиск по названию'), { target: { value: 'taiz' } });
    const results = screen.getByRole('region', { name: 'Найдено' });
    const hits = within(results).getAllByRole('button').map((b) => b.textContent);
    expect(hits).toEqual(['Taizhou — Китай › Jiangsu', 'Taizhou — Китай › Zhejiang']);
    fireEvent.click(within(results).getByRole('button', { name: 'Taizhou — Китай › Jiangsu' }));
    expect([...column('Города').querySelectorAll('.geo-item__name')].map((b) => b.textContent)).toEqual(['Taizhou']);
    expect(within(column('Города')).getByRole('heading').textContent).toBe('Города: Jiangsu');
  });
});

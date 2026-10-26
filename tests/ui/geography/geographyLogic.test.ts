import { describe, expect, it } from 'vitest';
import { emptyDataset, type Dataset } from '../../../src/domain/model';
import {
  cityDeleteBlock, citiesOfProvince, countryDeleteBlock, provinceDeleteBlock, provincesOfCountry, renameCity, renameCountry,
  renameProvince, searchGeography, validateGeoName,
} from '../../../src/ui/screens/geography/geographyLogic';

function ds(): Dataset {
  return {
    ...emptyDataset(),
    countries: [{ id: 'cn', name: 'Китай' }, { id: 'vn', name: 'Вьетнам' }, { id: 'in', name: 'Индия' }],
    provinces: [
      { id: 'p_zj', name: 'Zhejiang', countryId: 'cn' },
      { id: 'p_js', name: 'Jiangsu', countryId: 'cn' },
      { id: 'p_empty', name: 'Tibet', countryId: 'cn' },
      { id: 'p_vn', name: 'Zhejiang', countryId: 'vn' },   // тёзка в другой стране
    ],
    cities: [
      { id: 'c_nb', city: 'Ningbo', province: 'Zhejiang', countryId: 'cn' },
      { id: 'c_tz1', city: 'Taizhou', province: 'Zhejiang', countryId: 'cn' },
      { id: 'c_tz2', city: 'Taizhou', province: 'Jiangsu', countryId: 'cn' },
      { id: 'c_old', city: 'Wenzhou', province: 'Zhejiang' },                 // старая строка без страны — Китай
    ],
    suppliers: [
      { id: 's1', name: 'Без страны', city: 'Ningbo', province: 'Zhejiang' },
      { id: 's2', name: 'Вьетнамский', country: 'Вьетнам', province: 'Zhejiang' },
    ],
    agents: [{ id: 'a1', name: 'Агент', country: 'Китай', city: 'Taizhou', province: 'Jiangsu' }],
  };
}

describe('дерево: страны → провинции → города', () => {
  it('провинции страны и города провинции; город без countryId — в Китае', () => {
    expect(provincesOfCountry(ds(), 'cn').map((p) => p.name)).toEqual(['Jiangsu', 'Tibet', 'Zhejiang']);
    expect(citiesOfProvince(ds(), 'cn', 'zhejiang').map((c) => c.city)).toEqual(['Ningbo', 'Taizhou', 'Wenzhou']);
    expect(citiesOfProvince(ds(), 'vn', 'Zhejiang')).toEqual([]);
  });
});

describe('удаление запрещено, если используется', () => {
  it('страна: провинции, города, поставщики, агенты; пустая — можно', () => {
    expect(countryDeleteBlock(ds(), 'cn')).toBe('Страна используется: провинции — 3, города — 4, поставщики — 1, агенты — 1');
    expect(countryDeleteBlock(ds(), 'vn')).toBe('Страна используется: провинции — 1, поставщики — 1');
    expect(countryDeleteBlock(ds(), 'in')).toBeNull();
  });

  it('провинция: города и поставщики/агенты своей страны; тёзка в другой стране не в счёт', () => {
    expect(provinceDeleteBlock(ds(), 'p_zj')).toBe('Провинция используется: города — 3, поставщики — 1');
    expect(provinceDeleteBlock(ds(), 'p_js')).toBe('Провинция используется: города — 1, агенты — 1');
    expect(provinceDeleteBlock(ds(), 'p_vn')).toBe('Провинция используется: поставщики — 1');
    expect(provinceDeleteBlock(ds(), 'p_empty')).toBeNull();
  });

  it('город: поставщики и агенты с этим городом и провинцией', () => {
    expect(cityDeleteBlock(ds(), 'c_nb')).toBe('Город используется: поставщики — 1');
    expect(cityDeleteBlock(ds(), 'c_tz2')).toBe('Город используется: агенты — 1');
    expect(cityDeleteBlock(ds(), 'c_tz1')).toBeNull();
  });
});

describe('переименование', () => {
  it('провинция: её города и места поставщиков/агентов этой страны получают новое название', () => {
    const changes = renameProvince(ds(), 'p_zj', 'Чжэцзян');
    const ids = changes.map((c) => `${c.entity}:${c.record.id}`).sort();
    expect(ids).toEqual(['cities:c_nb', 'cities:c_old', 'cities:c_tz1', 'provinces:p_zj', 'suppliers:s1']);
    expect(changes.every((c) => !('province' in c.record) || (c.record as { province: string }).province === 'Чжэцзян')).toBe(true);
    expect(changes.find((c) => c.entity === 'provinces')?.record).toEqual({ id: 'p_zj', name: 'Чжэцзян', countryId: 'cn' });
  });

  it('страна: записи с этой страной, в том числе без страны (Китай по умолчанию), получают новое название', () => {
    const changes = renameCountry(ds(), 'cn', 'КНР');
    expect(changes.map((c) => `${c.entity}:${c.record.id}`).sort()).toEqual(['agents:a1', 'countries:cn', 'suppliers:s1']);
    expect(changes.find((c) => c.record.id === 's1')?.record).toMatchObject({ country: 'КНР', city: 'Ningbo' });
  });

  it('город: поставщики и агенты с этим городом и провинцией', () => {
    const changes = renameCity(ds(), 'c_tz2', 'Taizhou JS');
    expect(changes.map((c) => `${c.entity}:${c.record.id}`).sort()).toEqual(['agents:a1', 'cities:c_tz2']);
    expect(changes.find((c) => c.entity === 'agents')?.record).toMatchObject({ city: 'Taizhou JS', province: 'Jiangsu' });
  });
});

describe('переименование после сбоя на середине', () => {
  // применяет изменения по одной до сбоя на шаге failAt (с 1); возвращает набор после частичной записи
  const applyUntil = (data: Dataset, changes: ReturnType<typeof renameProvince>, failAt: number): Dataset => {
    const next: Dataset = JSON.parse(JSON.stringify(data));
    changes.slice(0, failAt - 1).forEach((c) => {
      const list = next[c.entity] as { id: string }[];
      list[list.findIndex((r) => r.id === c.record.id)] = c.record;
    });
    return next;
  };

  it('запись самой сущности — последней: повтор того же переименования доводит его до конца при сбое на любом шаге', () => {
    const cases: [string, (d: Dataset) => ReturnType<typeof renameProvince>, Record<string, string>][] = [
      ['провинция', (d) => renameProvince(d, 'p_zj', 'Чжэцзян'), { p_zj: 'provinces' }],
      ['страна', (d) => renameCountry(d, 'cn', 'КНР'), { cn: 'countries' }],
      ['город', (d) => renameCity(d, 'c_tz2', 'Taizhou JS'), { c_tz2: 'cities' }],
    ];
    for (const [, rename, self] of cases) {
      const full = rename(ds());
      const last = full[full.length - 1];
      expect(self[last.record.id]).toBe(last.entity);
      for (let failAt = 1; failAt <= full.length; failAt++) {
        const partial = applyUntil(ds(), full, failAt);
        const retried = applyUntil(partial, rename(partial), Infinity);
        const done = applyUntil(ds(), full, Infinity);
        expect(retried).toEqual(done);
      }
    }
  });
});

describe('проверка названия', () => {
  it('пустое — ошибка; повтор без учёта регистра и пробелов — ошибка; своё же название — можно', () => {
    const names = [{ id: 'p1', name: 'Zhejiang' }, { id: 'p2', name: 'Jiangsu' }];
    expect(validateGeoName(names, '  ')).toBe('Введите название');
    expect(validateGeoName(names, ' zhejiang ')).toBe('Уже есть: Zhejiang');
    expect(validateGeoName(names, 'Zhejiang', 'p1')).toBe('');
    expect(validateGeoName(names, 'Anhui')).toBe('');
  });
});

describe('поиск по названию', () => {
  it('находит страны, провинции и города по подстроке; у города — путь «страна › провинция»', () => {
    const hits = searchGeography(ds(), 'taiz');
    expect(hits.map((h) => [h.kind, h.name, h.path])).toEqual([
      ['city', 'Taizhou', 'Китай › Jiangsu'],
      ['city', 'Taizhou', 'Китай › Zhejiang'],
    ]);
    expect(searchGeography(ds(), 'JIANG').map((h) => [h.kind, h.name])).toEqual([
      ['province', 'Jiangsu'], ['province', 'Zhejiang'], ['province', 'Zhejiang'],
    ]);
    expect(searchGeography(ds(), 'вьет').map((h) => h.kind)).toEqual(['country']);
    expect(searchGeography(ds(), ' ')).toEqual([]);
  });
});

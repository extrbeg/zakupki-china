import { describe, expect, it } from 'vitest';
import {
  applyGeoSeed, CHINA_COUNTRY_ID, CHINA_COUNTRY_NAME, chinaProvinceOf, GEO_VERSION, planGeoSeed, type GeoData,
} from '../../src/data/geo';
import { CHINA_CITIES, CHINA_PROVINCES } from '../../src/data/geo/china';
import { applyCityInput, cityOptions, findCity } from '../../src/ui/directories/cityLookup';

const empty = (): GeoData => ({ countries: [], provinces: [], cities: [] });
const pairKey = (city: string, province: string) => `${city.toLowerCase()}|${province.toLowerCase()}`;

describe('справочник Китая (данные)', () => {
  it('33 региона и 816 городов; провинция каждого города — из списка регионов', () => {
    expect(CHINA_COUNTRY_NAME).toBe('Китай');
    expect(CHINA_PROVINCES).toHaveLength(33);
    expect(CHINA_CITIES).toHaveLength(816);
    const provinces = new Set(CHINA_PROVINCES);
    expect(CHINA_CITIES.filter((c) => !provinces.has(c.province))).toEqual([]);
  });
});

describe('planGeoSeed — новая таблица', () => {
  it('страна «Китай», 33 провинции страны и города без повторов пары «город — провинция»', () => {
    const plan = planGeoSeed(empty());
    expect(plan.countries).toEqual([{ id: CHINA_COUNTRY_ID, name: 'Китай' }]);
    expect(plan.provinces.map((p) => p.name).sort()).toEqual([...CHINA_PROVINCES].sort());
    expect(plan.provinces.every((p) => p.countryId === CHINA_COUNTRY_ID)).toBe(true);
    const uniquePairs = new Set(CHINA_CITIES.map((c) => pairKey(c.city, c.province)));
    expect(plan.cities).toHaveLength(uniquePairs.size);
    expect(new Set(plan.cities.map((c) => pairKey(c.city, c.province))).size).toBe(uniquePairs.size);
    expect(plan.cities.every((c) => c.countryId === CHINA_COUNTRY_ID)).toBe(true);
    expect(new Set([...plan.countries, ...plan.provinces, ...plan.cities].map((r) => r.id)).size)
      .toBe(plan.countries.length + plan.provinces.length + plan.cities.length);
    expect(plan.cityUpdates).toEqual([]);
  });

  it('одноимённые города в разных провинциях — отдельные записи (Taizhou: Zhejiang и Jiangsu)', () => {
    const plan = planGeoSeed(empty());
    expect(plan.cities.filter((c) => c.city === 'Taizhou').map((c) => c.province).sort()).toEqual(['Jiangsu', 'Zhejiang']);
  });

  it('население берётся из справочника, пустое — без поля', () => {
    const plan = planGeoSeed(empty());
    expect(plan.cities.find((c) => c.city === 'Shanghai')?.population).toBe(22315474);
    const noPop = plan.cities.find((c) => c.city === 'Taizhou' && c.province === 'Zhejiang')!;
    expect('population' in noPop).toBe(false);
  });
});

describe('planGeoSeed — существующая таблица', () => {
  const existing = (): GeoData => ({
    countries: [],
    provinces: [],
    cities: [
      { id: 'c1', city: 'Lhasa', province: '' },                       // пустая провинция — заполнится
      { id: 'c2', city: 'ningbo', province: 'Мой регион', population: 5 }, // провинция пользователя — не трогается
      { id: 'c3', city: 'Taizhou', province: '' },                     // в двух провинциях — провинция самого крупного тёзки
      { id: 'c4', city: 'Shanghai', province: 'Shanghai' },             // уже есть — не дублируется
    ],
  });

  it('пустая провинция заполняется по справочнику (у тёзок — провинцией самого крупного), заполненное пользователем не меняется', () => {
    const plan = planGeoSeed(existing());
    const upd = new Map(plan.cityUpdates.map((c) => [c.id, c]));
    // своего населения нет — справочное той же пары (china.ts: Lhasa 118 721, Taizhou — Jiangsu 612 356)
    expect(upd.get('c1')).toEqual({ id: 'c1', city: 'Lhasa', province: 'Tibet', population: 118721, countryId: CHINA_COUNTRY_ID });
    expect(upd.get('c2')).toEqual({ id: 'c2', city: 'ningbo', province: 'Мой регион', population: 5, countryId: CHINA_COUNTRY_ID });
    expect(upd.get('c3')).toEqual({ id: 'c3', city: 'Taizhou', province: 'Jiangsu', population: 612356, countryId: CHINA_COUNTRY_ID });
  });

  it('ничего не удаляет и не дублирует уже внесённое; своя провинция пользователя попадает в «Провинции» Китая', () => {
    const plan = planGeoSeed(existing());
    expect(plan.cities.some((c) => c.city === 'Shanghai')).toBe(false);
    expect(plan.cities.some((c) => c.city === 'Lhasa')).toBe(false);   // после заполнения пара Lhasa — Tibet уже есть
    expect(plan.cities.filter((c) => c.city === 'Taizhou').map((c) => c.province)).toEqual(['Zhejiang']);   // Jiangsu уже есть — c3
    expect(plan.provinces.find((p) => p.name === 'Мой регион')).toMatchObject({ countryId: CHINA_COUNTRY_ID });
  });

  it('повторное заполнение после применения ничего не добавляет и не меняет', () => {
    const once = applyGeoSeed(existing(), planGeoSeed(existing()));
    const again = planGeoSeed(once);
    expect(again).toEqual({ countries: [], provinces: [], cities: [], cityUpdates: [] });
    expect(once.cities.map((c) => c.id).slice(0, 4)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('страна «Китай» под другим id или переименованная берётся существующей, не создаётся вторая', () => {
    const byName = planGeoSeed({ countries: [{ id: 'cnt_x', name: ' китай ' }], provinces: [], cities: [] });
    expect(byName.countries).toEqual([]);
    expect(byName.provinces.every((p) => p.countryId === 'cnt_x')).toBe(true);
    const renamed = planGeoSeed({ countries: [{ id: CHINA_COUNTRY_ID, name: 'КНР' }], provinces: [], cities: [] });
    expect(renamed.countries).toEqual([]);
  });

  it('провинция, которую пользователь уже завёл в Китае, не повторяется', () => {
    const plan = planGeoSeed({ countries: [{ id: CHINA_COUNTRY_ID, name: 'Китай' }], provinces: [{ id: 'p1', name: 'zhejiang', countryId: CHINA_COUNTRY_ID }], cities: [] });
    expect(plan.provinces.some((p) => p.name.toLowerCase() === 'zhejiang')).toBe(false);
    expect(plan.provinces).toHaveLength(32);
  });

  it('запись с занятым id справочника (переименованная пользователем) не мешает: новая получает другой id', () => {
    const first = planGeoSeed(empty());
    const taken = first.cities[0];
    const plan = planGeoSeed({ countries: first.countries, provinces: first.provinces, cities: [{ ...taken, city: 'Переименован' }] });
    const readded = plan.cities.find((c) => c.city === taken.city && c.province === taken.province)!;
    expect(readded.id).not.toBe(taken.id);
  });
});

describe('неоднозначные названия из старой таблицы без провинции', () => {
  it('Wuxi, Haikou, Suzhou без провинции получают провинцию самого крупного тёзки, дублей пары не прибавляется', () => {
    const current: GeoData = { countries: [], provinces: [], cities: [
      { id: 'w', city: 'Wuxi', province: '', population: 9_000_000 },
      { id: 'h', city: 'Haikou', province: '' },
      { id: 's', city: 'suzhou', province: '' },
    ] };
    const plan = planGeoSeed(current);
    expect(plan.cityUpdates.map((c) => [c.id, c.province])).toEqual([['w', 'Jiangsu'], ['h', 'Hainan'], ['s', 'Jiangsu']]);
    const after = applyGeoSeed(current, plan);
    const pairs = after.cities.map((c) => `${c.city.toLowerCase()}|${c.province}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(after.cities.filter((c) => c.city === 'Wuxi').map((c) => c.province).sort()).toEqual(['Hunan', 'Jiangsu']);
    expect(after.cities.filter((c) => !c.province)).toEqual([]);
  });
});

describe('старые строки без провинции и без населения (Wuxi, Haikou)', () => {
  // население крупного тёзки — из china.ts: Wuxi (Jiangsu) 3 543 719, Haikou (Hainan) 615 835; мелкие — Hunan 66 442, Yunnan 112 644
  const legacy = (): GeoData => ({ countries: [], provinces: [], cities: [
    { id: 'w', city: 'Wuxi', province: '' },
    { id: 'h', city: 'Haikou', province: '' },
  ] });

  it('planGeoSeed проставляет провинцию крупного тёзки и его население из справочника', () => {
    const plan = planGeoSeed(legacy());
    expect(plan.cityUpdates.map((c) => [c.id, c.province, c.population])).toEqual([['w', 'Jiangsu', 3543719], ['h', 'Hainan', 615835]]);
  });

  it('после внесения справочника ввод, findCity и подсказки дают крупного тёзку первым', () => {
    const after = applyGeoSeed(legacy(), planGeoSeed(legacy()));
    expect(applyCityInput(after.cities, {}, 'Wuxi').province).toBe('Jiangsu');
    expect(applyCityInput(after.cities, {}, 'Haikou').province).toBe('Hainan');
    expect(findCity(after.cities, 'Wuxi')?.province).toBe('Jiangsu');
    expect(findCity(after.cities, 'Haikou')?.province).toBe('Hainan');
    expect(cityOptions(after.cities, 'Wuxi').map((o) => o.value)).toEqual(['Wuxi — Jiangsu', 'Wuxi — Hunan']);
    expect(cityOptions(after.cities, 'Haikou').map((o) => o.value)).toEqual(['Haikou — Hainan', 'Haikou — Yunnan']);
  });

  it('строка с провинцией крупного тёзки, но без населения, не уступает справочному мелкому тёзке', () => {
    const cities = [
      { id: 'w', city: 'Wuxi', province: 'Jiangsu' },
      { id: 'w2', city: 'Wuxi', province: 'Hunan', population: 66442 },
    ];
    expect(findCity(cities, 'Wuxi')?.province).toBe('Jiangsu');
    expect(applyCityInput(cities, {}, 'Wuxi').province).toBe('Jiangsu');
    expect(cityOptions(cities, 'Wuxi').map((o) => o.value)).toEqual(['Wuxi — Jiangsu', 'Wuxi — Hunan']);
  });
});

describe('chinaProvinceOf — провинция города по справочнику', () => {
  it('однозначный город — его провинция без учёта регистра; город в двух провинциях и неизвестный — нет ответа', () => {
    expect(chinaProvinceOf(' lhasa ')).toBe('Tibet');
    expect(chinaProvinceOf('Taizhou')).toBeUndefined();
    expect(chinaProvinceOf('Неизвестный')).toBeUndefined();
    expect(GEO_VERSION).toMatch(/\S/);
  });
});

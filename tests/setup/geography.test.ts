import { describe, expect, it, vi } from 'vitest';
import { bindSpreadsheet, createAndBind, restoreBinding } from '../../src/setup/connect';
import { ensureGeography } from '../../src/setup/geography';
import { setBinding } from '../../src/setup/binding';
import { readMeta } from '../../src/setup/installScript';
import { SheetsStore } from '../../src/store/sheetsStore';
import { upsertKeyValue } from '../../src/store/sheetsStore';
import { CHINA_CITIES, CHINA_COUNTRY_ID, GEO_VERSION } from '../../src/data/geo';
import { FakeSheetsApi } from '../store/sheetsStoreFake';
import { applyCityInput, cityOptions, findCity } from '../../src/ui/directories/cityLookup';

const EMAIL = 'geo@example.com';
const deps = () => ({
  createBoundScript: vi.fn(async () => ({ scriptId: 'scr_1' })),
  updateScriptContent: vi.fn(async () => {}),
});
const uniquePairs = new Set(CHINA_CITIES.map((c) => `${c.city.toLowerCase()}|${c.province.toLowerCase()}`)).size;

describe('справочник Китая в таблице (G20)', () => {
  it('новая таблица: сразу страна «Китай», 33 провинции, города с провинцией и страной; метка geoVersion в «_meta»', async () => {
    const fake = new FakeSheetsApi();
    const { spreadsheetId } = await createAndBind(fake, EMAIL, deps());
    const ds = await new SheetsStore(fake, spreadsheetId).load();
    expect(ds.countries).toEqual([{ id: CHINA_COUNTRY_ID, name: 'Китай' }]);
    expect(ds.provinces).toHaveLength(33);
    expect(ds.cities).toHaveLength(uniquePairs);
    expect(ds.cities.every((c) => c.countryId === CHINA_COUNTRY_ID && c.province !== '')).toBe(true);
    expect(ds.cities.find((c) => c.city === 'Lhasa')?.province).toBe('Tibet');
    expect((await readMeta(fake, spreadsheetId)).geoVersion).toBe(GEO_VERSION);
  });

  it('существующая таблица: при входе один раз — пустые провинции заполняются, заполненное и чужие колонки не трогаются, ничего не удаляется', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_geo', {
      'Города': [
        ['id', 'Город', 'Провинция', 'Население', 'Заметка'],
        ['c1', 'Lhasa', '', 900000, 'моя заметка'],
        ['c2', 'Ningbo', 'Мой регион', '', ''],
        ['c3', 'Taizhou', '', '', 'двойной'],
      ],
    });
    setBinding(EMAIL, 'sp_geo');
    expect(await restoreBinding(fake, EMAIL, deps())).toBe('sp_geo');
    const ds = await new SheetsStore(fake, 'sp_geo').load();
    const byId = new Map(ds.cities.map((c) => [c.id, c]));
    expect(byId.get('c1')).toEqual({ id: 'c1', city: 'Lhasa', province: 'Tibet', population: 900000, countryId: CHINA_COUNTRY_ID });
    expect(byId.get('c2')).toEqual({ id: 'c2', city: 'Ningbo', province: 'Мой регион', countryId: CHINA_COUNTRY_ID });
    expect(byId.get('c3')).toEqual({ id: 'c3', city: 'Taizhou', province: 'Jiangsu', population: 612356, countryId: CHINA_COUNTRY_ID });   // тёзки: самый крупный, население — справочное
    const rows = fake.values('sp_geo', 'Города');
    expect(rows.slice(1, 4).map((r) => r[4])).toEqual(['моя заметка', '', 'двойной']);
    expect(ds.cities.filter((c) => c.city === 'Lhasa')).toHaveLength(1);
    expect(ds.provinces.map((p) => p.name)).toContain('Мой регион');
    expect(ds.countries).toHaveLength(1);
  });

  it('города старой таблицы без провинции (Wuxi, Haikou) получают провинцию самого крупного тёзки; дублей не прибавляется', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_legacy_cities', {
      'Города': [
        ['id', 'Город', 'Провинция', 'Население'],
        ['w', 'Wuxi', '', 9000000],
        ['h', 'Haikou', '', 8000000],
      ],
    });
    setBinding(EMAIL, 'sp_legacy_cities');
    await restoreBinding(fake, EMAIL, deps());
    const ds = await new SheetsStore(fake, 'sp_legacy_cities').load();
    expect(ds.cities.find((c) => c.id === 'w')).toMatchObject({ province: 'Jiangsu', population: 9000000 });
    expect(ds.cities.find((c) => c.id === 'h')).toMatchObject({ province: 'Hainan' });
    expect(ds.cities.filter((c) => c.city === 'Wuxi').map((c) => c.province).sort()).toEqual(['Hunan', 'Jiangsu']);
    expect(ds.cities.filter((c) => c.city === 'Haikou').map((c) => c.province).sort()).toEqual(['Hainan', 'Yunnan']);
    expect(ds.cities).toHaveLength(uniquePairs);
    expect(ds.cities.filter((c) => !c.province)).toEqual([]);
  });

  it('строки старой таблицы без провинции и без населения (Wuxi, Haikou): провинция и население крупного тёзки; ввод подставляет его', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_legacy_nopop', {
      'Города': [
        ['id', 'Город', 'Провинция', 'Население'],
        ['w', 'Wuxi', '', ''],
        ['h', 'Haikou', '', ''],
      ],
    });
    setBinding(EMAIL, 'sp_legacy_nopop');
    await restoreBinding(fake, EMAIL, deps());
    const ds = await new SheetsStore(fake, 'sp_legacy_nopop').load();
    // население — из china.ts: Wuxi (Jiangsu) 3 543 719, Haikou (Hainan) 615 835
    expect(ds.cities.find((c) => c.id === 'w')).toMatchObject({ province: 'Jiangsu', population: 3543719 });
    expect(ds.cities.find((c) => c.id === 'h')).toMatchObject({ province: 'Hainan', population: 615835 });
    expect(ds.cities).toHaveLength(uniquePairs);
    expect(applyCityInput(ds.cities, {}, 'Wuxi').province).toBe('Jiangsu');
    expect(applyCityInput(ds.cities, {}, 'Haikou').province).toBe('Hainan');
    expect(findCity(ds.cities, 'Wuxi')?.province).toBe('Jiangsu');
    expect(findCity(ds.cities, 'Haikou')?.province).toBe('Hainan');
    expect(cityOptions(ds.cities, 'Wuxi').map((o) => o.value)).toEqual(['Wuxi — Jiangsu', 'Wuxi — Hunan']);
    expect(cityOptions(ds.cities, 'Haikou').map((o) => o.value)).toEqual(['Haikou — Hainan', 'Haikou — Yunnan']);
  });

  it('заполненная ячейка «Население» не перезаписывается справочным числом, даже если это текст', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_pop_text', {
      'Города': [
        ['id', 'Город', 'Провинция', 'Население'],
        ['w', 'Wuxi', '', '~3 млн'],
        ['h', 'Haikou', '', '3 543 719'],
        ['l', 'Lhasa', '', ''],
      ],
    });
    setBinding(EMAIL, 'sp_pop_text');
    await restoreBinding(fake, EMAIL, deps());
    const rows = fake.values('sp_pop_text', 'Города');
    expect(rows.slice(1, 4).map((r) => [r[0], r[2], r[3]])).toEqual([
      ['w', 'Jiangsu', '~3 млн'],
      ['h', 'Hainan', '3 543 719'],
      ['l', 'Tibet', 118721],   // пустая ячейка — справочное население (china.ts)
    ]);
  });

  it('повторный вход ничего не пишет и не дублирует; даже без метки повтор не добавляет записей', async () => {
    const fake = new FakeSheetsApi();
    const { spreadsheetId } = await createAndBind(fake, EMAIL, deps());
    const count = async () => {
      const ds = await new SheetsStore(fake, spreadsheetId).load();
      return [ds.countries.length, ds.provinces.length, ds.cities.length];
    };
    const before = await count();
    const writes = fake.writes().length;
    await restoreBinding(fake, EMAIL, deps());
    expect(fake.writes()).toHaveLength(writes);
    expect(await ensureGeography(fake, spreadsheetId)).toBeNull();

    await upsertKeyValue(fake, spreadsheetId, '_meta', 'geoVersion', '');
    await bindSpreadsheet(fake, EMAIL, spreadsheetId, deps());
    expect(await count()).toEqual(before);
    expect((await readMeta(fake, spreadsheetId)).geoVersion).toBe(GEO_VERSION);
  });
});

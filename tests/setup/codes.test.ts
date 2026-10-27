import { describe, expect, it, vi } from 'vitest';
import { createAndBind, restoreBinding } from '../../src/setup/connect';
import { ensureSchema } from '../../src/setup/ensureSchema';
import { setBinding } from '../../src/setup/binding';
import { readMeta } from '../../src/setup/installScript';
import { SheetsStore } from '../../src/store/sheetsStore';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const EMAIL = 'codes@example.com';
const deps = () => ({
  createBoundScript: vi.fn(async () => ({ scriptId: 'scr_1' })),
  updateScriptContent: vi.fn(async () => {}),
});

const DEFAULT_TYPES = [
  { name: 'Море, контейнер', basis: 'cbm' }, { name: 'Авто, контейнер', basis: 'cbm' }, { name: 'Ж/д, контейнер', basis: 'cbm' },
  { name: 'Авиа', basis: 'weight' }, { name: 'Авто, сборный груз', basis: 'weight' },
];

describe('типы поставки в таблице (G29)', () => {
  it('новая таблица: «Типы поставки» заполнены заранее с правилом деления доставки', async () => {
    const fake = new FakeSheetsApi();
    const { spreadsheetId } = await createAndBind(fake, EMAIL, deps());
    const ds = await new SheetsStore(fake, spreadsheetId).load();
    expect(ds.shipmentTypes.map(({ name, basis }) => ({ name, basis }))).toEqual(DEFAULT_TYPES);
  });

  it('лист с данными пользователя не дополняется значениями по умолчанию', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_t', { 'Типы поставки': [['id', 'Название', 'Делить доставку'], ['t1', 'Мой тип', 'weight']] });
    await ensureSchema(fake, 'sp_t');
    expect((await new SheetsStore(fake, 'sp_t').load()).shipmentTypes).toEqual([{ id: 't1', name: 'Мой тип', basis: 'weight' }]);
  });
});

describe('разовое проставление при входе (G29, G33)', () => {
  // Старая таблица приложения: заказы без кода, поставки без типа, затраты без номера, своя колонка «Заметка» в «Затратах».
  const seedOld = (fake: FakeSheetsApi) => fake.seed('sp_old', {
    'Заказы': [['id', 'Заказ', 'Дата заказа'], ['o32', 32, 46082 /* 2026-03-01 */]],
    'Поставки': [['id', 'Поставка', 'Тип', 'НДС %'], ['sh1', 'К-1', 'air', 22], ['sh2', 'К-2', 'sea_container', 22]],
    'Затраты': [
      ['id', 'Дата заполнения', 'Дата оплаты', 'Статус', 'Привязка', 'targetId', 'Тип затрат', 'Валюта', 'Заметка'],
      ['c_late', 46150, 46150, 'fact', 'order', 'o32', 'Аванс', 'RUB', 'моё'],
      ['c_early', 46100, 46100, 'fact', 'order', 'o32', 'Аванс', 'RUB', ''],
      ['c_ship', 46100, 46100, 'fact', 'shipment', 'sh1', 'Доставка', 'RUB', ''],
    ],
  });

  it('поставкам — тип по прежнему, затратам — номера по порядку дат; чужие колонки не трогаются; метка в «_meta»', async () => {
    const fake = new FakeSheetsApi();
    seedOld(fake);
    setBinding(EMAIL, 'sp_old');
    expect(await restoreBinding(fake, EMAIL, deps())).toBe('sp_old');
    const ds = await new SheetsStore(fake, 'sp_old').load();
    expect(ds.shipments.map((s) => [s.id, s.typeId])).toEqual([['sh1', 'stp_air'], ['sh2', 'stp_sea']]);
    const code = (id: string) => ds.costs.find((c) => c.id === id)?.code;
    expect(code('c_early')).toBe('Р-2026-32-001');
    expect(code('c_late')).toBe('Р-2026-32-002');
    expect(code('c_ship')).toMatch(/^Р-\d{4}-ПК-1-001$/);
    expect(fake.values('sp_old', 'Затраты')[1][8]).toBe('моё');
    expect((await readMeta(fake, 'sp_old')).codesVersion).toBe('1');
  });

  it('только пустые ячейки: номер, вписанный руками, остаётся; второй вход ничего не пишет в «Затраты» и «Поставки»', async () => {
    const fake = new FakeSheetsApi();
    seedOld(fake);
    await ensureSchema(fake, 'sp_old');
    const head = fake.values('sp_old', 'Затраты')[0] as string[];
    const at = head.indexOf('Номер затраты');
    await fake.update('sp_old', `'Затраты'!${String.fromCharCode(65 + at)}2`, [['Р-2026-32-007']]);
    setBinding(EMAIL, 'sp_old');
    await restoreBinding(fake, EMAIL, deps());
    const ds = await new SheetsStore(fake, 'sp_old').load();
    const code = (id: string) => ds.costs.find((c) => c.id === id)?.code;
    expect(code('c_late')).toBe('Р-2026-32-007');
    expect(code('c_early')).toBe('Р-2026-32-008');

    const before = fake.calls.length;
    await restoreBinding(fake, EMAIL, deps());
    const later = fake.calls.slice(before).filter((c) => c.method !== 'batchGet' && c.method !== 'getMeta');
    expect(later.filter((c) => /Затраты|Поставки/.test(c.range ?? ''))).toEqual([]);
  });
});

describe('сбой разового проставления (G33)', () => {
  it('пишется строкой в «Лог», вход не падает, без метки следующий вход повторит', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_fail', {
      'Заказы': [['id', 'Заказ', 'Дата заказа'], ['o32', 32, 46082]],
      'Затраты': [['id', 'Дата заполнения', 'Статус', 'Привязка', 'targetId', 'Тип затрат', 'Валюта'], ['c1', 46100, 'fact', 'order', 'o32', 'Аванс', 'RUB']],
    });
    await ensureSchema(fake, 'sp_fail');
    const original = fake.update.bind(fake);
    let failed = false;
    fake.update = async (id, range, values, options) => {
      if (!failed && range.includes('Затраты')) { failed = true; throw new Error('сбой сети'); }
      return original(id, range, values, options);
    };
    setBinding(EMAIL, 'sp_fail');
    expect(await restoreBinding(fake, EMAIL, deps())).toBe('sp_fail');
    const log = fake.values('sp_fail', 'Лог');
    expect(log.slice(1).some((r) => r[1] === 'WARN' && /номер/i.test(String(r[2])) && /сбой сети/.test(String(r[3])))).toBe(true);
    expect((await readMeta(fake, 'sp_fail')).codesVersion).toBeUndefined();

    await restoreBinding(fake, EMAIL, deps());
    expect((await new SheetsStore(fake, 'sp_fail').load()).costs[0].code).toBe('Р-2026-32-001');
    expect((await readMeta(fake, 'sp_fail')).codesVersion).toBe('1');
  });
});

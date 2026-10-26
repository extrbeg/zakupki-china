// G27: разделитель аргументов в формулах перевода — по локали таблицы при привязке, один раз чинит формулы при входе.
import { describe, expect, it, vi } from 'vitest';
import { bindSpreadsheet, createAndBind, restoreBinding } from '../../src/setup/connect';
import { setBinding } from '../../src/setup/binding';
import { ensureSchema } from '../../src/setup/ensureSchema';
import { ensureGeography } from '../../src/setup/geography';
import { SheetsStore } from '../../src/store/sheetsStore';
import { sampleLine } from '../store/contract';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const EMAIL = 'sep@example.com';
const SP = 'sp_sep';
const deps = () => ({
  createBoundScript: vi.fn(async () => ({ scriptId: 'scr_1' })),
  updateScriptContent: vi.fn(async () => {}),
});

const settingOf = async (fake: FakeSheetsApi, id: string) => (await new SheetsStore(fake, id).load()).settings.formulaSeparator;
const translations = async (fake: FakeSheetsApi, id: string) => (await new SheetsStore(fake, id).load()).lines.map((l) => l.customerNameEn);
const formulaWrites = (fake: FakeSheetsApi, from = 0) => fake.writes().slice(from).filter((c) => c.input === 'USER_ENTERED');

/** Таблица приложения с двумя позициями, формулы которых записаны через «,», а локаль — русская (ошибка до G27). */
async function tableWithCommaFormulas(settings?: Record<string, string>) {
  const fake = new FakeSheetsApi();
  fake.seed(SP, {});
  await ensureSchema(fake, SP);
  await ensureGeography(fake, SP);
  const store = new SheetsStore(fake, SP);
  await store.load();
  await store.bulkInsert('lines', [sampleLine, { ...sampleLine, id: 'ln_c2', customerName: 'Клапан' }]);
  if (settings) for (const [k, v] of Object.entries(settings)) await store.setSetting(k, v);
  fake.setLocale(SP, 'ru_RU');
  setBinding(EMAIL, SP);
  return fake;
}

describe('разделитель в формулах при входе и привязке (G27)', () => {
  it('вход: таблица без настройки получает разделитель по локали, формулы с «,» переписываются один раз', async () => {
    const fake = await tableWithCommaFormulas();
    expect(await translations(fake, SP)).toEqual(['#ERROR!', '#ERROR!']);
    expect(await restoreBinding(fake, EMAIL, deps())).toBe(SP);
    expect(await settingOf(fake, SP)).toBe(';');
    expect(await translations(fake, SP)).toEqual(['[en] Кран шаровой', '[en] Клапан']);
    expect(formulaWrites(fake).filter((c) => c.values!.flat().some((v) => typeof v === 'string' && v.includes(';')))).toHaveLength(1);
    // следующий вход ничего не переписывает и формулы не перечитывает
    const mark = fake.calls.length;
    const writesMark = fake.writes().length;
    await restoreBinding(fake, EMAIL, deps());
    expect(formulaWrites(fake, writesMark)).toHaveLength(0);
    expect(fake.calls.slice(mark).filter((c) => c.render === 'FORMULA')).toHaveLength(0);
  });

  it('вход: выбранный пользователем разделитель не меняется без вопроса, формулы с ним не трогаются', async () => {
    const fake = await tableWithCommaFormulas({ formulaSeparator: ',' });
    const writesMark = fake.writes().length;
    await restoreBinding(fake, EMAIL, deps());
    expect(await settingOf(fake, SP)).toBe(',');
    expect(formulaWrites(fake, writesMark)).toHaveLength(0);
  });

  it('сбой при приведении формул не мешает входу; следующий вход доделывает', async () => {
    const fake = await tableWithCommaFormulas({ formulaSeparator: ';' });
    const spy = vi.spyOn(fake, 'update').mockRejectedValue(new Error('сбой'));
    expect(await restoreBinding(fake, EMAIL, deps())).toBe(SP);
    spy.mockRestore();
    expect(await translations(fake, SP)).toEqual(['#ERROR!', '#ERROR!']);
    await restoreBinding(fake, EMAIL, deps());
    expect(await translations(fake, SP)).toEqual(['[en] Кран шаровой', '[en] Клапан']);
  });

  it('привязка: результат несёт разделитель по локали и уже сохранённый; без настройки пишется значение по локали', async () => {
    const fake = new FakeSheetsApi();
    const created = await createAndBind(fake, EMAIL, deps());   // новая таблица — ru_RU
    expect(created.formulaSeparator).toEqual({ locale: ';', current: ';' });
    expect(await settingOf(fake, created.spreadsheetId)).toBe(';');

    fake.seed('sp_en', {});
    const en = await bindSpreadsheet(fake, EMAIL, 'sp_en', deps());
    expect(en.formulaSeparator).toEqual({ locale: ',', current: ',' });
    expect(await settingOf(fake, 'sp_en')).toBe(',');
  });
});

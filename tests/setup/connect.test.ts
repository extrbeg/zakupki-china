import { describe, expect, it, vi } from 'vitest';
import { bindSpreadsheet, createAndBind, restoreBinding } from '../../src/setup/connect';
import { getBinding, setBinding } from '../../src/setup/binding';
import { SCRIPT_VERSION } from '../../src/setup/installScript';
import { GoogleApiError } from '../../src/google/errors';
import { StoreError } from '../../src/store/types';
import { SHEETS } from '../../src/store/schema';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const EMAIL = 'user@example.com';
const deps = () => ({
  createBoundScript: vi.fn(async () => ({ scriptId: 'scr_1' })),
  updateScriptContent: vi.fn(async () => {}),
});

describe('подключение таблицы', () => {
  it('createAndBind: новая таблица со схемой, скриптом и запомненной привязкой', async () => {
    const fake = new FakeSheetsApi();
    const d = deps();
    const res = await createAndBind(fake, EMAIL, d);
    expect(res.script).toEqual({ ok: true, scriptId: 'scr_1' });
    expect(getBinding(EMAIL)).toBe(res.spreadsheetId);
    expect(fake.sheetTitles(res.spreadsheetId)).toEqual(expect.arrayContaining(SHEETS.map((s) => s.sheet)));
  });

  it('скрипт не встал — привязка всё равно запомнена, причина в результате', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_x', {});
    const d = deps();
    d.createBoundScript.mockRejectedValueOnce(new GoogleApiError(500));
    const res = await bindSpreadsheet(fake, EMAIL, 'sp_x', d);
    expect(res.script.ok).toBe(false);
    expect(getBinding(EMAIL)).toBe('sp_x');
  });

  it('сбой сети при привязке → StoreError network, привязка не меняется', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_x', {});
    fake.failNext(new GoogleApiError(0));
    const err = await bindSpreadsheet(fake, EMAIL, 'sp_x', deps()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).kind).toBe('network');
    expect(getBinding(EMAIL)).toBeNull();
  });

  it('restoreBinding: нет привязки → null без запросов', async () => {
    const fake = new FakeSheetsApi();
    expect(await restoreBinding(fake, EMAIL, deps())).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it('restoreBinding: привязанная таблица открывается без вопросов, схема догоняется', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_old', { 'Заказы': [['id', 'Заказ']] });
    setBinding(EMAIL, 'sp_old');
    expect(await restoreBinding(fake, EMAIL, deps())).toBe('sp_old');
    expect(fake.sheetTitles('sp_old')).toEqual(expect.arrayContaining(SHEETS.map((s) => s.sheet)));
  });

  it('restoreBinding: устаревший скрипт обновляется, актуальный — нет', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_s', {});
    const d = deps();
    await bindSpreadsheet(fake, EMAIL, 'sp_s', d);
    const fresh = deps();
    await restoreBinding(fake, EMAIL, fresh);
    expect(fresh.updateScriptContent).not.toHaveBeenCalled();
    // в таблице записана старая версия кода
    const rows = fake.values('sp_s', '_meta');
    const r = rows.findIndex((row) => row[0] === 'scriptVersion');
    await fake.update('sp_s', `'_meta'!B${r + 1}`, [['old']]);
    expect(SCRIPT_VERSION).not.toBe('old');
    const stale = deps();
    await restoreBinding(fake, EMAIL, stale);
    expect(stale.updateScriptContent).toHaveBeenCalledWith('scr_1', expect.any(Array));
  });

  it('restoreBinding: таблица удалена → привязка снимается, null', async () => {
    const fake = new FakeSheetsApi();
    setBinding(EMAIL, 'sp_gone');
    expect(await restoreBinding(fake, EMAIL, deps())).toBeNull();
    expect(getBinding(EMAIL)).toBeNull();
  });

  it('restoreBinding: сбой сети → StoreError network, привязка остаётся', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_n', {});
    setBinding(EMAIL, 'sp_n');
    fake.failNext(new GoogleApiError(0));
    const err = await restoreBinding(fake, EMAIL, deps()).catch((e: unknown) => e);
    expect((err as StoreError).kind).toBe('network');
    expect(getBinding(EMAIL)).toBe('sp_n');
  });

  it('привязка чужой таблицы (старая структура) → отказ с текстом, привязка не запоминается, ничего не пишется', async () => {
    const fake = new FakeSheetsApi();
    fake.seed('sp_legacy', { 'Заказы': [[], ['Заказ', 'Дата заказа'], [41, 46296]] });
    const d = deps();
    const err = await bindSpreadsheet(fake, EMAIL, 'sp_legacy', d).catch((e: unknown) => e);
    expect((err as Error).message).toBe('Это не таблица приложения — для переноса используйте Импорт');
    expect(getBinding(EMAIL)).toBeNull();
    expect(fake.writes()).toEqual([]);
    expect(d.createBoundScript).not.toHaveBeenCalled();
  });
});

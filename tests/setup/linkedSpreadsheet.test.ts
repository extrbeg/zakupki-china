// «Ссылка на таблицу» (G19, история 88): сначала прямая проверка доступа (getMeta), окно Google — только при отказе.
import { describe, expect, it, vi } from 'vitest';
import { openLinkedSpreadsheet } from '../../src/setup/connect';
import { GoogleApiError } from '../../src/google/errors';
import { StoreError } from '../../src/store/types';
import { FakeSheetsApi } from '../store/sheetsStoreFake';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';

describe('openLinkedSpreadsheet', () => {
  it('доступ уже есть → таблица сразу, окно Google не открывается', async () => {
    const fake = new FakeSheetsApi();
    fake.seed(ID, {}, 'Закупки Китай');
    const pick = vi.fn(async () => null);
    expect(await openLinkedSpreadsheet(ID, { getMeta: (id) => fake.getMeta(id), pick })).toEqual({ id: ID, name: 'Закупки Китай' });
    expect(pick).not.toHaveBeenCalled();
  });

  it.each([403, 404])('нет доступа (%i) → окно Google с этим файлом; выбор возвращается', async (status) => {
    const getMeta = vi.fn(async () => { throw new GoogleApiError(status); });
    const onStall = vi.fn();
    const pick = vi.fn(async () => ({ id: ID, name: 'Из окна' }));
    expect(await openLinkedSpreadsheet(ID, { getMeta, pick }, { onStall })).toEqual({ id: ID, name: 'Из окна' });
    expect(getMeta).toHaveBeenCalledWith(ID);
    expect(pick).toHaveBeenCalledWith({ fileId: ID, onStall });
  });

  it('нет доступа, отмена в окне → null', async () => {
    const pick = vi.fn(async () => null);
    expect(await openLinkedSpreadsheet(ID, { getMeta: async () => { throw new GoogleApiError(404); }, pick })).toBeNull();
    expect(pick).toHaveBeenCalledTimes(1);
  });

  it('сбой сети при проверке → StoreError, окно не открывается', async () => {
    const pick = vi.fn(async () => null);
    const err = await openLinkedSpreadsheet(ID, { getMeta: async () => { throw new GoogleApiError(0); }, pick }).catch((e) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).kind).toBe('network');
    expect(pick).not.toHaveBeenCalled();
  });
});

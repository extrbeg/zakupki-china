import { describe, expect, it } from 'vitest';
import { readLegacy } from '../../src/import';
import type { SheetsApi } from '../../src/google/sheetsApi';

/** Минимальный SheetsApi: листы с флагом «скрыт», batchGet по именам листов. */
function fakeApi(sheets: { title: string; hidden: boolean; values: unknown[][] }[]) {
  const requested: string[] = [];
  const api: SheetsApi = {
    create: async () => { throw new Error('не нужен'); },
    getMeta: async () => ({ title: 'Закупки Китай AREC', sheets: sheets.map((s, i) => ({ title: s.title, sheetId: i, hidden: s.hidden })) }),
    batchGet: async (_id, ranges) => {
      requested.push(...ranges);
      return ranges.map((r) => {
        const title = r.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
        return sheets.find((s) => s.title === title)?.values ?? [];
      });
    },
    update: async () => { throw new Error('запись в старую таблицу запрещена'); },
    append: async () => { throw new Error('запись в старую таблицу запрещена'); },
    batchUpdate: async () => { throw new Error('запись в старую таблицу запрещена'); },
  };
  return { api, requested };
}

describe('readLegacy', () => {
  it('читает только видимые листы из шести; скрытые пропускает, даже если названы так же', async () => {
    const { api, requested } = fakeApi([
      { title: 'Заказы', hidden: true, values: [['устаревшее']] },
      { title: 'Списки', hidden: false, values: [['Тип компании'], ['Производство']] },
      { title: 'Затраты по заказам', hidden: false, values: [[], [], ['Номер заказа']] },
      { title: 'исходные заказы', hidden: true, values: [['x']] },
      { title: 'Задание', hidden: false, values: [['не переносится']] },
    ]);
    const raw = await readLegacy(api, 'old');
    expect(Object.keys(raw.sheets).sort()).toEqual(['Затраты по заказам', 'Списки']);
    expect(raw.sheets['Списки']).toEqual({ hidden: false, values: [['Тип компании'], ['Производство']] });
    expect(requested.some((r) => r.includes('Заказы') && !r.includes('Затраты'))).toBe(false);
    expect(requested.some((r) => r.includes('Задание') || r.includes('исходные'))).toBe(false);
  });

  it('в таблице нет ни одного листа старой таблицы — понятная ошибка', async () => {
    const { api } = fakeApi([{ title: 'Лист1', hidden: false, values: [] }]);
    await expect(readLegacy(api, 'other')).rejects.toThrow(/нет листов старой таблицы/i);
  });
});

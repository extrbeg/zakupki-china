// R33.2: перенесённые заказы считаются как в старой таблице. Выгрузка реальной таблицы — fixtures/private/legacy.json
// (вне git, делается fixtures/tools/export_legacy.py); без неё тест пропускается.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapLegacy, type LegacyRaw } from '../../src/import';
import { computeCosting } from '../../src/domain/costing';
import { effectiveCoef } from '../../src/domain/lineFigures';
import { emptyDataset, type Dataset } from '../../src/domain/model';

const FILE = resolve(__dirname, '../../fixtures/private/legacy.json');
const TOLERANCE = 0.005;

describe.skipIf(!existsSync(FILE))('референс: старая таблица → импорт → себестоимость', () => {
  it('AV/AW позиций заказов с одинаковым AD совпадают со старыми AV/AW в пределах 0,5 %', () => {
    const raw = JSON.parse(readFileSync(FILE, 'utf8')) as LegacyRaw;
    const plan = mapLegacy(raw, '2026-10-25');
    const ds: Dataset = { ...emptyDataset(), ...plan.data };
    const result = computeCosting(ds, '2026-10-25');

    const values = raw.sheets['Заказы'].values;
    const head = values[1].map((v) => String(v).trim());
    const avCol = head.indexOf('Себестоимость 1 единицы');
    const awCol = head.indexOf('Коэффициент стоимости доставки по факту');
    expect(avCol).toBeGreaterThan(0);
    expect(awCol).toBeGreaterThan(0);

    const origin = (id: string) => plan.origins?.[id];
    const mismatches: string[] = [];
    let compared = 0;
    for (const order of ds.orders) {
      const lines = ds.lines.filter((l) => l.orderId === order.id);
      // действующий AD (G05): свой AD позиции, иначе AD поставщика в заказе — импорт поднимает частый AD на поставщика
      const ads = new Set(lines.filter((l) => l.purchased).map((l) => effectiveCoef(l, ds.supplierOrders.find((s) => s.id === l.supplierOrderId))));
      if (ads.size !== 1) continue;
      for (const line of lines) {
        const src = origin(line.id);
        expect(src, `у позиции ${line.id} нет исходной строки`).toBeDefined();
        const row = values[src!.row - 1];
        const oldAV = row[avCol];
        const oldAW = row[awCol];
        if (typeof oldAV !== 'number') continue;   // #DIV/0! и пустые — сверять нечего
        const lc = result.lines.find((l) => l.lineId === line.id);
        const newAV = lc?.AV ?? 0;
        const newAW = lc?.AW ?? 0;
        const off = (a: number, b: number) => (b === 0 ? Math.abs(a) > 1e-6 : Math.abs(a - b) / Math.abs(b) > TOLERANCE);
        if (off(newAV, oldAV)) mismatches.push(`заказ ${order.number}, строка ${src!.row}: AV ${newAV} вместо ${oldAV}`);
        if (typeof oldAW === 'number' && off(newAW, oldAW)) mismatches.push(`заказ ${order.number}, строка ${src!.row}: AW ${newAW} вместо ${oldAW}`);
        if (oldAV !== 0) compared++;
      }
    }
    expect(mismatches).toEqual([]);
    expect(compared).toBeGreaterThan(5);   // сверка не пустая: есть позиции с затратами
  });
});

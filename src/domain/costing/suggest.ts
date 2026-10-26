// Подсказка коэффициента AD (R27): медиана фактического AW позиций закрытых заказов.
// Каскад: тот же поставщик + план. тип доставки → тот же тип доставки → все; нужно минимум 3 точки.

import type { Dataset, ShipmentMode } from '../model';
import type { CoefSuggestion, CostingResult } from './types';

const MIN_POINTS = 3;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function suggestCoef(ds: Dataset, result: CostingResult, supplierId: string, mode: ShipmentMode | undefined): CoefSuggestion {
  const lines = new Map(ds.lines.map((l) => [l.id, l]));
  const sos = new Map(ds.supplierOrders.map((s) => [s.id, s]));
  const points: { aw: number; supplierId: string; mode: ShipmentMode | undefined }[] = [];
  for (const lc of result.lines) {
    if (lc.provisional || lc.AW === null || !Number.isFinite(lc.AW)) continue;
    const so = sos.get(lines.get(lc.lineId)?.supplierOrderId ?? '');
    if (!so) continue;
    points.push({ aw: lc.AW, supplierId: so.supplierId, mode: so.plannedMode });
  }

  const levels: [CoefSuggestion['basis'], (p: (typeof points)[number]) => boolean][] = [];
  if (mode) {
    levels.push(['supplier+mode', (p) => p.supplierId === supplierId && p.mode === mode]);
    levels.push(['mode', (p) => p.mode === mode]);
  }
  levels.push(['all', () => true]);

  for (const [basis, match] of levels) {
    const aws = points.filter(match).map((p) => p.aw);
    if (aws.length >= MIN_POINTS) return { value: median(aws), basis, points: aws.length };
  }
  return { value: null, basis: 'none', points: points.length };
}

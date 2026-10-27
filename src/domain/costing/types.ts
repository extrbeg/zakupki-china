// Форма результата движка себестоимости (interfaces.md §1 `costing/`).

import type { CostTargetType, Currency } from '../model';
import type { RatePick } from '../rates';

export type CostCategory = 'goods' | 'commission' | 'delivery' | 'shipmentOther' | 'duty' | 'vat' | 'customsFees' | 'direct' | 'other';

export const COST_CATEGORIES: readonly CostCategory[] = ['goods', 'commission', 'delivery', 'shipmentOther', 'duty', 'vat', 'customsFees', 'direct', 'other'];

/** Подписи категорий для интерфейса. */
export const COST_CATEGORY_LABEL: Record<CostCategory, string> = {
  goods: 'Товар', commission: 'Комиссии', delivery: 'Доставка', shipmentOther: 'Прочие расходы поставки',
  duty: 'Пошлина', vat: 'НДС', customsFees: 'Сборы', direct: 'Прямые', other: 'Прочее',
};

export interface CostWarning {
  code: 'NO_RATE' | 'NO_CBM' | 'NO_WEIGHT' | 'NO_DECLARATION' | 'EMPTY_BASE' | 'BATCH_OVER_QTY' | 'NOT_COMPLETE';
  message: string;
  refs: { type: CostTargetType | 'batch' | 'cost'; id: string }[];
}

/** Затрата в рублях: факт — по зафиксированному курсу, план — по курсу даты расчёта. */
export interface CostRub { costId: string; rub: number | null; rate: RatePick | null }

export interface BatchCost { batchId: string; virtual: boolean; lineId: string; shipmentId: string | null; qty: number; breakdown: Record<CostCategory, number>; total: number; unitCost: number }

export interface LineCost { lineId: string; orderId: string; qty: number; unshippedQty: number; Y: number | null; AB: number | null; AD: number | null; breakdown: Record<CostCategory, number>; total: number; AV: number | null; AW: number | null; provisional: boolean }

export interface OrderTotals { orderId: string; sumByCurrency: Partial<Record<Currency, number>>; rubAtCalc: number; forecastRub: number; planRub: number; factRub: number; costTotal: number }

/**
 * Прогноз таможни декларации (R22.1): пошлина = Σ тамож. стоимость × % пошлины,
 * НДС = (тамож. стоимость + пошлина) × ставка НДС поставки (иначе settings.vatRateDefault, иначе 22).
 * Только для показа: в себестоимость партий, planRub и итоги не входит.
 */
export interface CustomsForecast { declarationId: string; shipmentId: string; customsValue: number; duty: number; vat: number; vatRate: number }

/** Доля затраты, легшая на партию (₽, без округления); партия остатка — `rest:<lineId>`. */
export interface CostAllocation { costId: string; batchId: string; rub: number }

export interface CostingResult {
  costsRub: CostRub[]; batches: BatchCost[]; lines: LineCost[]; orders: OrderTotals[]; unallocatedRub: number; warnings: CostWarning[];
  customsForecasts: CustomsForecast[];
  /** Фактическое распределение каждой затраты по партиям (G31). */
  allocations: CostAllocation[];
}

export interface CoefSuggestion { value: number | null; basis: 'supplier+mode' | 'mode' | 'all' | 'none'; points: number }

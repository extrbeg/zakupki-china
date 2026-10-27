// Разбивка затраты поставки / декларации по заказам для показа (G31): подписи долей и правило деления.
// Сами доли считает движок (src/domain/costShares.ts), здесь — только текст.

import { costCategory } from '../../../domain/costing';
import type { CostTargetType, Dataset } from '../../../domain/model';
import { BASIS_LABEL, deliveryBasis, shipmentTypeOf } from '../../../domain/shipmentTypes';
import { formatCoef } from '../../format';

/** Доля в процентах для показа: «62 %», «33,3 %». */
export const formatSharePct = (pct: number): string => `${formatCoef(Math.round(pct * 10) / 10)} %`;

/** Как делится затрата по заказам — по привязке и типу затраты, как в движке. Не поставка и не декларация — null. */
export function splitRuleText(ds: Dataset, targetType: CostTargetType, targetId: string | undefined, costType: string | undefined): string | null {
  if (targetType === 'declaration') return 'Делится по таможенной стоимости товаров декларации';
  if (targetType !== 'shipment') return null;
  const sh = ds.shipments.find((s) => s.id === targetId);
  if (!sh) return null;
  if (costCategory(costType) === 'delivery') {
    const type = shipmentTypeOf(ds, sh);
    return `Доставка делится ${BASIS_LABEL[deliveryBasis(ds, sh)]}${type ? ` — правило типа поставки «${type.name}»` : ''}`;
  }
  return 'Делится по весу партий (нет веса — по стоимости)';
}

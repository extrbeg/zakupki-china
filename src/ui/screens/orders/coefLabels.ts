// Названия коэффициентов (G22) — из словаря полей (`domain/labels`). Полные — в формах, итогах и подсказках;
// сокращённые — только в узких шапках таблиц (полное название тогда лежит в `title`).

import { F, SHORT } from '../../../domain/labels';

export const AD_LABEL = F.coefPlan;
export const AW_LABEL = F.coefFact;
export const AD_SHORT = SHORT.coefPlan;
export const AW_SHORT = SHORT.coefFact;
/** Поле коэффициента на поставщике в заказе. */
export const AD_SUPPLIER_LABEL = `${F.coefPlan} (для всех товаров поставщика)`;

/** Подсказка шапки: полное название и пояснение. */
export const adTip = (note: string) => `${F.coefPlan}: ${note}`;
export const awTip = (note: string) => `${F.coefFact}: ${note}`;

// Стандартные типы затрат и их категории. Тип затраты — свободная строка из списка «Тип затрат»;
// незнакомый тип относится к категории по ключевому слову, иначе — «Прочее».

import type { CostCategory } from './types';

export const COST_TYPES: { value: string; category: CostCategory }[] = [
  { value: 'Аванс', category: 'goods' },
  { value: 'Предоплата 100 %', category: 'goods' },
  { value: 'Оплата перед отгрузкой', category: 'goods' },
  { value: 'Итоговый расчёт', category: 'goods' },
  { value: 'Комиссия банка', category: 'commission' },
  { value: 'Комиссия агента', category: 'commission' },
  { value: 'Доставка', category: 'delivery' },
  { value: 'СВХ', category: 'shipmentOther' },
  { value: 'Брокер', category: 'shipmentOther' },
  { value: 'Терминальная обработка', category: 'shipmentOther' },
  { value: 'Сертификаты', category: 'shipmentOther' },
  { value: 'Растаможка/сборы', category: 'customsFees' },
  { value: 'Пошлина', category: 'duty' },
  { value: 'НДС', category: 'vat' },
  { value: 'Прочее', category: 'other' },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

const EXACT = new Map(COST_TYPES.map((t) => [norm(t.value), t.category]));

// Порядок важен: «комиссия за доставку» — комиссия, «оплата доставки» — доставка.
const KEYWORDS: [RegExp, CostCategory][] = [
  [/комисс/, 'commission'],
  [/пошлин/, 'duty'],
  [/(^|[^а-я])ндс([^а-я]|$)/, 'vat'],
  [/растамож|таможен|сбор|оформлен|декларац/, 'customsFees'],
  [/свх|брокер|терминал|сертифик|склад|хранен/, 'shipmentOther'],
  [/доставк|фрахт|перевоз|логист/, 'delivery'],
  [/аванс|предоплат|оплат|расчет|товар/, 'goods'],
];

/** Категория типа затраты. */
export function costCategory(costType: string | undefined): CostCategory {
  const s = norm(costType ?? '');
  if (!s) return 'other';
  const exact = EXACT.get(s);
  if (exact) return exact;
  for (const [re, cat] of KEYWORDS) if (re.test(s)) return cat;
  return 'other';
}

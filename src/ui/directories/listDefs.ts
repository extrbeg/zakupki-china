import type { ListKey } from '../../domain/model';

/** Редактируемые списки в порядке показа на экране «Списки». */
export const LIST_DEFS: { key: ListKey; label: string }[] = [
  { key: 'payer', label: 'Плательщики' },
  { key: 'department', label: 'Подразделения' },
  { key: 'customer', label: 'Заказчики' },
  { key: 'costType', label: 'Типы затрат' },
  { key: 'companyType', label: 'Типы компании' },
  { key: 'direction', label: 'Направления' },
  { key: 'specialization', label: 'Специализации' },
  { key: 'paymentTerms', label: 'Условия оплаты' },
];

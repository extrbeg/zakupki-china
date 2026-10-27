// Справочник «Типы поставки» (G29) для форм и раздела «Списки»: проверка названия, запрет удаления,
// запись заранее заведённых типов, если справочник ещё пуст (старый демо-набор).

import type { Dataset, ShipmentType } from '../../domain/model';
import { DEFAULT_SHIPMENT_TYPES } from '../../domain/shipmentTypes';
import { compareRu, normalizeName } from './cityLookup';

/** Ошибка названия типа (пусто или дубль); пустая строка — всё верно. */
export function validateShipmentTypeName(types: Pick<ShipmentType, 'id' | 'name'>[], name: string, exceptId?: string): string {
  if (name.trim() === '') return 'Введите название';
  const key = normalizeName(name);
  return types.some((t) => t.id !== exceptId && normalizeName(t.name) === key) ? 'Такой тип уже есть' : '';
}

/** Причина, по которой тип нельзя удалить (используется в поставках); null — можно. */
export function shipmentTypeDeleteBlock(ds: Pick<Dataset, 'shipments'>, typeId: string): string | null {
  const numbers = ds.shipments.filter((s) => s.typeId === typeId).map((s) => s.number).sort(compareRu);
  return numbers.length > 0 ? `Тип используется в поставках: ${numbers.join(', ')}` : null;
}

/**
 * Справочник пуст — записать заранее заведённые типы (их показывают формы), чтобы правки и ссылки легли на настоящие записи.
 * change — правка одного из них, которая войдёт в эту же запись: put — тип с тем же id в изменённом виде, drop — id, который не писать.
 * true — справочник был пуст и записан (правка уже учтена), false — ничего не делалось.
 */
export async function storeDefaultTypes(
  ds: Pick<Dataset, 'shipmentTypes'>,
  save: (entity: 'shipmentTypes', record: ShipmentType) => Promise<void>,
  change: { put?: ShipmentType; drop?: string } = {},
): Promise<boolean> {
  if ((ds.shipmentTypes ?? []).length > 0) return false;
  for (const t of DEFAULT_SHIPMENT_TYPES) {
    if (t.id === change.drop) continue;
    await save('shipmentTypes', t.id === change.put?.id ? { ...change.put } : { ...t });
  }
  return true;
}

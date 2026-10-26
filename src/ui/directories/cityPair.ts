// Сохранение пары «город — провинция»: неизвестный город с провинцией попадает в справочник городов.

import { newId } from '../../domain/ids';
import type { DataApi } from '../DataContext';
import { findCity } from './cityLookup';

export interface CityPair { city?: string; province?: string }

/** Приводит город к написанию из справочника и добавляет новую пару в `cities`. Провинция из формы главнее справочной. */
export async function resolveCityPair(data: Pick<DataApi, 'ds' | 'save'>, city?: string, province?: string): Promise<CityPair> {
  const name = (city ?? '').trim();
  const prov = (province ?? '').trim() || undefined;
  if (!name) return { city: undefined, province: prov };
  const known = findCity(data.ds.cities, name);
  if (known) return { city: known.city, province: prov ?? known.province };
  if (prov) await data.save('cities', { id: newId('city'), city: name, province: prov });
  return { city: name, province: prov };
}

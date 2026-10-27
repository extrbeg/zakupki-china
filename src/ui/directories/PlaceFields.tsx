// Поля места поставщика и агента (G21): «Страна» (по умолчанию Китай, «+ Добавить страну…»), «Город» и «Провинция» —
// все три выбираются из «Географии» с поиском при вводе. Города — только выбранной страны; провинция подставляется из её справочника. Три поля подряд — внутрь FormGrid.

import { useMemo, useState } from 'react';
import type { Dataset } from '../../domain/model';
import { useData } from '../DataContext';
import { AddableSelect } from '../components';
import { CityProvinceFields } from './CityProvinceFields';
import { findCity } from './cityLookup';
import { ensureCountry } from './cityPair';
import { citiesOfCountry, countryOptions, findCountry, provinceNamesOf } from './geography';

export interface PlaceDraft { country?: string; city?: string; province?: string }

export interface PlaceFieldsProps {
  ds: Pick<Dataset, 'countries' | 'provinces' | 'cities'>;
  value: PlaceDraft;
  onChange: (next: PlaceDraft) => void;
  provinceError?: string;
}

export function PlaceFields({ ds, value, onChange, provinceError }: PlaceFieldsProps) {
  const data = useData();
  const [addError, setAddError] = useState<string | undefined>(undefined);
  const cities = useMemo(() => citiesOfCountry(ds, value.country), [ds, value.country]);
  const provinces = useMemo(() => provinceNamesOf(ds, value.country), [ds, value.country]);

  const changeCountry = (country: string | undefined) => {
    // город другой страны не переносится в новую
    const keep = value.city && findCity(citiesOfCountry(ds, country), value.city);
    onChange(keep ? { ...value, country } : { country, city: undefined, province: undefined });
  };

  const addCountry = async (name: string) => {
    setAddError(undefined);
    const existing = findCountry(ds, name);
    if (existing) { changeCountry(existing.name); return; }
    try {
      await ensureCountry(data, name);
      changeCountry(name);
    } catch {
      setAddError('Не удалось добавить страну — попробуйте ещё раз');
    }
  };

  return (
    <>
      <AddableSelect
        label="Страна" search value={value.country} options={countryOptions(ds)}
        onChange={changeCountry} onAdd={(name) => void addCountry(name)}
        addLabel="+ Добавить страну…" inputLabel="Новая страна" addError={addError}
      />
      <CityProvinceFields
        cities={cities} provinces={provinces} city={value.city} province={value.province} provinceError={provinceError}
        onChange={(next) => onChange({ ...value, ...next })}
      />
    </>
  );
}

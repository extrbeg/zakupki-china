// Поля «Город» и «Провинция»: подсказки из справочника, провинция подставляется сама, её можно поправить руками.
// Возвращает два поля подряд — ставится внутрь FormGrid.

import { useId, useMemo } from 'react';
import type { City } from '../../domain/model';
import { Field } from '../components';
import { applyCityInput, findCity, listProvinces, suggestCities, type CityDraft } from './cityLookup';

export interface CityProvinceFieldsProps {
  cities: City[];
  city: string | undefined;
  province: string | undefined;
  onChange: (next: CityDraft) => void;
  provinceError?: string;
}

export function CityProvinceFields({ cities, city, province, onChange, provinceError }: CityProvinceFieldsProps) {
  const uid = useId();
  const cityList = `${uid}-cities`;
  const provinceList = `${uid}-provinces`;
  const suggestions = useMemo(() => suggestCities(cities, city), [cities, city]);
  const provinces = useMemo(() => listProvinces(cities), [cities]);
  const name = (city ?? '').trim();
  const unknownCity = name !== '' && !findCity(cities, name);

  return (
    <>
      <Field label="Город" hint="Начните вводить — подскажем город из справочника">
        {({ id, describedBy }) => (
          <>
            <input
              id={id} className="input" type="text" list={cityList} value={city ?? ''} autoComplete="off"
              aria-describedby={describedBy}
              onChange={(e) => onChange(applyCityInput(cities, { city, province }, e.target.value))}
            />
            <datalist id={cityList}>
              {suggestions.map((c) => <option key={c.id} value={c.city}>{c.province}</option>)}
            </datalist>
          </>
        )}
      </Field>
      <Field
        label="Провинция" required={unknownCity} error={provinceError}
        hint={unknownCity ? 'Города нет в справочнике — укажите провинцию, пара сохранится' : 'Подставляется по городу, можно поправить'}
      >
        {({ id, describedBy, invalid }) => (
          <>
            <input
              id={id} className="input" type="text" list={provinceList} value={province ?? ''} autoComplete="off"
              aria-invalid={invalid || undefined} aria-describedby={describedBy}
              onChange={(e) => onChange({ city, province: e.target.value })}
            />
            <datalist id={provinceList}>
              {provinces.map((p) => <option key={p} value={p} />)}
            </datalist>
          </>
        )}
      </Field>
    </>
  );
}

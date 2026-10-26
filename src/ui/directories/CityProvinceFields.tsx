// Поля «Город» и «Провинция»: подсказки из справочника, провинция подставляется сама, её можно поправить руками.
// Одноимённые города разных провинций подсказываются как «Taizhou — Zhejiang»: выбор подставляет нужную провинцию.
// Оба поля — с подсказками при вводе (история 93): поиск по подстроке, город показывает провинцию серым справа.
// Возвращает два поля подряд — ставится внутрь FormGrid.

import { useMemo } from 'react';
import type { City } from '../../domain/model';
import { SUGGESTION_LIMIT, filterByQuery } from '../../domain/search';
import { Field, SuggestInput } from '../components';
import { applyCityInput, cityOptions, cityProvinces, findCity, listProvinces, type CityDraft } from './cityLookup';

export interface CityProvinceFieldsProps {
  cities: City[];
  city: string | undefined;
  province: string | undefined;
  onChange: (next: CityDraft) => void;
  provinceError?: string;
  /** Провинции для подсказки; по умолчанию — провинции из `cities`. */
  provinces?: string[];
}

export function CityProvinceFields({ cities, city, province, onChange, provinceError, provinces: provinceNames }: CityProvinceFieldsProps) {
  const suggestions = useMemo(() => cityOptions(cities, city, SUGGESTION_LIMIT), [cities, city]);
  const provinces = useMemo(() => provinceNames ?? listProvinces(cities), [cities, provinceNames]);
  const provinceHits = useMemo(() => filterByQuery(provinces, (p) => p, province ?? ''), [provinces, province]);
  const setCity = (text: string) => onChange(applyCityInput(cities, { city, province }, text));
  const name = (city ?? '').trim();
  const unknownCity = name !== '' && !findCity(cities, name);
  const ambiguous = !unknownCity && cityProvinces(cities, name).length > 1;

  return (
    <>
      <Field label="Город" hint="Начните вводить — подскажем город из справочника">
        {({ id, describedBy }) => (
            <SuggestInput
              id={id} aria-describedby={describedBy} value={city ?? ''} onChange={setCity}
              suggestions={suggestions.map((o) => ({ key: o.key, value: o.value, label: o.city, hint: o.province }))}
              onPick={(s) => setCity(s.value)}
            />
          )}
      </Field>
      <Field
        label="Провинция" required={unknownCity} error={provinceError}
        hint={unknownCity ? 'Города нет в справочнике — укажите провинцию, пара сохранится'
          : ambiguous ? 'Подставлена провинция самого крупного города с этим названием — другую выберите в подсказках' : 'Подставляется по городу, можно поправить'}
      >
        {({ id, describedBy, invalid }) => (
            <SuggestInput
              id={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} value={province ?? ''}
              onChange={(text) => onChange({ city, province: text })}
              suggestions={provinceHits.map((p) => ({ key: p, value: p }))}
              onPick={(s) => onChange({ city, province: s.value })}
            />
        )}
      </Field>
    </>
  );
}

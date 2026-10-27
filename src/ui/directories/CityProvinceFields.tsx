// Поля «Город» и «Провинция» — выбор из справочника «География» с поиском при вводе и «+ Добавить…» последним пунктом
// (новый город или провинция попадают в справочник при сохранении карточки, `resolveCityPair`).
// Выбранная провинция сужает список городов до своих; выбор города подставляет его провинцию (у тёзок — самого крупного,
// одноимённые города разных провинций без выбранной провинции подсказываются как «Taizhou — Zhejiang»).
// Смена провинции снимает город справочника из другой провинции. Возвращает два поля подряд — ставится внутрь FormGrid.

import { useMemo } from 'react';
import type { City } from '../../domain/model';
import { AddableSelect, type SelectOption } from '../components';
import { applyCityInput, cityOptions, cityProvinces, findCity, listProvinces, normalizeName, type CityDraft } from './cityLookup';

export const ADD_CITY_LABEL = '+ Добавить город…';
export const ADD_PROVINCE_LABEL = '+ Добавить провинцию…';

export interface CityProvinceFieldsProps {
  cities: City[];
  city: string | undefined;
  province: string | undefined;
  onChange: (next: CityDraft) => void;
  provinceError?: string;
  /** Провинции для выбора; по умолчанию — провинции из `cities`. */
  provinces?: string[];
}

const sameName = (a: string | undefined, b: string | undefined) => normalizeName(a ?? '') === normalizeName(b ?? '');

/** Пункты списка городов: с выбранной провинцией — только её города, без неё — все (тёзки — «город — провинция»). */
export function cityChoices(cities: City[], province: string | undefined): SelectOption[] {
  if ((province ?? '').trim()) {
    const seen = new Set<string>();
    return cityOptions(cities.filter((c) => sameName(c.province, province)), undefined, Number.POSITIVE_INFINITY)
      .filter((o) => !seen.has(normalizeName(o.city)) && seen.add(normalizeName(o.city)))
      .map((o) => ({ value: o.city, label: o.city }));
  }
  return cityOptions(cities, undefined, Number.POSITIVE_INFINITY).map((o) => ({ value: o.value, label: o.value, hint: o.label || undefined }));
}

export function CityProvinceFields({ cities, city, province, onChange, provinceError, provinces: provinceNames }: CityProvinceFieldsProps) {
  const cityList = useMemo(() => cityChoices(cities, province), [cities, province]);
  const provinces = useMemo(() => provinceNames ?? listProvinces(cities), [cities, provinceNames]);
  const provinceList = useMemo(() => {
    const own = provinces.map((p) => ({ value: p, label: p }));
    // провинция не из справочника (новая или из старых данных) не теряется
    return province && !provinces.some((p) => sameName(p, province)) ? [...own, { value: province, label: province }] : own;
  }, [provinces, province]);
  const name = (city ?? '').trim();
  const unknownCity = name !== '' && !findCity(cities, name);
  const ambiguous = !unknownCity && cityProvinces(cities, name).length > 1;

  const pickCity = (value: string | undefined) => {
    if (!value) { onChange({ city: undefined, province }); return; }
    // город из списка выбранной провинции остаётся в ней, даже если у него есть тёзки крупнее
    if (province && cities.some((c) => sameName(c.city, value) && sameName(c.province, province))) {
      onChange({ city: value, province });
      return;
    }
    onChange(applyCityInput(cities, { city, province }, value));
  };

  const pickProvince = (value: string | undefined) => {
    const keepCity = !name || !value || unknownCity || cities.some((c) => sameName(c.city, name) && sameName(c.province, value));
    onChange({ city: keepCity ? city : undefined, province: value });
  };

  return (
    <>
      <AddableSelect
        label="Город" search value={city} options={cityList} onChange={pickCity}
        onAdd={(n) => onChange({ city: n, province })} addLabel={ADD_CITY_LABEL} inputLabel="Новый город"
        placeholder={province ? 'Города провинции' : 'Все города страны'}
        hint={unknownCity ? 'Нового города нет в справочнике — он добавится при сохранении' : 'Выберите из справочника — провинция подставится сама'}
      />
      <AddableSelect
        label="Провинция" search value={province} options={provinceList} onChange={pickProvince} error={provinceError}
        onAdd={(n) => pickProvince(n)} addLabel={ADD_PROVINCE_LABEL} inputLabel="Новая провинция" required={unknownCity}
        hint={unknownCity ? 'Для нового города выберите провинцию — пара сохранится в справочник'
          : ambiguous ? 'Подставлена провинция самого крупного города с этим названием — другую можно выбрать' : 'Подставляется по городу; выбор провинции сужает список городов'}
      />
    </>
  );
}

// Карточка поставщика: все поля истории 16 (контакты, адрес, банковские реквизиты). Создание и правка.
// Специализаций может быть несколько — в листе одной ячейкой через «; » (`domain/multiValue`).

import { useState } from 'react';
import { F } from '../../domain/labels';
import { Link, useNavigate } from 'react-router-dom';
import { newId } from '../../domain/ids';
import { joinMultiValue, splitMultiValue } from '../../domain/multiValue';
import type { Supplier } from '../../domain/model';
import { useData } from '../DataContext';
import { ConfirmDelete, ErrorBanner, FormGrid, ListSelectField, MultiListSelectField, TextField } from '../components';
import { PlaceFields } from './PlaceFields';
import { citiesOfCountry, defaultCountryName } from './geography';
import { validateCityProvince } from './cityLookup';
import { resolveCityPair } from './cityPair';
import { cleanRecord, validateName, pastValues } from './records';
import { supplierDeleteBlock } from './usage';
import './directories.css';

type Draft = Partial<Supplier>;

export function SupplierCard({ supplier }: { supplier?: Supplier }) {
  const data = useData();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({ ...supplier }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const { ds } = data;

  const text = (key: keyof Supplier) => ({
    value: draft[key] as string | undefined,
    onChange: (v: string) => setDraft((d) => ({ ...d, [key]: v })),
    suggestions: pastValues(data.ds.suppliers.filter((x) => x.id !== supplier?.id), key),   // прежние значения поля у других записей
  });
  const pick = (key: 'companyType' | 'direction', list: 'companyType' | 'direction') => ({
    list,
    value: draft[key],
    placeholder: '—',
    onChange: (v: string | undefined) => setDraft((d) => ({ ...d, [key]: v })),
  });

  // страна по умолчанию — Китай под текущим названием (F3); считается по загруженному набору, а не при открытии формы
  const country = draft.country ?? defaultCountryName(ds);

  const save = async () => {
    const found = { ...validateName(draft.name), ...validateCityProvince(citiesOfCountry(ds, country), draft.city, draft.province) };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const pair = await resolveCityPair(data, draft.city, draft.province, country);
      const record = cleanRecord<Supplier>({
        ...draft,
        ...pair,
        id: supplier?.id ?? newId('sup'),
        name: draft.name ?? '',
        createdAt: supplier?.createdAt ?? new Date().toISOString(),
      } as Supplier);
      await data.save('suppliers', record);
      navigate('/suppliers');
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  return (
    <section className="screen">
      <h1 className="screen__title">Поставщик</h1>
      <form className="ui-card" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <h2 className="ui-card__title">{supplier ? supplier.name : 'Новый поставщик'}</h2>
        {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
        <h2 className="ui-card__section">Основное</h2>
        <FormGrid>
          <TextField label={F.name} required error={errors.name} {...text('name')} />
          <ListSelectField label={F.companyType} {...pick('companyType', 'companyType')} />
          <ListSelectField label={F.direction} {...pick('direction', 'direction')} />
          <MultiListSelectField
            list="specialization" label={F.specialization} values={splitMultiValue(draft.specialization)}
            onChange={(values) => setDraft((d) => ({ ...d, specialization: joinMultiValue(values) }))}
          />
          <TextField label={F.products} multiline {...text('products')} />
          <TextField label={F.priceNote} {...text('priceNote')} />
        </FormGrid>
        <h2 className="ui-card__section">Контакты и адрес</h2>
        <FormGrid>
          <TextField label={F.contactPerson} {...text('contactPerson')} />
          <TextField label={F.phone} type="tel" {...text('phone')} />
          <TextField label={F.email} type="email" {...text('email')} />
          <TextField label={F.website} type="url" {...text('website')} />
          <PlaceFields
            ds={ds} value={{ ...draft, country }} provinceError={errors.province}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          />
          <TextField label={F.address} {...text('address')} />
        </FormGrid>
        <h2 className="ui-card__section">Банковские реквизиты</h2>
        <FormGrid>
          <TextField label={F.bankBeneficiary} {...text('bankBeneficiary')} />
          <TextField label={F.bankName} {...text('bankName')} />
          <TextField label={F.bankAccount} {...text('bankAccount')} />
          <TextField label={F.bankSwift} {...text('bankSwift')} />
          <TextField label={F.bankAddress} {...text('bankAddress')} />
        </FormGrid>
        <h2 className="ui-card__section">Комментарий</h2>
        <TextField label={F.comment} multiline {...text('comment')} />
        <div className="ui-card__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
          <Link className="btn" to="/suppliers">Отмена</Link>
          <span className="ui-card__spacer" />
          {supplier ? (
            <ConfirmDelete
              disabled={busy}
              blockReason={supplierDeleteBlock(ds, supplier.id)}
              onDelete={async () => { await data.remove('suppliers', supplier.id); navigate('/suppliers'); }}
            />
          ) : null}
        </div>
      </form>
    </section>
  );
}

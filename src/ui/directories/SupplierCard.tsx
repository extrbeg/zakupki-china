// Карточка поставщика: все поля истории 16 (контакты, адрес, банковские реквизиты). Создание и правка.

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { newId } from '../../domain/ids';
import type { Supplier } from '../../domain/model';
import { useData } from '../DataContext';
import { ConfirmDelete, ErrorBanner, FormGrid, ListSelectField, TextField } from '../components';
import { CityProvinceFields } from './CityProvinceFields';
import { validateCityProvince } from './cityLookup';
import { resolveCityPair } from './cityPair';
import { cleanRecord, validateName } from './records';
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
  });
  const pick = (key: 'companyType' | 'direction' | 'specialization', list: 'companyType' | 'direction' | 'specialization') => ({
    list,
    value: draft[key],
    placeholder: '—',
    onChange: (v: string | undefined) => setDraft((d) => ({ ...d, [key]: v })),
  });

  const save = async () => {
    const found = { ...validateName(draft.name), ...validateCityProvince(ds.cities, draft.city, draft.province) };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const pair = await resolveCityPair(data, draft.city, draft.province);
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
          <TextField label="Название" required error={errors.name} {...text('name')} />
          <ListSelectField label="Тип компании" {...pick('companyType', 'companyType')} />
          <ListSelectField label="Направление" {...pick('direction', 'direction')} />
          <ListSelectField label="Специализация" {...pick('specialization', 'specialization')} />
          <TextField label="Продукция/услуги" multiline {...text('products')} />
          <TextField label="Цена (заметка)" {...text('priceNote')} />
        </FormGrid>
        <h2 className="ui-card__section">Контакты и адрес</h2>
        <FormGrid>
          <TextField label="Контактное лицо" {...text('contactPerson')} />
          <TextField label="Телефон" type="tel" {...text('phone')} />
          <TextField label="Почта" type="email" {...text('email')} />
          <TextField label="Сайт" type="url" {...text('website')} />
          <CityProvinceFields
            cities={ds.cities} city={draft.city} province={draft.province} provinceError={errors.province}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          />
          <TextField label="Адрес" {...text('address')} />
        </FormGrid>
        <h2 className="ui-card__section">Банковские реквизиты</h2>
        <FormGrid>
          <TextField label="Получатель" {...text('bankBeneficiary')} />
          <TextField label="Банк" {...text('bankName')} />
          <TextField label="Счёт" {...text('bankAccount')} />
          <TextField label="SWIFT" {...text('bankSwift')} />
          <TextField label="Адрес банка" {...text('bankAddress')} />
        </FormGrid>
        <h2 className="ui-card__section">Комментарий</h2>
        <TextField label="Комментарий" multiline {...text('comment')} />
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

// Экран «Поставщики» (маршрут /suppliers): таблица по названию; поиск текста в выбранных полях (ни одно не выбрано — во всех).

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, TextField, type DataColumn } from '../../components';
import type { Supplier } from '../../../domain/model';
import { placeCountry } from '../../directories/geography';
import { NO_SEARCH, searchSuppliers, SUPPLIER_SEARCH_FIELDS, type SupplierSearch, type SupplierSearchField } from '../../directories/supplierList';
import '../../directories/directories.css';

export default function SuppliersScreen() {
  const { ds } = useData();
  const navigate = useNavigate();
  const [search, setSearch] = useState<SupplierSearch>(NO_SEARCH);

  const countryOf = (s: Supplier) => placeCountry(ds, s);
  const rows = useMemo(() => searchSuppliers(ds.suppliers, search, (s) => placeCountry(ds, s)), [ds, search]);
  const toggle = (key: SupplierSearchField) => setSearch((cur) => ({
    ...cur, fields: cur.fields.includes(key) ? cur.fields.filter((f) => f !== key) : [...cur.fields, key],
  }));

  const columns: DataColumn<Supplier>[] = [
    {
      key: 'name', header: 'Название',
      render: (s) => <Link to={`/suppliers/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.name}</Link>,
    },
    { key: 'country', header: 'Страна', render: (s) => countryOf(s) ?? '' },
    { key: 'companyType', header: 'Тип компании', render: (s) => s.companyType ?? '' },
    { key: 'direction', header: 'Направление', render: (s) => s.direction ?? '' },
    { key: 'specialization', header: 'Специализация', render: (s) => s.specialization ?? '' },
  ];

  if (ds.suppliers.length === 0) {
    return (
      <section className="screen">
        <h1 className="screen__title">Поставщики</h1>
        <EmptyState
          title="Поставщиков пока нет"
          text="Добавьте первого поставщика — город и провинцию подскажет справочник."
          actions={[{ label: 'Добавить поставщика', onClick: () => navigate('/suppliers/new') }]}
        />
      </section>
    );
  }

  const active = search.text !== '' || search.fields.length > 0;
  return (
    <section className="screen">
      <h1 className="screen__title">Поставщики</h1>
      <div className="ui-toolbar">
        <TextField
          label="Найти" type="search" value={search.text} onChange={(text) => setSearch((cur) => ({ ...cur, text }))}
          placeholder={search.fields.length ? undefined : 'Во всех полях'}
        />
        <span className="ui-toolbar__spacer" />
        <button type="button" className="btn btn--primary" onClick={() => navigate('/suppliers/new')}>Добавить поставщика</button>
      </div>
      <div className="dir-search-fields" role="group" aria-label="Где искать">
        <span className="dir-search-fields__label">Искать в:</span>
        {SUPPLIER_SEARCH_FIELDS.map((f) => (
          <button
            key={f.key} type="button" className="btn btn--small dir-search-fields__chip"
            aria-pressed={search.fields.includes(f.key)} onClick={() => toggle(f.key)}
          >{f.label}</button>
        ))}
        {active ? <button type="button" className="btn btn--small" onClick={() => setSearch(NO_SEARCH)}>Сбросить</button> : null}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          text="Измените текст поиска или поля, в которых искать."
          actions={[{ label: 'Сбросить поиск', onClick: () => setSearch(NO_SEARCH) }]}
        />
      ) : (
        <>
          {active ? <p className="muted" role="status">Найдено: {rows.length} из {ds.suppliers.length}</p> : null}
          <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} onRowClick={(s) => navigate(`/suppliers/${s.id}`)} />
        </>
      )}
    </section>
  );
}

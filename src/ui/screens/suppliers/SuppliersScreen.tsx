// Экран «Поставщики» (маршрут /suppliers): список по провинциям и городам, поиск и фильтры.

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, SelectField, TextField, type DataColumn } from '../../components';
import type { Supplier } from '../../../domain/model';
import { distinct, filterSuppliers, groupSuppliers, NO_FILTERS, type SupplierFilters } from '../../directories/supplierList';
import { listValues } from '../../directories/records';
import '../../directories/directories.css';

export default function SuppliersScreen() {
  const { ds } = useData();
  const navigate = useNavigate();
  const [f, setF] = useState<SupplierFilters>(NO_FILTERS);

  const provinces = useMemo(() => distinct(ds.suppliers.map((s) => s.province)), [ds.suppliers]);
  const cities = useMemo(
    () => distinct(ds.suppliers.filter((s) => !f.province || (s.province ?? '') === f.province).map((s) => s.city)),
    [ds.suppliers, f.province],
  );
  const specializations = useMemo(
    () => distinct([...listValues(ds, 'specialization'), ...ds.suppliers.map((s) => s.specialization)]),
    [ds],
  );
  const groups = useMemo(() => groupSuppliers(filterSuppliers(ds.suppliers, f)), [ds.suppliers, f]);
  const opts = (values: string[]) => values.map((v) => ({ value: v, label: v }));

  const columns: DataColumn<Supplier>[] = [
    {
      key: 'name', header: 'Название',
      render: (s) => <Link to={`/suppliers/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.name}</Link>,
    },
    { key: 'specialization', header: 'Специализация', render: (s) => s.specialization ?? '' },
    { key: 'contactPerson', header: 'Контактное лицо', render: (s) => s.contactPerson ?? '' },
    { key: 'phone', header: 'Телефон', render: (s) => s.phone ?? '' },
    { key: 'email', header: 'Почта', render: (s) => s.email ?? '' },
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

  const filtered = f.search !== '' || f.province !== '' || f.city !== '' || f.specialization !== '';
  return (
    <section className="screen">
      <h1 className="screen__title">Поставщики</h1>
      <div className="ui-toolbar">
        <TextField label="Поиск по названию" type="search" value={f.search} onChange={(search) => setF({ ...f, search })} />
        <SelectField
          label="Провинция" value={f.province} options={opts(provinces)} placeholder="Все"
          onChange={(v) => setF({ ...f, province: v ?? '', city: '' })}
        />
        <SelectField label="Город" value={f.city} options={opts(cities)} placeholder="Все" onChange={(v) => setF({ ...f, city: v ?? '' })} />
        <SelectField
          label="Специализация" value={f.specialization} options={opts(specializations)} placeholder="Все"
          onChange={(v) => setF({ ...f, specialization: v ?? '' })}
        />
        <span className="ui-toolbar__spacer" />
        <button type="button" className="btn btn--primary" onClick={() => navigate('/suppliers/new')}>Добавить поставщика</button>
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title="Ничего не найдено"
          text="Измените поиск или фильтры."
          actions={filtered ? [{ label: 'Сбросить фильтры', onClick: () => setF(NO_FILTERS) }] : []}
        />
      ) : (
        groups.map((p) => (
          <div className="dir-group" key={p.province}>
            <h2 className="dir-group__province">{p.province}</h2>
            {p.cities.map((c) => (
              <div key={c.city}>
                <h3 className="dir-group__city">{c.city}</h3>
                <DataTable
                  columns={columns} rows={c.suppliers} rowKey={(s) => s.id}
                  onRowClick={(s) => navigate(`/suppliers/${s.id}`)}
                />
              </div>
            ))}
          </div>
        ))
      )}
    </section>
  );
}

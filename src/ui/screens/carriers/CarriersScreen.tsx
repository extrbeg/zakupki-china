// Экран «Перевозчики» (маршрут /carriers): список с поиском и карточка на этой же странице.

import { useMemo, useState } from 'react';
import { F } from '../../../domain/labels';
import type { Carrier } from '../../../domain/model';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, TextField, type DataColumn } from '../../components';
import { compareRu, normalizeName } from '../../directories/cityLookup';
import { ruDate } from '../../format';
import { CarrierCard } from './CarrierCard';
import '../../directories/directories.css';

type Open = { mode: 'new' } | { mode: 'edit'; id: string } | null;

const contractText = (c: Carrier) =>
  [c.contractSigned ? 'подписан' : '', c.contractValidUntil ? `до ${ruDate(c.contractValidUntil)}` : ''].filter(Boolean).join(', ');

const columns: DataColumn<Carrier>[] = [
  { key: 'name', header: F.name, render: (c) => c.name },
  { key: 'type', header: 'Тип', render: (c) => c.type ?? '' },
  { key: 'specialization', header: 'Специализация', render: (c) => c.specialization ?? '' },
  { key: 'phone', header: 'Телефон', render: (c) => c.phone ?? '' },
  { key: 'contract', header: 'Договор', render: contractText },
];

export default function CarriersScreen() {
  const { ds } = useData();
  const [open, setOpen] = useState<Open>(null);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = normalizeName(search);
    return ds.carriers.filter((c) => !q || normalizeName(c.name).includes(q)).sort((a, b) => compareRu(a.name, b.name));
  }, [ds.carriers, search]);
  const editing = open?.mode === 'edit' ? ds.carriers.find((c) => c.id === open.id) : undefined;
  const close = () => setOpen(null);

  return (
    <section className="screen">
      <h1 className="screen__title">Перевозчики</h1>
      {open ? <CarrierCard key={open.mode === 'edit' ? open.id : 'new'} carrier={editing} onClose={close} /> : null}
      {ds.carriers.length === 0 ? (
        open ? null : (
          <EmptyState
            title="Перевозчиков пока нет"
            actions={[{ label: 'Добавить перевозчика', onClick: () => setOpen({ mode: 'new' }) }]}
          />
        )
      ) : (
        <>
          <div className="ui-toolbar">
            <TextField label="Поиск по названию" type="search" value={search} onChange={setSearch} />
            <span className="ui-toolbar__spacer" />
            <button type="button" className="btn btn--primary" onClick={() => setOpen({ mode: 'new' })}>Добавить перевозчика</button>
          </div>
          <DataTable
            columns={columns} rows={rows} rowKey={(c) => c.id} onRowClick={(c) => setOpen({ mode: 'edit', id: c.id })}
            empty="Ничего не найдено"
          />
        </>
      )}
    </section>
  );
}

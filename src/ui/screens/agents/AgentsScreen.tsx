// Экран «Платёжные агенты» (маршрут /agents): список с поиском и карточка на этой же странице.

import { useMemo, useState } from 'react';
import type { PaymentAgent } from '../../../domain/model';
import { useData } from '../../DataContext';
import { DataTable, EmptyState, TextField, type DataColumn } from '../../components';
import { compareRu, normalizeName } from '../../directories/cityLookup';
import { AgentCard } from './AgentCard';
import '../../directories/directories.css';

type Open = { mode: 'new' } | { mode: 'edit'; id: string } | null;

const columns: DataColumn<PaymentAgent>[] = [
  { key: 'name', header: 'Наименование', render: (a) => a.name },
  { key: 'contactPerson', header: 'Контактное лицо', render: (a) => a.contactPerson ?? '' },
  { key: 'city', header: 'Город', render: (a) => [a.city, a.province].filter(Boolean).join(', ') },
  { key: 'phone', header: 'Телефон', render: (a) => a.phone ?? '' },
  { key: 'email', header: 'Email', render: (a) => a.email ?? '' },
];

export default function AgentsScreen() {
  const { ds } = useData();
  const [open, setOpen] = useState<Open>(null);
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = normalizeName(search);
    return ds.agents.filter((a) => !q || normalizeName(a.name).includes(q)).sort((a, b) => compareRu(a.name, b.name));
  }, [ds.agents, search]);
  const editing = open?.mode === 'edit' ? ds.agents.find((a) => a.id === open.id) : undefined;
  const close = () => setOpen(null);

  return (
    <section className="screen">
      <h1 className="screen__title">Платёжные агенты</h1>
      {open ? <AgentCard key={open.mode === 'edit' ? open.id : 'new'} agent={editing} onClose={close} /> : null}
      {ds.agents.length === 0 ? (
        open ? null : (
          <EmptyState
            title="Платёжных агентов пока нет"
            actions={[{ label: 'Добавить агента', onClick: () => setOpen({ mode: 'new' }) }]}
          />
        )
      ) : (
        <>
          <div className="ui-toolbar">
            <TextField label="Поиск по названию" type="search" value={search} onChange={setSearch} />
            <span className="ui-toolbar__spacer" />
            <button type="button" className="btn btn--primary" onClick={() => setOpen({ mode: 'new' })}>Добавить агента</button>
          </div>
          <DataTable
            columns={columns} rows={rows} rowKey={(a) => a.id} onRowClick={(a) => setOpen({ mode: 'edit', id: a.id })}
            empty="Ничего не найдено"
          />
        </>
      )}
    </section>
  );
}

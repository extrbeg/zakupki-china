// Один редактируемый список: переименование по месту, порядок кнопками, добавление и удаление.

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { newId } from '../../domain/ids';
import type { ListItem, ListKey } from '../../domain/model';
import { useData } from '../DataContext';
import { ErrorBanner, TextField } from '../components';
import { moveItem, nextOrder, sortItems, validateListValue } from './listOps';
import './directories.css';

interface RowProps {
  item: ListItem;
  index: number;
  count: number;
  label: string;
  items: ListItem[];
  onRename: (item: ListItem, value: string) => void;
  onMove: (item: ListItem, direction: -1 | 1) => void;
  onRemove: (item: ListItem) => void;
}

function ListRow({ item, index, count, label, items, onRename, onMove, onRemove }: RowProps) {
  const [draft, setDraft] = useState(item.value);
  useEffect(() => setDraft(item.value), [item.value]);
  const error = validateListValue(items, draft, item.id);
  const commit = () => {
    if (error || draft.trim() === item.value) return;
    onRename(item, draft.trim());
  };
  return (
    <div className="list-row">
      <input
        className="input list-row__input" type="text" data-role="value" value={draft}
        aria-label={`${label}: значение ${index + 1}`} aria-invalid={error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setDraft(item.value);
        }}
      />
      <button type="button" className="btn btn--small" disabled={index === 0} aria-label={`Поднять: ${item.value}`} onClick={() => onMove(item, -1)}>↑</button>
      <button type="button" className="btn btn--small" disabled={index === count - 1} aria-label={`Опустить: ${item.value}`} onClick={() => onMove(item, 1)}>↓</button>
      <button type="button" className="btn btn--small btn--danger" aria-label={`Удалить: ${item.value}`} onClick={() => onRemove(item)}>Удалить</button>
      {error ? <div className="field__error list-row__error">{error}</div> : null}
    </div>
  );
}

export function ListEditor({ listKey, label }: { listKey: ListKey; label: string }) {
  const { ds, save, remove } = useData();
  const items = useMemo(() => sortItems(ds.lists.filter((l) => l.list === listKey)), [ds.lists, listKey]);
  const [newValue, setNewValue] = useState('');
  const [addError, setAddError] = useState('');
  const [failure, setFailure] = useState<unknown>(undefined);

  const attempt = async (fn: () => Promise<void>) => {
    setFailure(undefined);
    try {
      await fn();
    } catch (e) {
      setFailure(e);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const error = validateListValue(items, newValue);
    setAddError(error);
    if (error) return;
    void attempt(async () => {
      await save('lists', { id: newId('lst'), list: listKey, value: newValue.trim(), order: nextOrder(items) });
      setNewValue('');
    });
  };

  return (
    <section className="ui-card" aria-label={label}>
      <h2 className="ui-card__title">{label}</h2>
      {failure !== undefined ? <ErrorBanner error={failure} /> : null}
      {items.length === 0 ? <p className="muted small">Значений пока нет.</p> : null}
      {items.map((item, i) => (
        <ListRow
          key={item.id} item={item} index={i} count={items.length} label={label} items={items}
          onRename={(it, value) => void attempt(() => save('lists', { ...it, value }))}
          onMove={(it, dir) => void attempt(async () => {
            for (const changed of moveItem(items, it.id, dir)) await save('lists', changed);
          })}
          onRemove={(it) => void attempt(() => remove('lists', it.id))}
        />
      ))}
      <form className="list-add" onSubmit={add} noValidate>
        <TextField label="Новое значение" value={newValue} error={addError || undefined} onChange={(v) => { setNewValue(v); setAddError(''); }} />
        <button type="submit" className="btn">Добавить</button>
      </form>
    </section>
  );
}

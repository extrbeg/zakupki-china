// Экран «География» (маршрут /geography, G21): страны → провинции страны → города провинции.
// Поиск по названию, добавить, переименовать (вместе с городами и местами поставщиков/агентов), удалить — если не используется.

import { useMemo, useState, type FormEvent } from 'react';
import { newId } from '../../../domain/ids';
import { useData } from '../../DataContext';
import { ConfirmDelete, ErrorBanner, Highlight, TextField } from '../../components';
import {
  cityDeleteBlock, citiesOfProvince, countryDeleteBlock, provinceDeleteBlock, provincesOfCountry, renameCity, renameCountry,
  renameProvince, searchGeography, sortedCountries, validateGeoName, type GeoChange, type GeoHit,
} from './geographyLogic';
import '../../directories/directories.css';
import './geography.css';

interface Item { id: string; name: string }

interface ColumnProps {
  region: string;
  title: string;
  items: Item[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  emptyText: string;
  addLabel: string;
  addButton: string;
  busy: boolean;
  onAdd: (name: string) => Promise<boolean>;
  /** true — записано; false — сбой (ошибка уже показана), поле остаётся открытым для повтора. */
  onRename: (item: Item, name: string) => Promise<boolean>;
  blockReason: (item: Item) => string | null;
  onDelete: (item: Item) => Promise<void>;
}

function Row({ item, items, selected, onSelect, busy, onRename, blockReason, onDelete }: {
  item: Item; items: Item[]; selected: boolean; busy: boolean; onSelect?: (id: string) => void;
  onRename: ColumnProps['onRename']; blockReason: ColumnProps['blockReason']; onDelete: ColumnProps['onDelete'];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.name);
  const [error, setError] = useState('');

  const save = async () => {
    const found = validateGeoName(items, draft, item.id);
    setError(found);
    if (found) return;
    if (draft.trim() !== item.name && !(await onRename(item, draft))) return;
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="geo-item">
        <input
          className="input geo-item__input" type="text" value={draft} aria-label={`Новое название: ${item.name}`} aria-invalid={error ? true : undefined}
          onChange={(e) => { setDraft(e.target.value); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void save(); }
            if (e.key === 'Escape') { setEditing(false); setDraft(item.name); setError(''); }
          }}
        />
        <button type="button" className="btn btn--small btn--primary" disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button type="button" className="btn btn--small" onClick={() => { setEditing(false); setDraft(item.name); setError(''); }}>Отмена</button>
        {error ? <div className="field__error geo-item__error">{error}</div> : null}
      </li>
    );
  }
  return (
    <li className={selected ? 'geo-item geo-item--active' : 'geo-item'}>
      {onSelect ? (
        <button type="button" className="btn btn--link geo-item__name" aria-pressed={selected} onClick={() => onSelect(item.id)}>{item.name}</button>
      ) : (
        <span className="geo-item__name">{item.name}</span>
      )}
      <button type="button" className="btn btn--small" aria-label={`Переименовать: ${item.name}`} disabled={busy} onClick={() => { setDraft(item.name); setEditing(true); }}>
        Переименовать
      </button>
      <ConfirmDelete small ariaLabel={`Удалить: ${item.name}`} disabled={busy} blockReason={blockReason(item)} onDelete={() => onDelete(item)} />
    </li>
  );
}

function Column(props: ColumnProps) {
  const { region, title, items, selectedId, onSelect, emptyText, addLabel, addButton, busy, onAdd } = props;
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateGeoName(items, name);
    setError(found);
    if (found) return;
    if (await onAdd(name.trim())) setName('');
  };

  return (
    <section className="ui-card geo-column" aria-label={region}>
      <h2 className="ui-card__title">{title}</h2>
      {items.length === 0 ? <p className="muted small">{emptyText}</p> : null}
      <ul className="geo-list">
        {items.map((item) => (
          <Row
            key={item.id} item={item} items={items} selected={item.id === selectedId} onSelect={onSelect} busy={busy}
            onRename={props.onRename} blockReason={props.blockReason} onDelete={props.onDelete}
          />
        ))}
      </ul>
      <form className="list-add" onSubmit={(e) => void add(e)} noValidate>
        <TextField label={addLabel} value={name} error={error || undefined} onChange={(v) => { setName(v); setError(''); }} />
        <button type="submit" className="btn" disabled={busy}>{addButton}</button>
      </form>
    </section>
  );
}

function SearchResults({ hits, query, onPick }: { hits: GeoHit[]; query: string; onPick: (hit: GeoHit) => void }) {
  return (
    <section className="ui-card" aria-label="Найдено">
      <h2 className="ui-card__title">Найдено</h2>
      {hits.length === 0 ? <p className="muted small">Ничего не найдено.</p> : (
        <ul className="geo-list">
          {hits.map((h) => (
            <li key={`${h.kind}:${h.id}`} className="geo-item">
              <button type="button" className="btn btn--link geo-item__name" aria-label={h.path ? `${h.name} — ${h.path}` : h.name} onClick={() => onPick(h)}>
                <Highlight text={h.name} query={query} />{h.path ? ` — ${h.path}` : ''}
              </button>
              <span className="muted small">{h.kind === 'country' ? 'страна' : h.kind === 'province' ? 'провинция' : 'город'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function GeographyScreen() {
  const data = useData();
  const { ds } = data;
  const countries = useMemo(() => sortedCountries(ds), [ds]);
  const [countryPick, setCountryPick] = useState<string | null>(null);
  const [provincePick, setProvincePick] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(undefined);

  const country = countries.find((c) => c.id === countryPick) ?? countries[0];
  const provinces = useMemo(() => (country ? provincesOfCountry(ds, country.id) : []), [ds, country]);
  const province = provinces.find((p) => p.id === provincePick);
  const cities = useMemo(() => (country && province ? citiesOfProvince(ds, country.id, province.name) : []), [ds, country, province]);
  const hits = useMemo(() => searchGeography(ds, query), [ds, query]);

  const run = async (fn: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setFailure(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setFailure(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  // Переименование и всё, что ссылается на старое название, — по одной записи; сама сущность — последней (geographyLogic).
  // Сбой на середине: поле остаётся открытым, повтор пересчитывает изменения по текущему набору и дописывает оставшиеся.
  const apply = (changes: GeoChange[]) => run(async () => {
    for (const c of changes) await data.save(c.entity, c.record as never);
  });

  const selectCountry = (id: string) => { setCountryPick(id); setProvincePick(null); };
  const pickHit = (hit: GeoHit) => {
    setCountryPick(hit.countryId);
    const p = hit.kind === 'province' ? ds.provinces.find((x) => x.id === hit.id)
      : hit.kind === 'city' ? provincesOfCountry(ds, hit.countryId).find((x) => x.name.trim().toLowerCase() === (hit.province ?? '').trim().toLowerCase())
        : undefined;
    setProvincePick(p?.id ?? null);
  };

  const cityItems = cities.map((c) => ({ id: c.id, name: c.city }));

  return (
    <section className="screen">
      <h1 className="screen__title">География</h1>
      <p className="muted">
        Страны, их провинции и города. По ним подсказывается город у поставщиков и агентов, провинция подставляется сама.
        Переименование меняет название и у поставщиков и агентов; удалить можно только то, что нигде не используется.
      </p>
      {failure !== undefined ? <ErrorBanner error={failure} /> : null}
      <TextField label="Поиск по названию" type="search" value={query} onChange={setQuery} placeholder="страна, провинция или город" />
      {query.trim() ? <SearchResults hits={hits} query={query} onPick={pickHit} /> : null}
      <div className="geo-columns">
        <Column
          region="Страны" title="Страны" items={countries} selectedId={country?.id} onSelect={selectCountry}
          emptyText="Стран пока нет." addLabel="Новая страна" addButton="Добавить страну" busy={busy}
          onAdd={(name) => run(() => data.save('countries', { id: newId('cnt'), name }))}
          onRename={(item, name) => apply(renameCountry(ds, item.id, name))}
          blockReason={(item) => countryDeleteBlock(ds, item.id)}
          onDelete={async (item) => { await data.remove('countries', item.id); if (countryPick === item.id) selectCountry(''); }}
        />
        {country ? (
          <Column
            region="Провинции" title={`Провинции: ${country.name}`} items={provinces} selectedId={province?.id} onSelect={setProvincePick}
            emptyText="Провинций пока нет." addLabel="Новая провинция" addButton="Добавить провинцию" busy={busy}
            onAdd={(name) => run(() => data.save('provinces', { id: newId('prv'), name, countryId: country.id }))}
            onRename={(item, name) => apply(renameProvince(ds, item.id, name))}
            blockReason={(item) => provinceDeleteBlock(ds, item.id)}
            onDelete={async (item) => { await data.remove('provinces', item.id); if (provincePick === item.id) setProvincePick(null); }}
          />
        ) : null}
        {country && province ? (
          <Column
            region="Города" title={`Города: ${province.name}`} items={cityItems}
            emptyText="Городов пока нет." addLabel="Новый город" addButton="Добавить город" busy={busy}
            onAdd={(name) => run(() => data.save('cities', { id: newId('city'), city: name, province: province.name, countryId: country.id }))}
            onRename={(item, name) => apply(renameCity(ds, item.id, name))}
            blockReason={(item) => cityDeleteBlock(ds, item.id)}
            onDelete={(item) => data.remove('cities', item.id)}
          />
        ) : country ? (
          <section className="ui-card geo-column" aria-label="Города">
            <h2 className="ui-card__title">Города</h2>
            <p className="muted small">Выберите провинцию — здесь появятся её города.</p>
          </section>
        ) : null}
      </div>
    </section>
  );
}

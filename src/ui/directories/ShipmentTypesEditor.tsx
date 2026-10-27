// «Списки» → «Типы поставки» (G29): название и правило деления доставки; переименование по месту,
// добавление, удаление (запрещено, если тип используется в поставках). Переименование поставки не меняет: они ссылаются на тип по id.

import { useEffect, useState, type FormEvent } from 'react';
import { newId } from '../../domain/ids';
import type { ShipmentBasis, ShipmentType } from '../../domain/model';
import { BASIS_OPTIONS, shipmentTypesOf } from '../../domain/shipmentTypes';
import { useData } from '../DataContext';
import { ConfirmDelete, ErrorBanner, TextField } from '../components';
import { shipmentTypeDeleteBlock, storeDefaultTypes, validateShipmentTypeName } from './shipmentTypes';
import './directories.css';

const TITLE = 'Типы поставки';

function TypeRow({ type, types, blockReason, onSave, onRemove }: {
  type: ShipmentType; types: ShipmentType[]; blockReason: string | null;
  onSave: (t: ShipmentType) => void; onRemove: (t: ShipmentType) => Promise<void>;
}) {
  const [draft, setDraft] = useState(type.name);
  useEffect(() => setDraft(type.name), [type.name]);
  const error = validateShipmentTypeName(types, draft, type.id);
  const commit = () => {
    if (error || draft.trim() === type.name) return;
    onSave({ ...type, name: draft.trim() });
  };
  return (
    <div className="list-row">
      <input
        className="input list-row__input" type="text" data-role="value" value={draft}
        aria-label={`Тип поставки: ${type.name}`} aria-invalid={error ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setDraft(type.name);
        }}
      />
      <select
        className="input" aria-label={`Делить доставку: ${type.name}`} value={type.basis}
        onChange={(e) => onSave({ ...type, basis: e.target.value as ShipmentBasis })}
      >
        {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ConfirmDelete small ariaLabel={`Удалить: ${type.name}`} blockReason={blockReason} onDelete={() => onRemove(type)} />
      {error ? <div className="field__error list-row__error">{error}</div> : null}
    </div>
  );
}

export function ShipmentTypesEditor() {
  const { ds, save, remove } = useData();
  const types = shipmentTypesOf(ds);
  const [name, setName] = useState('');
  const [basis, setBasis] = useState<ShipmentBasis>('cbm');
  const [addError, setAddError] = useState('');
  const [failure, setFailure] = useState<unknown>(undefined);

  /** Справочник ещё пуст (показаны заранее заведённые) — записать их вместе с правкой; иначе — только правку. */
  const attempt = async (fn: () => Promise<void>, change: { put?: ShipmentType; drop?: string } = {}) => {
    setFailure(undefined);
    try {
      const stored = await storeDefaultTypes(ds, save, change);
      if (!stored || (!change.put && !change.drop)) await fn();
    } catch (e) {
      setFailure(e);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const error = validateShipmentTypeName(types, name);
    setAddError(error);
    if (error) return;
    void attempt(async () => {
      await save('shipmentTypes', { id: newId('stp'), name: name.trim(), basis });
      setName('');
      setBasis('cbm');
    });
  };

  return (
    <section className="ui-card" aria-label={TITLE}>
      <h2 className="ui-card__title">{TITLE}</h2>
      <p className="muted small">Правило типа — как делить доставку поставки между партиями: по объёму (CBM) или по весу.</p>
      {failure !== undefined ? <ErrorBanner error={failure} /> : null}
      {types.map((t) => (
        <TypeRow
          key={t.id} type={t} types={types} blockReason={shipmentTypeDeleteBlock(ds, t.id)}
          onSave={(next) => void attempt(() => save('shipmentTypes', next), { put: next })}
          onRemove={(it) => attempt(() => remove('shipmentTypes', it.id), { drop: it.id })}
        />
      ))}
      <form className="list-add" onSubmit={add} noValidate>
        <TextField label="Новый тип поставки" value={name} error={addError || undefined} onChange={(v) => { setName(v); setAddError(''); }} />
        <select className="input" aria-label="Делить доставку" value={basis} onChange={(e) => setBasis(e.target.value as ShipmentBasis)}>
          {BASIS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="submit" className="btn">Добавить</button>
      </form>
    </section>
  );
}

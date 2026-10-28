// Карточка перевозчика (история 64): создание и правка внутри экрана списка.

import { useState } from 'react';
import { F } from '../../../domain/labels';
import { newId } from '../../../domain/ids';
import type { Carrier } from '../../../domain/model';
import { useData } from '../../DataContext';
import { CheckboxField, ConfirmDelete, DateField, ErrorBanner, FormGrid, TextField } from '../../components';
import { cleanRecord, validateName, pastValues } from '../../directories/records';
import { carrierDeleteBlock } from '../../directories/usage';
import '../../directories/directories.css';

export function CarrierCard({ carrier, onClose }: { carrier?: Carrier; onClose: () => void }) {
  const data = useData();
  const { ds } = data;
  const [draft, setDraft] = useState<Partial<Carrier>>(() => ({ ...carrier }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const text = (key: keyof Carrier) => ({
    value: draft[key] as string | undefined,
    onChange: (v: string) => setDraft((d) => ({ ...d, [key]: v })),
    suggestions: pastValues(data.ds.carriers.filter((x) => x.id !== carrier?.id), key),   // прежние значения поля у других записей
  });

  const save = async () => {
    const found = validateName(draft.name);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      await data.save('carriers', cleanRecord<Carrier>({ ...draft, id: carrier?.id ?? newId('car'), name: draft.name ?? '' } as Carrier));
      onClose();
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  return (
    <form className="ui-card" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h2 className="ui-card__title">{carrier ? carrier.name : 'Новый перевозчик'}</h2>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        <TextField label={F.name} required error={errors.name} {...text('name')} />
        <TextField label={F.carrierType} {...text('type')} />
        <TextField label={F.specialization} {...text('specialization')} />
        <TextField label={F.contactPerson} {...text('contactPerson')} />
        <TextField label={F.phone} type="tel" {...text('phone')} />
        <TextField label={F.email} type="email" {...text('email')} />
        <TextField label={F.website} type="url" {...text('website')} />
        <TextField label={F.contracts} multiline {...text('contracts')} />
        <DateField
          label={F.contractValidUntil} value={draft.contractValidUntil}
          onChange={(v) => setDraft((d) => ({ ...d, contractValidUntil: v }))}
        />
        <CheckboxField
          label={F.contractSigned} checked={draft.contractSigned ?? false}
          onChange={(v) => setDraft((d) => ({ ...d, contractSigned: v }))}
        />
        <TextField label={F.comment} multiline className="ui-card__full" {...text('comment')} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <span className="ui-card__spacer" />
        {carrier ? (
          <ConfirmDelete
            disabled={busy} blockReason={carrierDeleteBlock(ds, carrier.id)}
            onDelete={async () => { await data.remove('carriers', carrier.id); onClose(); }}
          />
        ) : null}
      </div>
    </form>
  );
}

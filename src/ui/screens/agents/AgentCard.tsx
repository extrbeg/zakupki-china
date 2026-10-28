// Карточка платёжного агента (история 64): создание и правка внутри экрана списка.

import { useState } from 'react';
import { F } from '../../../domain/labels';
import { newId } from '../../../domain/ids';
import type { PaymentAgent } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, ErrorBanner, FormGrid, TextField } from '../../components';
import { PlaceFields } from '../../directories/PlaceFields';
import { citiesOfCountry, defaultCountryName } from '../../directories/geography';
import { validateCityProvince } from '../../directories/cityLookup';
import { resolveCityPair } from '../../directories/cityPair';
import { cleanRecord, validateName, pastValues } from '../../directories/records';
import { agentDeleteBlock } from '../../directories/usage';
import '../../directories/directories.css';

export function AgentCard({ agent, onClose }: { agent?: PaymentAgent; onClose: () => void }) {
  const data = useData();
  const { ds } = data;
  const [draft, setDraft] = useState<Partial<PaymentAgent>>(() => ({ ...agent }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);

  const text = (key: keyof PaymentAgent) => ({
    value: draft[key] as string | undefined,
    onChange: (v: string) => setDraft((d) => ({ ...d, [key]: v })),
    suggestions: pastValues(data.ds.agents.filter((x) => x.id !== agent?.id), key),   // прежние значения поля у других записей
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
      await data.save('agents', cleanRecord<PaymentAgent>({ ...draft, ...pair, id: agent?.id ?? newId('agt'), name: draft.name ?? '' } as PaymentAgent));
      onClose();
    } catch (e) {
      setSaveError(e);
      setBusy(false);
    }
  };

  return (
    <form className="ui-card" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h2 className="ui-card__title">{agent ? agent.name : 'Новый платёжный агент'}</h2>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <FormGrid>
        <TextField label={F.name} required error={errors.name} {...text('name')} />
        <TextField label={F.contactPerson} {...text('contactPerson')} />
        <TextField label={F.legalAddress} {...text('legalAddress')} />
        <PlaceFields
          ds={ds} value={{ ...draft, country }} provinceError={errors.province}
          onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
        />
        <TextField label={F.phone} type="tel" {...text('phone')} />
        <TextField label={F.email} type="email" {...text('email')} />
        <TextField label={F.requisites} multiline className="ui-card__full" {...text('requisites')} />
        <TextField label={F.comment} multiline className="ui-card__full" {...text('comment')} />
      </FormGrid>
      <div className="ui-card__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить</button>
        <button type="button" className="btn" onClick={onClose}>Отмена</button>
        <span className="ui-card__spacer" />
        {agent ? (
          <ConfirmDelete
            disabled={busy} blockReason={agentDeleteBlock(ds, agent.id)}
            onDelete={async () => { await data.remove('agents', agent.id); onClose(); }}
          />
        ) : null}
      </div>
    </form>
  );
}

// Карточка платёжного агента (история 64): создание и правка внутри экрана списка.

import { useState } from 'react';
import { newId } from '../../../domain/ids';
import type { PaymentAgent } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ConfirmDelete, ErrorBanner, FormGrid, TextField } from '../../components';
import { CityProvinceFields } from '../../directories/CityProvinceFields';
import { validateCityProvince } from '../../directories/cityLookup';
import { resolveCityPair } from '../../directories/cityPair';
import { cleanRecord, validateName } from '../../directories/records';
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
  });

  const save = async () => {
    const found = { ...validateName(draft.name), ...validateCityProvince(ds.cities, draft.city, draft.province) };
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const pair = await resolveCityPair(data, draft.city, draft.province);
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
        <TextField label="Наименование" required error={errors.name} {...text('name')} />
        <TextField label="Контактное лицо" {...text('contactPerson')} />
        <TextField label="Юридический адрес" {...text('legalAddress')} />
        <CityProvinceFields
          cities={ds.cities} city={draft.city} province={draft.province} provinceError={errors.province}
          onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
        />
        <TextField label="Телефон" type="tel" {...text('phone')} />
        <TextField label="Email" type="email" {...text('email')} />
        <TextField label="Реквизиты" multiline className="ui-card__full" {...text('requisites')} />
        <TextField label="Комментарий" multiline className="ui-card__full" {...text('comment')} />
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

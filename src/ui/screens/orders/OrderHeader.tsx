// Шапка заказа: номер, дата, подразделение, плательщик, заказчик, название, ID задачи Битрикс, дата расчёта, «Все затраты внесены».
// Дата расчёта и флаг «Все затраты внесены» у существующего заказа сохраняются сразу — итоги пересчитываются без нажатия «Сохранить».

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId } from '../../../domain/ids';
import type { Order } from '../../../domain/model';
import { validateOrderNumberUnique } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { CheckboxField, ConfirmDelete, DateField, ErrorBanner, FormGrid, NumberField, SelectField, TextField, isBadNumber } from '../../components';
import { listOptions } from '../../directories/records';
import { bitrixTaskUrl, compact, nextOrderNumber, orderDeleteBlock } from './orderLogic';

interface Draft {
  /** Как отдаёт NumberField: пусто — undefined, не число — NaN. */
  number: number | undefined; date: string | undefined; department?: string; payer?: string; customer?: string; title: string;
  bitrixTaskId: string; calcDate?: string; costsComplete: boolean; comment: string;
}

export function OrderHeader({ order }: { order?: Order }) {
  const data = useData();
  const { ds } = data;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({
    number: order ? order.number : nextOrderNumber(ds.orders),
    date: order?.date ?? data.today,
    department: order?.department, payer: order?.payer, customer: order?.customer,
    title: order?.title ?? '', bitrixTaskId: order?.bitrixTaskId ?? '', calcDate: order?.calcDate,
    costsComplete: order?.costsComplete ?? false, comment: order?.comment ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  /** Сразу записать поле существующего заказа (остальное — по кнопке). */
  const quick = async (p: Partial<Pick<Order, 'calcDate' | 'costsComplete'>>) => {
    if (!order) return;
    const current = ds.orders.find((o) => o.id === order.id) ?? order;
    setSaveError(undefined);
    try {
      await data.save('orders', compact({ ...current, ...p, calcDate: 'calcDate' in p ? p.calcDate : current.calcDate }) as Order);
    } catch (e) {
      setSaveError(e);
    }
  };

  const save = async () => {
    const found: Record<string, string> = {};
    const number = draft.number;
    const id = order?.id ?? newId('ord');
    if (number === undefined || isBadNumber(number)) found.number = 'Введите номер заказа — целое число';
    else Object.assign(found, validateOrderNumberUnique(ds, { id, number }));
    if (!draft.date) found.date = 'Укажите дату заказа';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const record = compact<Order>({
        ...order,
        id,
        number: number as number,
        date: draft.date as string,
        department: draft.department, payer: draft.payer, customer: draft.customer,
        title: draft.title, bitrixTaskId: draft.bitrixTaskId, calcDate: draft.calcDate,
        costsComplete: draft.costsComplete, comment: draft.comment,
        createdAt: order?.createdAt ?? new Date().toISOString(),
      });
      await data.save('orders', record);
      if (!order) navigate(`/orders/${id}`, { replace: true });
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  const link = bitrixTaskUrl(ds.settings.bitrixPortalUrl, draft.bitrixTaskId);
  const pick = (key: 'department' | 'payer' | 'customer', label: string) => (
    <SelectField label={label} value={draft[key]} options={listOptions(ds, key)} placeholder="—" onChange={(v) => patch({ [key]: v })} />
  );

  return (
    <section className="ui-card" aria-label="Шапка заказа">
      <h2 className="ui-card__title">{order ? `Заказ № ${order.number}` : 'Новый заказ'}</h2>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <FormGrid>
          <NumberField label="Номер заказа" required value={draft.number} onChange={(v) => patch({ number: v })} error={errors.number} />
          <DateField label="Дата заказа" required value={draft.date} onChange={(v) => patch({ date: v })} error={errors.date} />
          {pick('department', 'Подразделение')}
          {pick('payer', 'Плательщик')}
          {pick('customer', 'Заказчик')}
          <TextField label="Название" value={draft.title} onChange={(v) => patch({ title: v })} />
          <div>
            <TextField label="ID задачи Битрикс24" value={draft.bitrixTaskId} onChange={(v) => patch({ bitrixTaskId: v })} />
            {link ? <a className="order-link" href={link} target="_blank" rel="noreferrer">Задача {draft.bitrixTaskId.trim()} в Битрикс24</a> : null}
          </div>
          <DateField
            label="Дата расчёта" value={draft.calcDate} hint="Курсы плановых затрат берутся на эту дату; пусто — сегодня"
            onChange={(v) => { patch({ calcDate: v }); void quick({ calcDate: v }); }}
          />
          <CheckboxField
            label="Все затраты внесены" checked={draft.costsComplete}
            onChange={(c) => { patch({ costsComplete: c }); void quick({ costsComplete: c }); }}
          />
          <TextField label="Комментарий" multiline value={draft.comment} onChange={(v) => patch({ comment: v })} />
        </FormGrid>
        <div className="ui-card__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>Сохранить заказ</button>
          {order ? (
            <>
              <span className="ui-card__spacer" />
              <ConfirmDelete
                label="Удалить заказ" blockReason={orderDeleteBlock(ds, order.id)}
                onDelete={async () => { await data.remove('orders', order.id); navigate('/'); }}
              />
            </>
          ) : null}
        </div>
      </form>
    </section>
  );
}

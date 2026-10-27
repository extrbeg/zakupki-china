// Шапка заказа: номер (З-ГГГГ-NNN, G33), дата, подразделение, плательщик, заказчик, название, ID задачи Битрикс, дата расчёта, «Все затраты внесены».
// Дата расчёта и флаг «Все затраты внесены» у существующего заказа сохраняются сразу — итоги пересчитываются без нажатия «Сохранить».

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId } from '../../../domain/ids';
import type { Order } from '../../../domain/model';
import { validateOrderNumberUnique } from '../../../domain/validation';
import { useData } from '../../DataContext';
import { CheckboxField, ConfirmDelete, DateField, ErrorBanner, FormGrid, ListSelectField, TextField } from '../../components';
import { nextOrderCode, orderLabel, orderRef } from '../../../domain/numbering';
import { bitrixTaskUrl, compact, orderDeleteBlock, readOrderNumber } from './orderLogic';

interface Draft {
  /** Текст поля «Номер заказа»: `З-ГГГГ-NNN`, у старого заказа — прежний номер (G33). */
  number: string; date: string | undefined; department?: string; payer?: string; customer?: string; title: string;
  bitrixTaskId: string; calcDate?: string; costsComplete: boolean; comment: string;
}

export function OrderHeader({ order }: { order?: Order }) {
  const data = useData();
  const { ds } = data;
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(() => ({
    number: order ? orderLabel(order) : nextOrderCode(ds.orders, data.today).code,
    date: order?.date ?? data.today,
    department: order?.department, payer: order?.payer, customer: order?.customer,
    title: order?.title ?? '', bitrixTaskId: order?.bitrixTaskId ?? '', calcDate: order?.calcDate,
    costsComplete: order?.costsComplete ?? false, comment: order?.comment ?? '',
  }));
  /** Номер нового заказа правили руками — он больше не следует за годом даты. */
  const [numberTouched, setNumberTouched] = useState(Boolean(order));
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
    const id = order?.id ?? newId('ord');
    const read = readOrderNumber(draft.number, draft.date, Boolean(order) && !order?.code);
    if ('error' in read) found.number = read.error;
    else Object.assign(found, validateOrderNumberUnique(ds, { id, number: read.number, code: read.code, date: draft.date }));
    if (!draft.date) found.date = 'Укажите дату заказа';
    setErrors(found);
    if (Object.keys(found).length > 0 || 'error' in read) return;
    setBusy(true);
    setSaveError(undefined);
    try {
      const record = compact<Order>({
        ...order,
        id,
        number: read.number,
        code: read.code,
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
    <ListSelectField list={key} label={label} value={draft[key]} placeholder="—" onChange={(v) => patch({ [key]: v })} />
  );

  return (
    <section className="ui-card" aria-label="Шапка заказа">
      <h2 className="ui-card__title">{order ? `Заказ ${orderRef(order)}` : 'Новый заказ'}</h2>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <FormGrid>
          <TextField
            label="Номер заказа" required value={draft.number} error={errors.number} hint={order ? undefined : 'Присваивается сам: З-ГГГГ-NNN'}
            onChange={(v) => { setNumberTouched(true); patch({ number: v }); }}
          />
          <DateField
            label="Дата заказа" required value={draft.date} error={errors.date}
            onChange={(v) => patch({ date: v, ...(numberTouched || !v ? {} : { number: nextOrderCode(ds.orders, v).code }) })}
          />
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

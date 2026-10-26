// Экран «Затраты» (маршрут /costs): журнал затрат с фильтрами и карточка затраты (R16, R17).
// Адрес принимает `?order=<id>`, `?shipment=<id>` (фильтры) и `?add=<targetType>:<targetId>` (новая затрата с привязкой).

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Cost, CostStatus, CostTargetType, ISODate } from '../../../domain/model';
import { useData } from '../../DataContext';
import { DataTable, DateField, EmptyState, SelectField, type DataColumn } from '../../components';
import { CURRENCY_LABEL, formatMoney, formatRate, ruDate } from '../../format';
import { CostForm, type CostFormPreset } from './CostForm';
import { TARGET_TYPES, costOrderId, costShipmentId, costTypeOptions, payeeLabel, targetLabel, targetOptions } from './costRefs';
import '../rates/rates.css';

type Open = { mode: 'new'; preset?: CostFormPreset } | { mode: 'edit'; id: string } | null;

interface Filters { order?: string; shipment?: string; costType?: string; status?: CostStatus; from?: ISODate; to?: ISODate }

const costDate = (c: Cost): ISODate => c.paymentDate || c.entryDate;

function parseAdd(v: string | null): CostFormPreset | undefined {
  if (!v) return undefined;
  const [type, id] = v.split(':');
  return TARGET_TYPES.includes(type as CostTargetType) ? { targetType: type as CostTargetType, targetId: id || undefined } : undefined;
}

export default function CostsScreen() {
  const { ds, costing, status } = useData();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(() => ({ order: params.get('order') ?? undefined, shipment: params.get('shipment') ?? undefined }));
  const [open, setOpen] = useState<Open>(() => {
    const preset = parseAdd(params.get('add'));
    return preset ? { mode: 'new', preset } : null;
  });
  const setFilter = (p: Partial<Filters>) => setFilters((f) => ({ ...f, ...p }));

  const rubById = useMemo(() => new Map(costing.costsRub.map((r) => [r.costId, r])), [costing.costsRub]);

  const rows = useMemo(() => {
    return ds.costs
      .filter((c) => !filters.order || costOrderId(ds, c) === filters.order)
      .filter((c) => !filters.shipment || costShipmentId(ds, c) === filters.shipment)
      .filter((c) => !filters.costType || c.costType === filters.costType)
      .filter((c) => !filters.status || c.status === filters.status)
      .filter((c) => !filters.from || costDate(c) >= filters.from)
      .filter((c) => !filters.to || costDate(c) <= filters.to)
      .sort((a, b) => (costDate(a) < costDate(b) ? 1 : costDate(a) > costDate(b) ? -1 : 0));
  }, [ds, filters]);

  const totals = useMemo(() => {
    let plan = 0;
    let fact = 0;
    let missing = 0;
    for (const c of rows) {
      const rub = rubById.get(c.id)?.rub;
      if (rub === null || rub === undefined) { missing++; continue; }
      if (c.status === 'plan') plan += rub;
      else fact += rub;
    }
    return { plan, fact, missing };
  }, [rows, rubById]);

  const columns: DataColumn<Cost>[] = useMemo(() => [
    { key: 'entryDate', header: 'Дата заполнения', render: (c) => ruDate(c.entryDate) },
    { key: 'paymentDate', header: 'Дата оплаты', render: (c) => ruDate(c.paymentDate) },
    {
      key: 'status', header: 'Статус',
      render: (c) => <span className={`tag tag--${c.status}`}>{c.status === 'plan' ? 'план' : 'факт'}</span>,
    },
    { key: 'target', header: 'Привязка', render: (c) => targetLabel(ds, c.targetType, c.targetId) },
    { key: 'costType', header: 'Тип', render: (c) => c.costType },
    { key: 'payee', header: 'Кому платим', render: (c) => payeeLabel(ds, c) },
    { key: 'executor', header: 'Исполнитель', render: (c) => c.executor ?? '' },
    {
      key: 'invoice', header: 'Счёт',
      render: (c) => [c.invoiceNumber, c.invoiceDate ? `от ${ruDate(c.invoiceDate)}` : ''].filter(Boolean).join(' '),
    },
    { key: 'amount', header: 'Сумма', align: 'right', render: (c) => <span className="num">{formatMoney(c.amount)}</span> },
    { key: 'currency', header: 'Валюта', render: (c) => CURRENCY_LABEL[c.currency] ?? c.currency },
    {
      key: 'rate', header: 'Курс', align: 'right',
      render: (c) => {
        if (c.currency === 'RUB') return <span className="num">1</span>;
        const r = rubById.get(c.id)?.rate;
        if (!r) return <span className="rate-note rate-note--warn">нет курса</span>;
        const dateNote = c.status === 'fact'
          ? (c.rateDate && c.rateDate !== c.paymentDate ? `от ${ruDate(c.rateDate)}` : '')
          : `план, от ${ruDate(r.date)}`;
        return (
          <span className="rate-cell">
            <span className="rate-cell__value">{formatRate(r.rate)}</span>
            {c.rateManual ? <span className="rate-cell__src rate-cell__src--manual">вручную</span> : null}
            {dateNote ? <span className="rate-cell__src">{dateNote}</span> : null}
          </span>
        );
      },
    },
    {
      key: 'rub', header: 'Сумма, ₽', align: 'right',
      render: (c) => {
        const rub = rubById.get(c.id)?.rub;
        return rub === null || rub === undefined ? <span className="muted">—</span> : <span className="num">{formatMoney(rub)}</span>;
      },
    },
    { key: 'comment', header: 'Комментарий', render: (c) => c.comment ?? '' },
  ], [ds, rubById]);

  const editing = open?.mode === 'edit' ? ds.costs.find((c) => c.id === open.id) : undefined;
  const close = () => setOpen(null);
  const orderOptions = useMemo(() => targetOptions(ds, 'order'), [ds]);
  const shipmentOptions = useMemo(() => targetOptions(ds, 'shipment'), [ds]);
  const typeOptions = useMemo(() => costTypeOptions(ds), [ds]);
  const filtered = Object.values(filters).some(Boolean);

  return (
    <section className="screen">
      <h1 className="screen__title">Затраты</h1>
      {open ? (
        <CostForm
          key={open.mode === 'edit' ? open.id : 'new'}
          cost={editing} preset={open.mode === 'new' ? open.preset : undefined} onClose={close}
        />
      ) : null}
      {status === 'loading' ? <p className="muted">Загрузка…</p> : null}
      {status !== 'loading' && ds.costs.length === 0 ? (
        open ? null : (
          <EmptyState
            title="Затрат пока нет"
            text="Каждый платёж — отдельная строка со своим типом, датой оплаты и курсом. Многослойная оплата (рубли → доллар → юань) — несколько строк."
            actions={[{ label: 'Добавить затрату', onClick: () => setOpen({ mode: 'new' }) }]}
          />
        )
      ) : null}
      {status !== 'loading' && ds.costs.length > 0 ? (
        <>
          <div className="ui-toolbar">
            <SelectField label="Заказ" value={filters.order} options={orderOptions} placeholder="Все" onChange={(v) => setFilter({ order: v })} />
            <SelectField label="Поставка" value={filters.shipment} options={shipmentOptions} placeholder="Все" onChange={(v) => setFilter({ shipment: v })} />
            <SelectField label="Тип" value={filters.costType} options={typeOptions} placeholder="Все" onChange={(v) => setFilter({ costType: v })} />
            <SelectField
              label="План/факт" value={filters.status} placeholder="Все"
              options={[{ value: 'plan', label: 'План' }, { value: 'fact', label: 'Факт' }]}
              onChange={(v) => setFilter({ status: v as CostStatus | undefined })}
            />
            <DateField label="Период с" value={filters.from} onChange={(v) => setFilter({ from: v })} />
            <DateField label="по" value={filters.to} onChange={(v) => setFilter({ to: v })} />
            {filtered ? <button type="button" className="btn" onClick={() => setFilters({})}>Сбросить фильтры</button> : null}
            <span className="ui-toolbar__spacer" />
            <button type="button" className="btn btn--primary" onClick={() => setOpen({ mode: 'new' })}>Добавить затрату</button>
          </div>
          <p className="muted small">
            Период — по дате оплаты, у плановых без даты оплаты — по дате заполнения. Фильтр заказа — затраты на заказ, его поставщиков и позиции.
          </p>
          <DataTable
            columns={columns} rows={rows} rowKey={(c) => c.id}
            onRowClick={(c) => setOpen({ mode: 'edit', id: c.id })}
            empty="По фильтрам ничего не найдено"
            footer={(
              <tr>
                <td colSpan={11} style={{ textAlign: 'right' }}>
                  Итого: факт <span className="num">{formatMoney(totals.fact)}</span> ₽ · план <span className="num">{formatMoney(totals.plan)}</span> ₽
                  {totals.missing > 0 ? <span className="rate-note rate-note--warn"> · без курса: {totals.missing}</span> : null}
                </td>
                <td colSpan={2} />
              </tr>
            )}
          />
        </>
      ) : null}
    </section>
  );
}

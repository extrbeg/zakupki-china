// Блок «Поставщик в заказе» (G02): заголовок — код <заказ>-<n>, поставщик, валюта, курс на дату расчёта с датой курса,
// AD поставщика с подсказкой по истории, итоги поставщика; сразу под ним таблица товаров. Реквизиты свёрнуты.
// AD поставщика сохраняется сразу при изменении (очередь записей, см. saveCoef).

import { useEffect, useMemo, useRef, useState } from 'react';
import { suggestCoef } from '../../../domain/costing';
import { calcRateFor, effectiveCalcDate } from '../../../domain/lineFigures';
import type { Order, SupplierOrder } from '../../../domain/model';
import { useData } from '../../DataContext';
import { ErrorBanner, NumberField, isBadNumber } from '../../components';
import { CURRENCY_LABEL, formatDate, formatMoney, formatRate } from '../../format';
import { LinesSection } from './LinesSection';
import { buildLineRows, sumLineRows } from './linesLogic';
import { bitrixTaskUrl, compact, suggestionBasis, suggestionText, supplierOrderCode } from './orderLogic';
import { RATE_SOURCE_TEXT, SupplierOrderForm } from './SupplierOrderForm';
import { usePurchased } from './purchasedQueue';

export function SupplierOrderBlock({ order, so, onSaved }: { order: Order; so?: SupplierOrder; onSaved?: () => void }) {
  const { ds } = useData();
  const seq = so?.seq ?? ds.supplierOrders.filter((s) => s.orderId === order.id).reduce((m, s) => Math.max(m, s.seq), 0) + 1;
  const code = supplierOrderCode(order, { seq });

  if (!so) {
    return (
      <section className="ui-card so-block" aria-label="Новый поставщик в заказе">
        <div className="so-block__head"><h2>Новый поставщик в заказе ({code})</h2></div>
        <SupplierOrderForm order={order} seq={seq} onSaved={onSaved} />
      </section>
    );
  }
  return <ExistingBlock order={order} so={so} code={code} />;
}

function ExistingBlock({ order, so, code }: { order: Order; so: SupplierOrder; code: string }) {
  const data = useData();
  const { ds, costing, today } = data;
  const [open, setOpen] = useState(false);
  const [adError, setAdError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<unknown>(undefined);
  const latest = useRef(ds);
  latest.current = ds;
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [adValue, setAdValue] = useState<number | undefined>(so.coef);
  const pendingCoef = useRef(0);
  const desiredCoef = useRef<number | undefined>(so.coef);
  const writtenCoef = useRef<number | undefined>(so.coef);
  // AD сменили не из этого поля (перезагрузка данных) — показать, если своих записей в очереди нет.
  useEffect(() => {
    if (pendingCoef.current > 0) return;
    setAdValue(so.coef);
    desiredCoef.current = so.coef;
    writtenCoef.current = so.coef;
  }, [so.coef]);

  const supplierName = ds.suppliers.find((s) => s.id === so.supplierId)?.name;
  const rate = useMemo(() => calcRateFor(ds, order, so, today), [ds, order, so, today]);
  const { isOn, version } = usePurchased();
  const rows = useMemo(
    () => buildLineRows(ds, costing, so, rate, isOn),
    [ds, costing, so, rate, version],   // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totals = sumLineRows(rows);
  const suggestion = suggestCoef(ds, costing, so.supplierId, so.plannedMode);

  const effDate = effectiveCalcDate(order, so, today);
  const rateText = (() => {
    if (!rate) return `нет курса на ${formatDate(effDate)}`;
    if (rate.source === 'manual' && so.calcRate !== undefined) return `курс ${formatRate(rate.rate)} на ${formatDate(rate.date)} (задан вручную)`;
    const base = `курс ${formatRate(rate.rate)} на ${formatDate(rate.date)} (${RATE_SOURCE_TEXT[rate.source]})`;
    return rate.exact ? base : `${base}; на ${formatDate(effDate)} курса нет — взят последний до неё`;
  })();

  // AD поставщика: поле держит своё значение (adValue), пока есть незаконченные записи, — ответ на промежуточную запись
  // не перезаписывает набираемый текст. Записи идут по очереди, и каждая пишет последнее введённое верное значение
  // (промежуточные схлопываются); неверный ввод в очередь не попадает.
  const saveCoef = (coef: number | undefined) => {
    desiredCoef.current = coef;
    pendingCoef.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const coefNow = desiredCoef.current;
        if (Object.is(coefNow, writtenCoef.current)) return;
        const current = latest.current.supplierOrders.find((s) => s.id === so.id) ?? so;
        setSaveError(undefined);
        await data.save('supplierOrders', compact({ ...current, coef: coefNow }) as SupplierOrder);
        writtenCoef.current = coefNow;
      } catch (e) {
        setSaveError(e);
      } finally {
        pendingCoef.current -= 1;
      }
    });
  };
  const onCoef = (v: number | undefined) => {
    setAdValue(v);
    if (isBadNumber(v)) { setAdError(undefined); return; }   // «Введите число» показывает само поле
    if (v !== undefined && v <= 0) { setAdError('AD должен быть больше нуля'); return; }
    setAdError(undefined);
    saveCoef(v);
  };

  const link = bitrixTaskUrl(ds.settings.bitrixPortalUrl, so.bitrixTaskId);
  const rub = (n: number) => `${formatMoney(n)} ₽`;

  return (
    <section className="ui-card so-block" aria-label={`Поставщик в заказе ${code}`}>
      <div className="so-block__head">
        <h2>{code}{supplierName ? ` · ${supplierName}` : ''}</h2>
        <span className="so-block__meta">{CURRENCY_LABEL[so.currency]} · <span className={rate && rate.exact ? undefined : 'so-block__warn'}>{rateText}</span></span>
        {link ? <a className="order-link" href={link} target="_blank" rel="noreferrer">Задача {so.bitrixTaskId?.trim()} в Битрикс24</a> : null}
        <span className="ui-card__spacer" />
        <button type="button" className="btn btn--small" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Реквизиты поставщика</button>
      </div>
      {saveError !== undefined ? <ErrorBanner error={saveError} /> : null}
      <div className="so-block__summary">
        <div className="so-block__ad">
          <NumberField
            label="AD поставщика" value={adValue} onChange={onCoef} error={adError} placeholder="—"
            hint={so.coef === undefined ? 'не задан — нет прогноза' : undefined}
          />
          {suggestion.value === null ? (
            <span className="small muted">{suggestionText(suggestion)}</span>
          ) : (
            <button
              type="button" className="btn btn--small" title={`Медиана AW закрытых позиций ${suggestionBasis(suggestion)}`}
              onClick={() => { const v = suggestion.value ?? undefined; setAdError(undefined); setAdValue(v); saveCoef(v); }}
            >
              {suggestionText(suggestion)}
            </button>
          )}
        </div>
        <dl className="so-totals" aria-label={`Итоги поставщика ${code}`}>
          <div><dt>Итого в валюте</dt><dd>{formatMoney(totals.X)} {so.currency}</dd></div>
          <div><dt>Итого ₽</dt><dd>{rub(totals.Z)}</dd></div>
          <div><dt>Итого прогноз ₽</dt><dd>{rub(totals.forecast)}</dd></div>
          <div><dt>Итого себестоимость ₽</dt><dd>{rub(totals.cost)}</dd></div>
        </dl>
      </div>
      {open ? <SupplierOrderForm key={so.id} order={order} so={so} seq={so.seq} /> : null}
      <LinesSection order={order} so={so} code={code} rate={rate} rows={rows} />
    </section>
  );
}

// Разбивка затраты на поставку / декларацию по заказам под суммой (история 100): «Заказ З-… — 62 % (… ₽)».
// Считает движок по всему набору с этой затратой в введённом виде (рубли — как в форме), поэтому до сохранения — «предварительно».

import { useMemo } from 'react';
import { computeCosting } from '../../../domain/costing';
import { costSharesByOrder, costUnallocatedRub } from '../../../domain/costShares';
import type { Cost, CostTargetType, ISODate } from '../../../domain/model';
import { orderRef } from '../../../domain/numbering';
import { useData } from '../../DataContext';
import { formatMoney } from '../../format';
import { formatSharePct, splitRuleText } from './splitText';
import './costs.css';

const DRAFT_ID = '__draft__';

export interface SplitDraft { id?: string; entryDate?: ISODate; targetType: CostTargetType; targetId?: string; costType?: string }

export function CostSplit({ saved, draft, rub }: { saved?: Cost; draft: SplitDraft; rub: number | undefined }) {
  const { ds, costing, today } = useData();
  const hasRub = typeof rub === 'number' && Number.isFinite(rub);

  const result = useMemo(() => {
    if (!draft.targetId || !hasRub) return null;
    const id = draft.id ?? DRAFT_ID;
    // затрата в рублях фактом — те же рубли, что в форме; правило деления зависит только от привязки и типа
    const preview: Cost = {
      id, entryDate: draft.entryDate ?? today, status: 'fact', targetType: draft.targetType, targetId: draft.targetId,
      costType: draft.costType ?? '', currency: 'RUB', amount: rub, rateManual: false,
    };
    const next = { ...ds, costs: [...ds.costs.filter((c) => c.id !== id), preview] };
    const res = computeCosting(next, today);
    return { shares: costSharesByOrder(next, res, id), unallocated: costUnallocatedRub(next, res, id) };
  }, [ds, today, draft.id, draft.entryDate, draft.targetType, draft.targetId, draft.costType, rub, hasRub]);

  if (!draft.targetId) return null;
  const savedRub = saved ? costing.costsRub.find((r) => r.costId === saved.id)?.rub : undefined;
  const preliminary = !saved || saved.targetType !== draft.targetType || saved.targetId !== draft.targetId
    || (saved.costType ?? '') !== (draft.costType ?? '') || typeof savedRub !== 'number' || !hasRub || Math.abs(savedRub - rub!) > 0.005;
  const rule = splitRuleText(ds, draft.targetType, draft.targetId, draft.costType);

  return (
    <section className="cost-split" aria-labelledby="cost-split-title">
      <p className="cost-split__title" id="cost-split-title">
        Как делится по заказам{result && preliminary ? ' — предварительно, до сохранения' : ''}
      </p>
      {rule ? <p className="cost-split__note">{rule}. Все затраты поставки делятся на все заказы в ней.</p> : null}
      {!result ? (
        <p className="cost-split__note">Введите сумму — здесь появится, сколько ляжет на каждый заказ.</p>
      ) : (
        <>
          {result.shares.length > 0 ? (
            <ul>
              {result.shares.map((s) => {
                const o = ds.orders.find((x) => x.id === s.orderId);
                return <li key={s.orderId}>Заказ {o ? orderRef(o) : '?'} — {formatSharePct(s.pct)} ({formatMoney(s.rub)} ₽)</li>;
              })}
            </ul>
          ) : null}
          {Math.abs(result.unallocated) > 0.005 ? (
            <p className="cost-split__note rate-note--warn">
              Не распределено: {formatMoney(result.unallocated)} ₽ — в поставке нет товаров с базой деления (добавьте их в «Что едет»).
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

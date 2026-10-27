// Черновик затраты в форме: автокурс, досчёт сумм, проверка и сборка записи `Cost`.
//
// Курс:
// - факт — курс на дату оплаты (pickRate: ручной на дату → ВТБ на дату → последний до даты); сохраняется числом с датой курса;
// - план — курс даты расчёта поставщика/заказа, как в движке себестоимости (поставка и декларация — на сегодня);
//   в запись не фиксируется, пока его не поправили руками: дата расчёта меняется — рубли плана меняются (R15);
// - RUB — курс 1.
// Режим курса: 'auto' — подставляется сам и перезаполняется при смене даты/валюты/статуса/привязки;
// 'manual' — поправлен руками (rateManual), не перезаполняется; 'stored' — курс сохранённой фактической затраты,
// не меняется от правок листа «Курсы» и от смены привязки или статуса; смена даты оплаты или валюты переводит его в 'auto'.
// Пока черновик в статусе «план», 'stored' не действует — план считается автокурсом, как в движке (rateManual=false).

import type { Cost, CostStatus, CostTargetType, Currency, Dataset, ISODate, PayeeType } from '../../../domain/model';
import { pickRate, type RatePick } from '../../../domain/rates';
import { newId } from '../../../domain/ids';
import { targetSupplierOrderId } from './costRefs';

export type RateMode = 'auto' | 'manual' | 'stored';
export type AmountSource = 'currency' | 'rub';

export interface CostDraft {
  id?: string;
  /** Номер затраты (G33); при смене привязки не меняется. */
  code?: string;
  entryDate?: ISODate;
  paymentDate?: ISODate;
  status: CostStatus;
  targetType: CostTargetType;
  targetId?: string;
  costType?: string;
  payeeType?: PayeeType;
  payeeId?: string;
  payeeText?: string;
  executor?: string;
  invoiceNumber?: string;
  invoiceDate?: ISODate;
  currency: Currency;
  amount?: number;
  amountRub?: number;
  amountSource: AmountSource;
  rate?: number;
  rateDate?: ISODate;
  rateMode: RateMode;
  /** Признак «курс вручную» сохранённой записи (для режима 'stored'). */
  storedManual?: boolean;
  comment?: string;
}

export function newDraft(today: ISODate, preset?: { targetType?: CostTargetType; targetId?: string; currency?: Currency }): CostDraft {
  return {
    entryDate: today, status: 'fact', targetType: preset?.targetType ?? 'order', targetId: preset?.targetId,
    currency: preset?.currency ?? 'RUB', amountSource: 'currency', rateMode: 'auto',
  };
}

const pos = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function draftFromCost(c: Cost): CostDraft {
  // курс вручную держится при любой правке; иначе курс факта зафиксирован ('stored')
  const rateMode: RateMode = c.rateManual && pos(c.rate) && c.currency !== 'RUB' ? 'manual'
    : c.status === 'fact' && c.currency !== 'RUB' && pos(c.rate) ? 'stored' : 'auto';
  return {
    id: c.id, code: c.code, entryDate: c.entryDate, paymentDate: c.paymentDate, status: c.status, targetType: c.targetType, targetId: c.targetId || undefined,
    costType: c.costType || undefined, payeeType: c.payeeType, payeeId: c.payeeId, payeeText: c.payeeText, executor: c.executor,
    invoiceNumber: c.invoiceNumber, invoiceDate: c.invoiceDate, currency: c.currency,
    amount: num(c.amount) ? c.amount : undefined, amountRub: num(c.amountRub) ? c.amountRub : undefined,
    amountSource: !num(c.amount) && num(c.amountRub) ? 'rub' : 'currency',
    rate: c.rate, rateDate: c.rateDate, rateMode, storedManual: c.rateManual, comment: c.comment,
  };
}

/** Дата курса плановой затраты — как в движке: дата расчёта поставщика → заказа → сегодня. */
export function planRateDate(ds: Dataset, type: CostTargetType, targetId: string | undefined, today: ISODate): { date: ISODate; calcRate?: { rate: number; currency: Currency } } {
  if (!targetId) return { date: today };
  const soId = targetSupplierOrderId(ds, type, targetId);
  if (soId) {
    const so = ds.supplierOrders.find((s) => s.id === soId);
    const order = so ? ds.orders.find((o) => o.id === so.orderId) : undefined;
    if (so && order) return { date: so.calcDate || order.calcDate || today, calcRate: pos(so.calcRate) ? { rate: so.calcRate, currency: so.currency } : undefined };
  }
  if (type === 'order') {
    const order = ds.orders.find((o) => o.id === targetId);
    if (order) return { date: order.calcDate || today };
  }
  return { date: today };
}

export interface AutoRate {
  /** Дата, на которую ищется курс; null — факт без даты оплаты. */
  date: ISODate | null;
  basis: 'payment' | 'calc';
  pick: RatePick | null;
  /** Курс взят из «курса расчёта вручную» поставщика в заказе. */
  fromSupplierCalcRate?: boolean;
}

/** Курс, который подставился бы сам. */
export function autoRate(ds: Dataset, d: Pick<CostDraft, 'status' | 'paymentDate' | 'currency' | 'targetType' | 'targetId'>, today: ISODate): AutoRate {
  if (d.status === 'fact') {
    const date = d.paymentDate ?? null;
    if (d.currency === 'RUB') return { date, basis: 'payment', pick: { rate: 1, date: date ?? today, source: 'fixed', exact: true } };
    return { date, basis: 'payment', pick: date ? pickRate(ds.rates, d.currency, date) : null };
  }
  const { date, calcRate } = planRateDate(ds, d.targetType, d.targetId, today);
  if (calcRate && calcRate.currency === d.currency && d.currency !== 'RUB') {
    return { date, basis: 'calc', pick: { rate: calcRate.rate, date, source: 'manual', exact: true }, fromSupplierCalcRate: true };
  }
  return { date, basis: 'calc', pick: pickRate(ds.rates, d.currency, date) };
}

/** Курс берётся из истории: режим 'auto' или зафиксированный курс факта, временно переведённого в план. */
export const rateIsAuto = (d: Pick<CostDraft, 'rateMode' | 'status'>) => d.rateMode === 'auto' || (d.rateMode === 'stored' && d.status === 'plan');

/** Действующий курс черновика (undefined — курса нет). */
export function effectiveRate(d: CostDraft, auto: AutoRate): number | undefined {
  if (d.currency === 'RUB') return 1;
  if (rateIsAuto(d)) return auto.pick?.rate;
  return pos(d.rate) ? d.rate : undefined;
}

/** Суммы с досчётом второго значения: введена валюта — рубли = валюта × курс, введены рубли — валюта = рубли / курс. */
export function draftAmounts(d: CostDraft, rate: number | undefined): { amount?: number; amountRub?: number } {
  if (d.amountSource === 'rub') {
    const rub = d.amountRub;
    return { amountRub: rub, amount: num(rub) && pos(rate) ? rub / rate : undefined };
  }
  const a = d.amount;
  return { amount: a, amountRub: num(a) && pos(rate) ? a * rate : undefined };
}

/** Есть ли в истории курс именно на эту дату (без подстановки последнего до даты). */
export const hasExactRate = (auto: AutoRate) => Boolean(auto.pick?.exact);

export type CostErrors = Partial<Record<'code' | 'entryDate' | 'paymentDate' | 'targetId' | 'costType' | 'amount' | 'rate' | 'payeeText', string>>;

export const NO_RATE_TEXT = 'нет курса — введите вручную';

/** Проверка и сборка записи. Округления нет: деньги хранятся как посчитаны. */
export function buildCost(d: CostDraft, auto: AutoRate): { cost?: Cost; errors: CostErrors } {
  const errors: CostErrors = {};
  if (!d.entryDate) errors.entryDate = 'Укажите дату заполнения';
  if (!d.targetId) errors.targetId = 'Выберите, к чему относится затрата';
  if (!d.costType?.trim()) errors.costType = 'Выберите тип затраты';
  if (d.status === 'fact' && !d.paymentDate) errors.paymentDate = 'Для фактической затраты укажите дату оплаты';
  const rate = effectiveRate(d, auto);
  if (d.currency !== 'RUB') {
    if (!rateIsAuto(d) && !pos(d.rate)) errors.rate = 'Курс должен быть больше нуля';
    else if (!pos(rate) && !errors.paymentDate) errors.rate = d.status === 'fact' && !d.paymentDate ? 'Укажите дату оплаты' : 'Нет курса — введите курс вручную';
  }
  const entered = d.amountSource === 'rub' ? d.amountRub : d.amount;
  if (!num(entered)) errors.amount = 'Введите сумму в валюте или в рублях';
  if (Object.keys(errors).length > 0) return { errors };

  const { amount, amountRub } = draftAmounts(d, rate);
  const base: Cost = {
    id: d.id ?? newId('cst'),
    entryDate: d.entryDate!,
    status: d.status,
    targetType: d.targetType,
    targetId: d.targetId!,
    costType: d.costType!.trim(),
    currency: d.currency,
    amount,
    rateManual: false,
  };
  const opt = <K extends keyof Cost>(k: K, v: Cost[K] | undefined) => {
    if (v !== undefined && v !== '') base[k] = v;
  };
  opt('code', d.code?.trim());
  opt('paymentDate', d.paymentDate);
  if (d.payeeType) {
    base.payeeType = d.payeeType;
    if (d.payeeType === 'text') opt('payeeText', d.payeeText?.trim());
    else opt('payeeId', d.payeeId);
  }
  opt('executor', d.executor?.trim());
  opt('invoiceNumber', d.invoiceNumber?.trim());
  opt('invoiceDate', d.invoiceDate);
  opt('comment', d.comment?.trim());

  if (d.currency === 'RUB') {
    base.rate = 1;
    base.rateDate = d.paymentDate ?? undefined;
    base.amountRub = amount;
  } else if (d.status === 'fact') {
    // факт: курс фиксируется числом с датой курса
    if (d.rateMode === 'auto') {
      base.rate = auto.pick!.rate;
      base.rateDate = auto.pick!.date;
    } else if (d.rateMode === 'manual') {
      base.rate = d.rate;
      base.rateDate = d.paymentDate;
      base.rateManual = true;
    } else {
      base.rate = d.rate;
      base.rateDate = d.rateDate ?? d.paymentDate;
      base.rateManual = Boolean(d.storedManual);
    }
    base.amountRub = amountRub;
  } else if (d.rateMode === 'manual') {
    // план с курсом, поправленным руками: курс держится, рубли постоянны
    base.rate = d.rate;
    base.rateDate = d.paymentDate ?? auto.date ?? undefined;
    base.rateManual = true;
    base.amountRub = amountRub;
  }
  // план с автокурсом: курс и рубли не фиксируются — их считает движок по дате расчёта
  if (base.rateDate === undefined) delete base.rateDate;
  return { cost: base, errors };
}

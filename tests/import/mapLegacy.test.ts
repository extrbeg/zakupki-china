import { describe, expect, it } from 'vitest';
import { mapLegacy, type LegacyRaw } from '../../src/import';
import type { Cost, Line, Order, SupplierOrder } from '../../src/domain/model';
import { SYNTHETIC_LEGACY, serial } from '../../fixtures/legacy/synthetic';
import { CHINA_COUNTRY_ID } from '../../src/data/geo';

const TODAY = '2026-10-25';
const plan = () => mapLegacy(SYNTHETIC_LEGACY, TODAY);

const orderBy = (orders: Order[] | undefined, n: number) => orders?.find((o) => o.number === n);

describe('mapLegacy — заказы', () => {
  it('группирует строки «Заказов» по номеру A и переносит шапку заказа', () => {
    const { data } = plan();
    expect(data.orders?.map((o) => o.number).sort((a, b) => a - b)).toEqual([1, 3, 46039]);
    expect(orderBy(data.orders, 1)).toMatchObject({
      number: 1, date: '2026-03-02', department: 'Цех', payer: 'ООО Плательщик', customer: 'Иванов', costsComplete: false,
    });
    expect(orderBy(data.orders, 1)?.id).toMatch(/^ord_/);
  });
});

describe('mapLegacy — поставщики в заказе и позиции', () => {
  it('группирует по A + R (имя без регистра и пробелов), RMB → CNY, W → calcRate, пустой N — по порядку появления', () => {
    const { data } = plan();
    const o1 = orderBy(data.orders, 1)!;
    const sos = (data.supplierOrders ?? []).filter((s) => s.orderId === o1.id).sort((a, b) => a.seq - b.seq);
    expect(sos).toHaveLength(2);
    const alpha = data.suppliers?.find((s) => s.id === sos[0].supplierId);
    const gamma = data.suppliers?.find((s) => s.id === sos[1].supplierId);
    expect(alpha?.name).toBe('ALPHA VALVE  CO');   // взят из «Поставщики исходник», не создан заново
    expect(gamma?.name).toBe('Gamma Lamps');       // нет в справочнике — создан по имени
    expect(sos[0]).toMatchObject({
      seq: 1, currency: 'CNY', calcDate: '2026-03-05', calcRate: 12, paymentTerms: 'Аванс',
      launchDate: '2026-03-10', productionDays: 30, actualReadyDate: '2026-04-12',
    } satisfies Partial<SupplierOrder>);
    expect(sos[1]).toMatchObject({ seq: 2, currency: 'USD', calcRate: 80 });
  });

  it('позиции переносят все колонки, «Закупка» — флажок P', () => {
    const { data } = plan();
    const o1 = orderBy(data.orders, 1)!;
    const lines = (data.lines ?? []).filter((l) => l.orderId === o1.id).sort((a, b) => a.seq - b.seq);
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(lines[0]).toMatchObject({
      customerName: 'Кран шаровый DN50', techParams: 'PN16, латунь', docName: 'Кран шаровый', supplierName: 'Ball valve BV-50',
      qty: 100, unitPrice: 10, purchased: true, hsCode: '8481', packaging: 'коробка', packageSize: '40x30x20',
      cbm: 1.2, weight: 300, places: 4,
    } satisfies Partial<Line>);
    // AD 1.5 у всех позиций Alpha — он стал AD поставщика в заказе, своего AD у позиций нет (G05.1)
    expect(lines[0].coef).toBeUndefined();
    expect(data.supplierOrders?.find((s) => s.id === lines[0].supplierOrderId)?.coef).toBe(1.5);
    expect(lines[0].customerNameEn).toBeUndefined();   // перевод ставит формула листа, не импорт
    expect(lines[2]).toMatchObject({ qty: 10, unitPrice: 7, purchased: false });
    const so = data.supplierOrders?.find((s) => s.id === lines[0].supplierOrderId);
    expect(so?.orderId).toBe(o1.id);
    expect(lines[1].supplierOrderId).toBe(lines[0].supplierOrderId);
    expect(lines[2].supplierOrderId).not.toBe(lines[0].supplierOrderId);
  });

  it('поставщик не указан — позиции под поставщиком «Поставщик не указан», с проблемой', () => {
    const { data, problems } = plan();
    const o3 = orderBy(data.orders, 3)!;
    const so = data.supplierOrders?.find((s) => s.orderId === o3.id);
    expect(data.suppliers?.find((s) => s.id === so?.supplierId)?.name).toBe('Поставщик не указан');
    expect(problems).toContainEqual(expect.objectContaining({ sheet: 'Заказы', row: 9, message: expect.stringMatching(/поставщик не указан/i) }));
  });
});

describe('mapLegacy — AD поставщика в заказе (G05.1)', () => {
  // Синтетика + заказ 5 у нового поставщика Delta: AD позиций 1.4, 1.4, 1.8 и одна позиция без AD.
  const withMixedAd = (): LegacyRaw => {
    const raw = structuredClone(SYNTHETIC_LEGACY) as LegacyRaw;
    const values = raw.sheets['Заказы'].values;
    const head = values[1].map((v) => String(v).trim());
    const at = (h: string) => { const i = head.indexOf(h); if (i < 0) throw new Error(`нет колонки ${h}`); return i; };
    const mk = (seq: number, name: string, ad?: number) => {
      const r: (string | number | boolean)[] = Array(head.length).fill('');
      r[at('Заказ')] = 5; r[at('Дата заказа')] = serial('2026-07-01'); r[at('Название изделия от заказчика')] = name;
      r[at('Номер поставщика в заказе')] = 1; r[at('Закупка')] = true; r[at('Номер позиции в заказе')] = seq;
      r[at('Поставщик')] = 'Delta Pumps'; r[at('QTY')] = 10; r[at('Цена за шт в валюте поставщика')] = 100;
      r[at('Валюта поставщика')] = 'RMB'; r[at('Дата расчета')] = serial('2026-07-02'); r[at('Курс валюты к рублю на дату расчетта')] = 11;
      if (ad !== undefined) r[at('Коэффициент стоимости доставки для расчета')] = ad;
      return r;
    };
    values.push(mk(1, 'Насос 1', 1.4), mk(2, 'Насос 2', 1.8), mk(3, 'Насос 3', 1.4), mk(4, 'Насос 4'));
    return raw;
  };
  const delta = () => {
    const { data } = mapLegacy(withMixedAd(), TODAY);
    const o5 = orderBy(data.orders, 5)!;
    const so = data.supplierOrders!.find((s) => s.orderId === o5.id)!;
    const lines = (data.lines ?? []).filter((l) => l.orderId === o5.id).sort((a, b) => a.seq - b.seq);
    return { so, lines };
  };

  it('AD поставщика = самый частый AD его позиций', () => {
    expect(delta().so.coef).toBe(1.4);
  });

  it('позиция с другим AD сохраняет свой; с тем же AD и без AD — своего AD не получают', () => {
    const { lines } = delta();
    expect(lines.map((l) => l.coef)).toEqual([undefined, 1.8, undefined, undefined]);
  });

  it('у поставщика без AD в позициях AD не ставится', () => {
    const { data } = plan();
    const o3 = orderBy(data.orders, 3)!;
    expect(data.supplierOrders?.find((s) => s.orderId === o3.id)?.coef).toBeUndefined();
  });
});

describe('mapLegacy — проблемы данных', () => {
  it('строка без номера заказа пропущена и названа; пустая строка с формулами — молча', () => {
    const { data, problems } = plan();
    const ordersSheet = problems.filter((p) => p.sheet === 'Заказы');
    expect(ordersSheet).toContainEqual({ sheet: 'Заказы', row: 6, message: expect.stringMatching(/нет номера заказа/i) });
    expect(ordersSheet.some((p) => p.row === 7)).toBe(false);
    expect(data.lines?.some((l) => l.customerName === 'Строка без номера заказа')).toBe(false);
  });

  it('номер заказа-дата (serial) отмечен; дата заказа берётся из этой даты', () => {
    const { data, problems } = plan();
    expect(problems).toContainEqual({ sheet: 'Заказы', row: 8, message: expect.stringMatching(/номер заказа — дата 17\.01\.2026/i) });
    expect(orderBy(data.orders, 46039)).toMatchObject({ date: '2026-01-17', customer: 'Петров' });
  });

  it('поставщик не из справочника создан по имени и назван в отчёте один раз', () => {
    const { data, problems } = plan();
    const gamma = problems.filter((p) => /Gamma Lamps/.test(p.message));
    expect(gamma).toEqual([{ sheet: 'Заказы', row: 5, message: expect.stringMatching(/нет в «Поставщики исходник» — создан по имени/) }]);
    expect(data.suppliers?.filter((s) => s.name === 'Gamma Lamps')).toHaveLength(1);
    expect(problems).toContainEqual({ sheet: 'Поставщики исходник', row: 4, message: expect.stringMatching(/нет названия компании/i) });
  });
});

describe('mapLegacy — поставки', () => {
  it('даты AM/AN/AT дают поставку (тип «другое») на подзаказ поставщика и партии его позиций', () => {
    const { data } = plan();
    expect(data.shipments).toHaveLength(1);
    const sh = data.shipments![0];
    expect(sh).toMatchObject({ number: '1-1', mode: 'other', consolidationDate: '2026-04-15', sentDate: '2026-04-20', arrivalDate: '2026-05-25', vatRate: 22 });
    const o1 = orderBy(data.orders, 1)!;
    const alphaLines = (data.lines ?? []).filter((l) => l.orderId === o1.id && l.purchased);
    expect(data.batches?.map((b) => [b.shipmentId, b.lineId, b.qty, b.cbm, b.weight]).sort()).toEqual(
      alphaLines.map((l) => [sh.id, l.id, l.qty, l.cbm, l.weight]).sort(),
    );
  });
});

describe('mapLegacy — затраты', () => {
  it('затраты привязаны к заказу целиком; валютная — с курсом вручную, рублёвая — в рублях', () => {
    const { data } = plan();
    const o1 = orderBy(data.orders, 1)!;
    const costs = (data.costs ?? []).filter((c) => c.targetId === o1.id);
    expect(costs).toHaveLength(3);
    expect(costs.every((c) => c.targetType === 'order')).toBe(true);
    expect(costs.find((c) => c.costType === 'Аванс')).toMatchObject({
      entryDate: '2026-03-12', paymentDate: '2026-03-12', status: 'fact', invoiceNumber: 'INV-7', invoiceDate: '2026-03-11',
      payeeType: 'text', payeeText: 'Alpha Valve Co', executor: 'Агент Восток', comment: 'аванс 30 %',
      amount: 1000, currency: 'CNY', rate: 12, rateManual: true, amountRub: 12000,
    } satisfies Partial<Cost>);
    expect(costs.find((c) => c.costType === 'Комиссия банка')).toMatchObject({ status: 'fact', amount: 500, currency: 'RUB', amountRub: 500, rateManual: false });
    // без даты операции — ещё не оплачена: план, дата заполнения — день импорта
    expect(costs.find((c) => c.costType === 'Доставка')).toMatchObject({ status: 'plan', entryDate: TODAY, invoiceNumber: '812', amount: 3000, currency: 'RUB' });
  });

  it('номер заказа-дата в затратах находит тот же заказ; неизвестный номер и пустой — пропущены с проблемой', () => {
    const { data, problems } = plan();
    const o = orderBy(data.orders, 46039)!;
    expect(data.costs?.filter((c) => c.targetId === o.id).map((c) => c.amount)).toEqual([100]);
    expect(data.costs).toHaveLength(4);
    expect(problems).toContainEqual({ sheet: 'Затраты по заказам', row: 8, message: expect.stringMatching(/заказ № 99 не найден/i) });
    expect(problems).toContainEqual({ sheet: 'Затраты по заказам', row: 9, message: expect.stringMatching(/нет номера заказа/i) });
  });
});

describe('mapLegacy — справочники, города, курсы', () => {
  it('списки A–I по своим ключам, без повторов (регистр и пробелы не различаются)', () => {
    const { data } = plan();
    const of = (list: string) => (data.lists ?? []).filter((l) => l.list === list).sort((a, b) => a.order - b.order).map((l) => l.value);
    expect(of('companyType')).toEqual(['Производство', 'Перекуп']);
    expect(of('direction')).toEqual(['Арматура']);
    expect(of('specialization')).toEqual(['Краны', 'Лампы']);
    expect(of('payer')).toEqual(['ООО Плательщик']);
    expect(of('department')).toEqual(['Цех', 'Склад']);
    expect(of('paymentTerms')).toEqual(['Аванс', 'Итоговый расчет']);
    expect(of('costType')).toEqual(['Аванс поставщику', 'Комиссия банка']);
    expect(of('customer')).toEqual(['Иванов', 'Петров']);
  });

  it('города: L/M — провинция, T/U — население; пустая провинция — из справочника Китая (G20), страна — Китай', () => {
    const { data } = plan();
    const cities = [...(data.cities ?? [])].sort((a, b) => a.city.localeCompare(b.city)).map(({ city, province, population }) => ({ city, province, population }));
    expect(cities).toEqual([
      { city: 'Lhasa', province: 'Tibet', population: 900000 },
      { city: 'Ningbo', province: 'Zhejiang', population: 9618000 },
      { city: 'Taizhou', province: 'Zhejiang', population: 6622000 },
    ]);
    expect((data.cities ?? []).every((c) => c.countryId === CHINA_COUNTRY_ID)).toBe(true);
  });

  it('провинция из старой таблицы главнее справочника; город в двух провинциях без провинции не угадывается', () => {
    const raw: LegacyRaw = { sheets: { 'Списки': { hidden: false, values: [
      ['Тип компании', 'Город', 'Провинция города', 'Город', 'Население*'],
      ['', 'Ningbo', 'Своя провинция', 'Taizhou', 100],
    ] } } };
    const cities = mapLegacy(raw, TODAY).data.cities ?? [];
    expect(cities.find((c) => c.city === 'Ningbo')?.province).toBe('Своя провинция');
    expect(cities.find((c) => c.city === 'Taizhou')?.province).toBe('');
  });

  it('курсы ВТБ из X:Z переносятся как ручные, RMB → CNY', () => {
    const { data } = plan();
    expect((data.rates ?? []).map(({ date, currency, rate, source }) => ({ date, currency, rate, source }))).toEqual([
      { date: '2026-03-05', currency: 'CNY', rate: 12.1, source: 'manual' },
      { date: '2026-03-05', currency: 'USD', rate: 81.5, source: 'manual' },
      { date: '2026-03-06', currency: 'EUR', rate: 95.25, source: 'manual' },
    ]);
  });

  it('поставщики, платёжные агенты и перевозчики по одноимённым колонкам', () => {
    const { data } = plan();
    expect(data.suppliers?.find((s) => s.name === 'ALPHA VALVE  CO')).toMatchObject({
      companyType: 'Производство', direction: 'Арматура', specialization: 'Краны', products: 'Шаровые краны', priceNote: 'от 8 юаней',
      contactPerson: 'Mr. Li', phone: '8613900000000', email: 'li@alpha.example', city: 'Ningbo', province: 'Zhejiang',
      address: 'No. 1, Example Road', website: 'https://alpha.example', comment: 'надёжный',
    });
    expect(data.agents).toEqual([expect.objectContaining({
      name: 'Агент Восток', contactPerson: 'Анна', city: 'Ningbo', province: 'Zhejiang', email: 'agent@east.example', requisites: 'счёт 000', comment: 'через банк',
    })]);
    expect(data.carriers).toEqual([expect.objectContaining({
      name: 'Логист Север', type: 'Карго', specialization: 'Авто', contactPerson: 'Олег', email: 'north@log.example',
      contractValidUntil: '2026-12-31', contractSigned: true,
    })]);
  });

  it('счётчики предпросмотра — по числу записей', () => {
    const { stats } = plan();
    expect(stats).toMatchObject({ orders: 3, supplierOrders: 4, lines: 5, suppliers: 4, costs: 4, rates: 3, cities: 3, agents: 1, carriers: 1, shipments: 1, batches: 2 });
  });
});

describe('mapLegacy — сумма в валюте без валюты', () => {
  it('K без L не теряется: сумма в рублях по N, K — в комментарии, по строке проблема', () => {
    const costsSheet = SYNTHETIC_LEGACY.sheets['Затраты по заказам'];
    const extra = ['', serial('2026-03-20'), '', 3, '', '', '', '', 'Доставка', 'до склада', 250, '', 11, 2750];
    const raw = { sheets: { ...SYNTHETIC_LEGACY.sheets, 'Затраты по заказам': { hidden: false, values: [...costsSheet.values, extra] } } };
    const { data, problems } = mapLegacy(raw, TODAY);
    const o3 = orderBy(data.orders, 3)!;
    const cost = data.costs?.find((c) => c.targetId === o3.id);
    expect(cost).toMatchObject({ currency: 'RUB', amount: 2750, amountRub: 2750 });
    expect(cost?.comment).toBe('до склада; Сумма в валюте (валюта не указана): 250');
    expect(problems).toContainEqual({ sheet: 'Затраты по заказам', row: costsSheet.values.length + 1, message: expect.stringMatching(/сумма в валюте 250.*валюта не указана/i) });
  });
});

describe('mapLegacy — сумма в валюте без валюты и без рублей', () => {
  it('K без L и N не становится рублями: сумма пустая, K — в комментарии, по строке проблема', () => {
    const costsSheet = SYNTHETIC_LEGACY.sheets['Затраты по заказам'];
    const extra = ['', serial('2026-03-21'), '', 3, '', '', '', '', 'Комиссия банка', '', 180];
    const raw = { sheets: { ...SYNTHETIC_LEGACY.sheets, 'Затраты по заказам': { hidden: false, values: [...costsSheet.values, extra] } } };
    const { data, problems } = mapLegacy(raw, TODAY);
    const o3 = orderBy(data.orders, 3)!;
    const cost = data.costs?.find((c) => c.targetId === o3.id);
    expect(cost).toBeDefined();
    expect(cost?.amount).toBeUndefined();
    expect(cost?.amountRub).toBeUndefined();
    expect(cost?.comment).toBe('Сумма в валюте (валюта не указана): 180');
    expect(problems).toContainEqual({ sheet: 'Затраты по заказам', row: costsSheet.values.length + 1, message: expect.stringMatching(/сумма в валюте 180.*валюта не указана/i) });
  });
});

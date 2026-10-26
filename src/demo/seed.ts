// Синтетический набор для демо-режима. Все названия, люди и числа выдуманы и помечены «Демо».

import type { Dataset, ListItem, ListKey, Rate } from '../domain/model';

const list = (key: ListKey, values: string[]): ListItem[] =>
  values.map((value, i) => ({ id: `demo_list_${key}_${i + 1}`, list: key, value, order: i + 1 }));

const rate = (date: string, currency: Rate['currency'], value: number): Rate =>
  ({ id: `r_${date}_${currency}_vtb`, date, currency, rate: value, source: 'vtb', comment: 'демо' });

export function demoSeed(): Partial<Dataset> {
  return {
    settings: { vatRateDefault: '22', bitrixPortalUrl: '', ratesSourceUrl: '' },
    meta: { schemaVersion: '1' },
    lists: [
      ...list('payer', ['Демо-плательщик 1', 'Демо-плательщик 2']),
      ...list('department', ['Демо-цех', 'Демо-склад']),
      ...list('customer', ['Демо-заказчик Север', 'Демо-заказчик Юг']),
      ...list('costType', [
        'Аванс', 'Предоплата 100 %', 'Оплата перед отгрузкой', 'Итоговый расчёт', 'Комиссия банка', 'Комиссия агента',
        'Доставка', 'СВХ', 'Брокер', 'Терминальная обработка', 'Растаможка/сборы', 'Пошлина', 'НДС', 'Сертификаты', 'Прочее',
      ]),
      ...list('companyType', ['Фабрика', 'Торговая компания']),
      ...list('direction', ['Трубопроводная арматура', 'Электрика']),
      ...list('specialization', ['Краны', 'Кабель']),
      ...list('paymentTerms', ['30/70', '100 % предоплата']),
    ],
    cities: [
      { id: 'demo_city_1', city: 'Нинбо', province: 'Чжэцзян' },
      { id: 'demo_city_2', city: 'Вэньчжоу', province: 'Чжэцзян' },
      { id: 'demo_city_3', city: 'Гуанчжоу', province: 'Гуандун' },
    ],
    rates: [
      rate('2026-09-15', 'CNY', 11.62), rate('2026-09-15', 'USD', 83.1), rate('2026-09-15', 'EUR', 96.4),
      rate('2026-10-01', 'CNY', 11.48), rate('2026-10-01', 'USD', 82.2), rate('2026-10-01', 'EUR', 95.3),
      rate('2026-10-20', 'CNY', 11.55), rate('2026-10-20', 'USD', 82.7), rate('2026-10-20', 'EUR', 95.9),
    ],
    suppliers: [
      { id: 'demo_sup_1', name: 'Демо Valve Factory', companyType: 'Фабрика', direction: 'Трубопроводная арматура', specialization: 'Краны', city: 'Вэньчжоу', province: 'Чжэцзян', contactPerson: 'Демо-контакт', comment: 'демо' },
      { id: 'demo_sup_2', name: 'Демо Cable Trading', companyType: 'Торговая компания', direction: 'Электрика', specialization: 'Кабель', city: 'Гуанчжоу', province: 'Гуандун', comment: 'демо' },
      { id: 'demo_sup_3', name: 'Демо Port Supply', companyType: 'Торговая компания', direction: 'Трубопроводная арматура', city: 'Нинбо', province: 'Чжэцзян', comment: 'демо' },
    ],
    agents: [{ id: 'demo_agent_1', name: 'Демо-агент по оплатам', city: 'Гуанчжоу', province: 'Гуандун', comment: 'демо' }],
    carriers: [{ id: 'demo_carrier_1', name: 'Демо-логистика', type: 'Экспедитор', specialization: 'Море, авто', contractSigned: true, comment: 'демо' }],
    orders: [
      { id: 'demo_ord_1', number: 1, date: '2026-09-10', department: 'Демо-цех', payer: 'Демо-плательщик 1', customer: 'Демо-заказчик Север', title: 'Краны для демо', calcDate: '2026-09-15', costsComplete: true },
      { id: 'demo_ord_2', number: 2, date: '2026-09-28', department: 'Демо-склад', payer: 'Демо-плательщик 2', customer: 'Демо-заказчик Юг', title: 'Кабель и арматура', calcDate: '2026-10-01', costsComplete: false },
      { id: 'demo_ord_3', number: 3, date: '2026-10-20', department: 'Демо-цех', payer: 'Демо-плательщик 1', customer: 'Демо-заказчик Север', title: 'Новый заказ', costsComplete: false },
    ],
    supplierOrders: [
      { id: 'demo_so_1', orderId: 'demo_ord_1', seq: 1, supplierId: 'demo_sup_1', currency: 'CNY', paymentTerms: '30/70', plannedMode: 'sea_container', launchDate: '2026-09-12', productionDays: 20, coef: 1.5 },
      { id: 'demo_so_2', orderId: 'demo_ord_2', seq: 1, supplierId: 'demo_sup_2', currency: 'USD', paymentTerms: '100 % предоплата', plannedMode: 'sea_container', coef: 1.4 },
      { id: 'demo_so_3', orderId: 'demo_ord_2', seq: 2, supplierId: 'demo_sup_3', currency: 'CNY', plannedMode: 'air', coef: 1.5 },
      { id: 'demo_so_4', orderId: 'demo_ord_3', seq: 1, supplierId: 'demo_sup_1', currency: 'CNY', coef: 1.5 },
    ],
    lines: [
      { id: 'demo_ln_1', orderId: 'demo_ord_1', supplierOrderId: 'demo_so_1', seq: 1, customerName: 'Кран шаровой DN50 (демо)', qty: 720, unitPrice: 60, purchased: true, dutyRate: 5, cbm: 2.4, weight: 860, places: 24 },
      { id: 'demo_ln_2', orderId: 'demo_ord_1', supplierOrderId: 'demo_so_1', seq: 2, customerName: 'Кран шаровой DN25 (демо)', qty: 1000, unitPrice: 22.5, purchased: true, dutyRate: 5, cbm: 1.1, weight: 410, places: 11 },
      { id: 'demo_ln_3', orderId: 'demo_ord_2', supplierOrderId: 'demo_so_2', seq: 1, customerName: 'Кабель 3×2,5 (демо)', qty: 50, unitPrice: 180, purchased: true, dutyRate: 10, cbm: 3, weight: 1200, places: 50 },
      { id: 'demo_ln_4', orderId: 'demo_ord_2', supplierOrderId: 'demo_so_3', seq: 1, customerName: 'Фитинг (демо)', qty: 400, unitPrice: 8.4, purchased: true, dutyRate: 7.5, weight: 95, places: 4, coef: 1.6 },   // свой AD позиции — переопределение AD поставщика (1.5)
      { id: 'demo_ln_5', orderId: 'demo_ord_3', supplierOrderId: 'demo_so_4', seq: 1, customerName: 'Задвижка DN100 (демо)', qty: 30, unitPrice: 940, purchased: false },
    ],
    shipments: [
      { id: 'demo_sh_1', number: 'Демо-контейнер 1', mode: 'sea_container', carrierId: 'demo_carrier_1', consolidationDate: '2026-10-05', sentDate: '2026-10-08', vatRate: 22 },
    ],
    declarations: [{ id: 'demo_decl_1', shipmentId: 'demo_sh_1', number: 'ДЕМО-0001', date: '2026-10-22' }],
    batches: [
      { id: 'demo_b_1', shipmentId: 'demo_sh_1', lineId: 'demo_ln_1', qty: 720, cbm: 2.4, weight: 860, places: 24, declarationId: 'demo_decl_1' },
      { id: 'demo_b_2', shipmentId: 'demo_sh_1', lineId: 'demo_ln_2', qty: 1000, cbm: 1.1, weight: 410, places: 11, declarationId: 'demo_decl_1' },
      { id: 'demo_b_3', shipmentId: 'demo_sh_1', lineId: 'demo_ln_3', qty: 30, cbm: 1.8, weight: 720, places: 30, declarationId: 'demo_decl_1' },
    ],
    costs: [
      { id: 'demo_cost_1', entryDate: '2026-09-12', paymentDate: '2026-09-12', status: 'fact', targetType: 'supplierOrder', targetId: 'demo_so_1', costType: 'Аванс', payeeType: 'supplier', payeeId: 'demo_sup_1', amount: 19710, currency: 'CNY', rate: 11.6, rateDate: '2026-09-12', rateManual: true, amountRub: 228636 },
      { id: 'demo_cost_2', entryDate: '2026-10-02', paymentDate: '2026-10-02', status: 'fact', targetType: 'supplierOrder', targetId: 'demo_so_1', costType: 'Итоговый расчёт', payeeType: 'supplier', payeeId: 'demo_sup_1', amount: 45990, currency: 'CNY', rate: 11.48, rateDate: '2026-10-01', rateManual: false, amountRub: 527965.2 },
      { id: 'demo_cost_3', entryDate: '2026-10-02', paymentDate: '2026-10-02', status: 'fact', targetType: 'supplierOrder', targetId: 'demo_so_1', costType: 'Комиссия агента', payeeType: 'agent', payeeId: 'demo_agent_1', amount: 650, currency: 'CNY', rate: 11.48, rateDate: '2026-10-01', rateManual: false, amountRub: 7462 },
      { id: 'demo_cost_4', entryDate: '2026-10-08', status: 'plan', targetType: 'shipment', targetId: 'demo_sh_1', costType: 'Доставка', payeeType: 'carrier', payeeId: 'demo_carrier_1', amount: 3200, currency: 'USD', rateManual: false },
      { id: 'demo_cost_5', entryDate: '2026-10-22', status: 'plan', targetType: 'declaration', targetId: 'demo_decl_1', costType: 'Растаможка/сборы', payeeType: 'text', payeeText: 'Демо-брокер', amount: 15000, currency: 'RUB', rateManual: false },
      { id: 'demo_cost_6', entryDate: '2026-09-29', status: 'plan', targetType: 'order', targetId: 'demo_ord_2', costType: 'Предоплата 100 %', amount: 9000, currency: 'USD', rateManual: false },
    ],
  };
}

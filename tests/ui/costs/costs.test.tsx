import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DataProvider } from '../../../src/ui/DataContext';
import { LocalStore } from '../../../src/store/localStore';
import type { Cost, Dataset, Rate } from '../../../src/domain/model';
import CostsScreen from '../../../src/ui/screens/costs/CostsScreen';
import { computeCosting } from '../../../src/domain/costing';

let counter = 0;

function show(store: LocalStore, path = '/costs') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider store={store} today="2026-10-25">
        <CostsScreen />
      </DataProvider>
    </MemoryRouter>,
  );
}

function renderCosts(seed: Partial<Dataset>, path?: string) {
  const store = new LocalStore(`zk:t:costs${++counter}`, seed);
  show(store, path);
  return { store };
}

const vtb = (date: string, currency: Rate['currency'], rate: number): Rate => ({ id: `r_${date}_${currency}_vtb`, date, currency, rate, source: 'vtb' });

const baseCost = (over: Partial<Cost> & Pick<Cost, 'id'>): Cost => ({
  entryDate: '2026-10-01', status: 'fact', targetType: 'order', targetId: 'o12', costType: 'Аванс', currency: 'RUB', rateManual: false, ...over,
});

const seed: Partial<Dataset> = {
  rates: [
    vtb('2026-10-01', 'CNY', 11.3), vtb('2026-10-20', 'CNY', 11.4), vtb('2026-10-24', 'CNY', 11.5),
    vtb('2026-10-24', 'USD', 81), vtb('2026-10-10', 'USD', 80),
  ],
  lists: [
    { id: 'l1', list: 'costType', value: 'Аванс', order: 1 },
    { id: 'l2', list: 'costType', value: 'Свой тип', order: 2 },
  ],
  suppliers: [{ id: 's1', name: 'Alpha Valve' }, { id: 's2', name: 'Beta Cable' }],
  agents: [{ id: 'a1', name: 'Агент Один' }],
  carriers: [{ id: 'k1', name: 'Море-Транс' }],
  orders: [
    { id: 'o12', number: 12, date: '2026-09-01', calcDate: '2026-10-01', costsComplete: false },
    { id: 'o6', number: 6, date: '2026-08-01', costsComplete: false },
  ],
  supplierOrders: [
    { id: 'so1', orderId: 'o12', seq: 1, supplierId: 's1', currency: 'CNY' },
    { id: 'so2', orderId: 'o6', seq: 1, supplierId: 's2', currency: 'USD', calcDate: '2026-10-10' },
  ],
  shipments: [{ id: 'sh1', number: 'К-7', mode: 'sea_container', vatRate: 22 }],
  declarations: [{ id: 'd1', shipmentId: 'sh1', number: '10702/1' }],
};

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const set = (label: RegExp | string, value: string) => fireEvent.change(field(label), { target: { value } });

async function openNew() {
  fireEvent.click(await screen.findByRole('button', { name: 'Добавить затрату' }));
}

/** Факт на поставщика so1 в юанях, тип «Аванс», с датой оплаты. */
function fillFactCny(paymentDate: string) {
  set(/^Привязка/, 'supplierOrder');
  set(/^Объект привязки/, 'so1');
  set(/^Тип затраты/, 'Аванс');
  set(/^Валюта/, 'CNY');
  set(/^Дата оплаты/, paymentDate);
}

const saved = async (store: LocalStore, n: number) => {
  await waitFor(async () => expect((await store.load()).costs).toHaveLength(n));
  return (await store.load()).costs;
};

describe('форма затраты: автокурс', () => {
  it('факт в юанях: курс ВТБ на дату оплаты подставляется сам, нет точного — «курс от <дата>»', async () => {
    renderCosts(seed);
    await openNew();
    fillFactCny('2026-10-24');
    expect(field(/^Курс/).value).toBe('11,5');
    expect(screen.getByText(/курс ВТБ на 24\.10\.2026/)).toBeTruthy();
    set(/^Дата оплаты/, '2026-10-22');
    expect(field(/^Курс/).value).toBe('11,4');
    expect(screen.getByText(/курс от 20\.10\.2026/)).toBeTruthy();
  });

  it('сохранённая затрата хранит курс, дату курса и сумму в рублях; поздняя правка листа «Курсы» её не меняет', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    fillFactCny('2026-10-25');
    set(/^Сумма в валюте/, '100');
    expect(field(/^Сумма в рублях/).value).toBe('1150');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ status: 'fact', currency: 'CNY', amount: 100, rate: 11.5, rateDate: '2026-10-24', rateManual: false, amountRub: 1150, paymentDate: '2026-10-25' });

    // лист «Курсы» поправили задним числом и добавили курс на дату оплаты
    await store.update('rates', vtb('2026-10-24', 'CNY', 12));
    await store.insert('rates', vtb('2026-10-25', 'CNY', 13));
    cleanup();
    show(store);
    const row = (await screen.findByText('Аванс', { selector: 'td' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('1 150,00')).toBeTruthy();
    fireEvent.click(row);
    expect(field(/^Курс/).value).toBe('11,5');
    set(/^Комментарий/, 'проверено');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].comment).toBe('проверено'));
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11.5, rateDate: '2026-10-24', amountRub: 1150 });
  });

  it('рубли: курс 1, сумма в рублях равна сумме', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    set(/^Привязка/, 'order');
    set(/^Объект привязки/, 'o12');
    set(/^Тип затраты/, 'Свой тип');
    set(/^Валюта/, 'RUB');
    set(/^Дата оплаты/, '2026-10-24');
    expect(field(/^Курс/).value).toBe('1');
    set(/^Сумма в валюте/, '5000');
    expect(field(/^Сумма в рублях/).value).toBe('5000');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ currency: 'RUB', amount: 5000, amountRub: 5000, rate: 1, costType: 'Свой тип' });
  });

  it('курс, поправленный руками, — «курс вручную»; смена даты его не перезаписывает; без правки — перезаписывает', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    fillFactCny('2026-10-24');
    set(/^Курс/, '12,1');
    expect(screen.getByText(/курс вручную/)).toBeTruthy();
    set(/^Дата оплаты/, '2026-10-20');
    expect(field(/^Курс/).value).toBe('12,1');
    set(/^Валюта/, 'USD');
    expect(field(/^Курс/).value).toBe('12,1');
    set(/^Валюта/, 'CNY');
    set(/^Сумма в валюте/, '10');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ rate: 12.1, rateManual: true, rateDate: '2026-10-20' });
    expect(c.amountRub).toBeCloseTo(121, 10);
  });

  it('«Подставить курс из истории» снимает ручную правку', async () => {
    renderCosts(seed);
    await openNew();
    fillFactCny('2026-10-24');
    set(/^Курс/, '12,1');
    fireEvent.click(screen.getByRole('button', { name: 'Подставить курс из истории' }));
    expect(field(/^Курс/).value).toBe('11,5');
    expect(screen.queryByText(/курс вручную/)).toBeNull();
  });

  it('сумма в рублях досчитывает сумму в валюте и наоборот', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    fillFactCny('2026-10-24');
    set(/^Сумма в рублях/, '2300');
    expect(field(/^Сумма в валюте/).value).toBe('200');
    set(/^Сумма в валюте/, '10');
    expect(field(/^Сумма в рублях/).value).toBe('115');
    set(/^Сумма в рублях/, '1000');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c.amountRub).toBe(1000);
    expect(c.amount).toBeCloseTo(1000 / 11.5, 10);
    expect(c.rate).toBe(11.5);
  });

  it('нет курса на дату — «нет курса — введите вручную»; введённый курс можно сохранить в историю (manual)', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    fillFactCny('2026-09-15');
    expect(screen.getByText('нет курса — введите вручную')).toBeTruthy();
    expect(field(/^Курс/).value).toBe('');
    set(/^Сумма в валюте/, '100');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Нет курса — введите курс вручную')).toBeTruthy();
    expect((await store.load()).costs).toHaveLength(0);

    set(/^Курс/, '11,2');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить этот курс в историю' }));
    await waitFor(async () => expect((await store.load()).rates).toHaveLength(6));
    expect((await store.load()).rates.find((r) => r.date === '2026-09-15')).toMatchObject({ currency: 'CNY', rate: 11.2, source: 'manual' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ rate: 11.2, rateDate: '2026-09-15' });
    expect(c.amountRub).toBeCloseTo(1120, 10);
  });
});

describe('сохранённая затрата: курс не перезаписывается', () => {
  it('импортированная затрата с курсом вручную: смена даты оплаты и перепривязка заказ → поставщик курс не меняют', async () => {
    const imported = baseCost({ id: 'ci', targetType: 'order', targetId: 'o12', currency: 'CNY', amount: 100, paymentDate: '2026-10-24', rate: 11, rateDate: '2026-10-24', rateManual: true, amountRub: 1100, comment: 'импорт' });
    const { store } = renderCosts({ ...seed, costs: [imported] });
    fireEvent.click((await screen.findByText('импорт')).closest('tr') as HTMLElement);
    expect(field(/^Курс/).value).toBe('11');
    set(/^Дата оплаты/, '2026-10-20');
    expect(field(/^Курс/).value).toBe('11');
    set(/^Привязка/, 'supplierOrder');
    set(/^Объект привязки/, 'so1');
    expect(field(/^Курс/).value).toBe('11');
    expect(screen.getByText(/курс вручную/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].targetType).toBe('supplierOrder'));
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11, rateManual: true, amountRub: 1100, paymentDate: '2026-10-20', targetId: 'so1' });
  });

  it('импортированная затрата с курсом вручную: смена статуса туда и обратно курс не меняет', async () => {
    const imported = baseCost({ id: 'ci', currency: 'CNY', amount: 100, paymentDate: '2026-10-24', rate: 11, rateDate: '2026-10-24', rateManual: true, amountRub: 1100, comment: 'импорт' });
    const { store } = renderCosts({ ...seed, costs: [imported] });
    fireEvent.click((await screen.findByText('импорт')).closest('tr') as HTMLElement);
    set(/^Статус/, 'plan');
    expect(field(/^Курс/).value).toBe('11');
    set(/^Статус/, 'fact');
    expect(field(/^Курс/).value).toBe('11');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].comment).toBe('импорт'));
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11, rateManual: true, amountRub: 1100, status: 'fact' });
  });

  it('«92о» в «Курсе» — текст и «Введите число» остаются, затрата не сохраняется', async () => {
    const cny = baseCost({ id: 'cn', targetType: 'order', targetId: 'o12', currency: 'CNY', amount: 100, paymentDate: '2026-10-25', rate: 11.45, rateDate: '2026-10-24', rateManual: false, amountRub: 1145, comment: 'юани' });
    const { store } = renderCosts({ ...seed, costs: [cny] });
    fireEvent.click((await screen.findByText('юани')).closest('tr') as HTMLElement);
    set(/^Курс/, '92');
    set(/^Курс/, '92о');
    expect(field(/^Курс/).value).toBe('92о');
    expect(screen.getByText('Введите число')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(field(/^Курс/).value).toBe('92о');
    expect(screen.getByText('Введите число')).toBeTruthy();
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11.45, amountRub: 1145 });
  });

  it('факт с зафиксированным курсом ВТБ: перепривязка и смена статуса туда и обратно курс не меняют', async () => {
    const fixed = baseCost({ id: 'cf', targetType: 'order', targetId: 'o12', currency: 'CNY', amount: 100, paymentDate: '2026-10-25', rate: 11.45, rateDate: '2026-10-24', rateManual: false, amountRub: 1145, comment: 'фикс' });
    const { store } = renderCosts({ ...seed, costs: [fixed] });
    fireEvent.click((await screen.findByText('фикс')).closest('tr') as HTMLElement);
    expect(field(/^Курс/).value).toBe('11,45');
    set(/^Привязка/, 'supplierOrder');
    set(/^Объект привязки/, 'so1');
    expect(field(/^Курс/).value).toBe('11,45');
    set(/^Статус/, 'plan');
    set(/^Статус/, 'fact');
    expect(field(/^Курс/).value).toBe('11,45');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].targetId).toBe('so1'));
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11.45, rateDate: '2026-10-24', rateManual: false, amountRub: 1145, status: 'fact' });
  });

  it('факт с зафиксированным курсом ВТБ, переведённый в план, считается по дате расчёта — форма = журнал = движок', async () => {
    const fixed = baseCost({ id: 'cf', targetType: 'supplierOrder', targetId: 'so1', currency: 'CNY', amount: 100, paymentDate: '2026-10-25', rate: 11.45, rateDate: '2026-10-24', rateManual: false, amountRub: 1145, comment: 'фикс' });
    const { store } = renderCosts({ ...seed, costs: [fixed] });
    fireEvent.click((await screen.findByText('фикс')).closest('tr') as HTMLElement);
    set(/^Статус/, 'plan');
    expect(field(/^Сумма в рублях/).value).toBe('1130');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].status).toBe('plan'));
    const ds = await store.load();
    expect(ds.costs[0].rateManual).toBe(false);
    expect(computeCosting(ds, '2026-10-25').costsRub[0].rub).toBeCloseTo(1130, 10);
    const row = screen.getByText('фикс').closest('tr') as HTMLElement;
    expect(within(row).getByText('1 130,00')).toBeTruthy();
  });

  it('план с ручным курсом: рубли в форме = в журнале = costsRub движка, в том числе после смены даты расчёта', async () => {
    const plan = baseCost({ id: 'pm', status: 'plan', targetType: 'supplierOrder', targetId: 'so1', currency: 'CNY', amount: 100, rate: 12, rateManual: true, comment: 'план-ручной' });
    const { store } = renderCosts({ ...seed, costs: [plan] });
    const row = (await screen.findByText('план-ручной')).closest('tr') as HTMLElement;
    const engine = computeCosting(await store.load(), '2026-10-25').costsRub.find((r) => r.costId === 'pm')!;
    expect(engine.rub).toBeCloseTo(1200, 10);
    expect(within(row).getByText('1 200,00')).toBeTruthy();
    fireEvent.click(row);
    expect(field(/^Курс/).value).toBe('12');
    expect(field(/^Сумма в рублях/).value).toBe('1200');
    set(/^Дата оплаты/, '2026-10-24');
    set(/^Сумма в рублях/, '2400');
    expect(field(/^Сумма в валюте/).value).toBe('200');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].paymentDate).toBe('2026-10-24'));
    const ds = await store.load();
    expect(ds.costs[0]).toMatchObject({ status: 'plan', rate: 12, rateManual: true });
    // дата расчёта заказа сменилась — ручной курс плана держится и в движке
    ds.orders[0].calcDate = '2026-10-24';
    expect(computeCosting(ds, '2026-10-25').costsRub[0].rub).toBeCloseTo(2400, 10);
    expect(within(screen.getByText('план-ручной').closest('tr') as HTMLElement).getByText('2 400,00')).toBeTruthy();
  });
});

describe('форма затраты: план и факт', () => {
  it('план без даты оплаты — рубли по курсу даты расчёта заказа; курс в записи не фиксируется', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    set(/^Статус/, 'plan');
    set(/^Привязка/, 'supplierOrder');
    set(/^Объект привязки/, 'so1');
    set(/^Тип затраты/, 'Аванс');
    set(/^Валюта/, 'CNY');
    set(/^Сумма в валюте/, '100');
    expect(field(/^Курс/).value).toBe('11,3');
    expect(field(/^Сумма в рублях/).value).toBe('1130');
    expect(screen.getByText(/курс даты расчёта 01\.10\.2026/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ status: 'plan', amount: 100, currency: 'CNY', rateManual: false });
    expect(c.rate).toBeUndefined();
    expect(c.amountRub).toBeUndefined();
    const row = (await screen.findByText('Аванс', { selector: 'td' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('1 130,00')).toBeTruthy();
  });

  it('план на поставщика с датой расчёта у поставщика — курс на неё', async () => {
    renderCosts(seed);
    await openNew();
    set(/^Статус/, 'plan');
    set(/^Привязка/, 'supplierOrder');
    set(/^Объект привязки/, 'so2');
    expect((field(/^Валюта/) as unknown as HTMLSelectElement).value).toBe('USD');
    set(/^Сумма в валюте/, '10');
    expect(field(/^Курс/).value).toBe('80');
    expect(field(/^Сумма в рублях/).value).toBe('800');
  });

  it('перевод план → факт требует дату оплаты и фиксирует курс на неё', async () => {
    const plan = baseCost({ id: 'cp', status: 'plan', targetType: 'supplierOrder', targetId: 'so1', currency: 'CNY', amount: 100, comment: 'план-аванс' });
    const { store } = renderCosts({ ...seed, costs: [plan] });
    fireEvent.click((await screen.findByText('план-аванс')).closest('tr') as HTMLElement);
    set(/^Статус/, 'fact');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Для фактической затраты укажите дату оплаты')).toBeTruthy();
    expect((await store.load()).costs[0].status).toBe('plan');
    set(/^Дата оплаты/, '2026-10-24');
    expect(field(/^Курс/).value).toBe('11,5');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(async () => expect((await store.load()).costs[0].status).toBe('fact'));
    expect((await store.load()).costs[0]).toMatchObject({ rate: 11.5, rateDate: '2026-10-24', amountRub: 1150, paymentDate: '2026-10-24' });
  });

  it('обязательные поля: привязка и тип затраты — ошибки у полей', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(await screen.findByText('Выберите, к чему относится затрата')).toBeTruthy();
    expect(screen.getByText('Выберите тип затраты')).toBeTruthy();
    expect(screen.getByText('Введите сумму в валюте или в рублях')).toBeTruthy();
    expect((await store.load()).costs).toHaveLength(0);
  });
});

describe('форма затраты: тип, получатель, реквизиты', () => {
  it('тип затраты — свои из списка и стандартные; получатель — из справочника или текстом', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    const types = Array.from((field(/^Тип затраты/) as unknown as HTMLSelectElement).options).map((o) => o.value);
    expect(types).toEqual(expect.arrayContaining(['Аванс', 'Свой тип', 'Пошлина', 'НДС', 'Комиссия агента', 'СВХ']));
    expect(types.filter((t) => t === 'Аванс')).toHaveLength(1);

    set(/^Привязка/, 'shipment');
    set(/^Объект привязки/, 'sh1');
    set(/^Тип затраты/, 'Комиссия агента');
    set(/^Кому платим/, 'agent');
    set(/^Получатель/, 'a1');
    set(/^Исполнитель операции/, 'Иванов');
    set(/^Номер счёта/, 'INV-7');
    set(/^Дата счёта/, '2026-10-20');
    set(/^Дата оплаты/, '2026-10-24');
    set(/^Валюта/, 'USD');
    set(/^Сумма в валюте/, '50');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({
      targetType: 'shipment', targetId: 'sh1', costType: 'Комиссия агента', payeeType: 'agent', payeeId: 'a1',
      executor: 'Иванов', invoiceNumber: 'INV-7', invoiceDate: '2026-10-20', rate: 81, amountRub: 4050,
    });
    const row = (await screen.findByText('Комиссия агента', { selector: 'td' })).closest('tr') as HTMLElement;
    expect(within(row).getByText('Агент Один')).toBeTruthy();
    expect(within(row).getByText('Поставка К-7')).toBeTruthy();
  });

  it('получатель текстом', async () => {
    const { store } = renderCosts(seed);
    await openNew();
    set(/^Привязка/, 'declaration');
    set(/^Объект привязки/, 'd1');
    set(/^Тип затраты/, 'Брокер');
    set(/^Кому платим/, 'text');
    set(/^Получатель \(текстом\)/, 'ООО Брокер');
    set(/^Дата оплаты/, '2026-10-24');
    set(/^Сумма в валюте/, '15000');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    const [c] = await saved(store, 1);
    expect(c).toMatchObject({ payeeType: 'text', payeeText: 'ООО Брокер', targetType: 'declaration', targetId: 'd1' });
    expect(c.payeeId).toBeUndefined();
  });
});

describe('журнал затрат', () => {
  const costs: Cost[] = [
    baseCost({ id: 'c1', costType: 'Аванс', paymentDate: '2026-09-10', amount: 1000, amountRub: 1000, rate: 1, comment: 'первый' }),
    baseCost({ id: 'c2', costType: 'Доставка', targetType: 'shipment', targetId: 'sh1', paymentDate: '2026-10-05', currency: 'USD', amount: 100, rate: 80, rateDate: '2026-10-05', amountRub: 8000, comment: 'второй' }),
    baseCost({ id: 'c3', costType: 'Пошлина', targetType: 'declaration', targetId: 'd1', status: 'plan', amount: 500, comment: 'третий' }),
    baseCost({ id: 'c4', costType: 'Аванс', targetType: 'supplierOrder', targetId: 'so2', paymentDate: '2026-10-20', currency: 'USD', amount: 10, rate: 79, rateDate: '2026-10-20', rateManual: true, amountRub: 790, comment: 'четвёртый' }),
  ];
  const visible = () => ['первый', 'второй', 'третий', 'четвёртый'].filter((t) => screen.queryByText(t));

  it('колонки журнала и все строки; курс вручную помечен', async () => {
    renderCosts({ ...seed, costs });
    await screen.findByText('первый');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Дата заполнения', 'Дата оплаты', 'Статус', 'Привязка', 'Тип', 'Кому платим', 'Исполнитель', 'Счёт', 'Сумма', 'Валюта', 'Курс', 'Сумма, ₽', 'Комментарий']);
    expect(visible()).toHaveLength(4);
    const row4 = screen.getByText('четвёртый').closest('tr') as HTMLElement;
    expect(within(row4).getByText(/вручную/)).toBeTruthy();
    expect(within(row4).getByText('Заказ № 6 · поставщик 1 — Beta Cable')).toBeTruthy();
  });

  it('фильтры: заказ, поставка, тип, план/факт, период', async () => {
    renderCosts({ ...seed, costs });
    await screen.findByText('первый');
    set('Заказ', 'o12');
    expect(visible()).toEqual(['первый']);
    set('Заказ', '');
    set('Поставка', 'sh1');
    expect(visible()).toEqual(['второй', 'третий']);
    set('Поставка', '');
    set('Тип', 'Аванс');
    expect(visible()).toEqual(['первый', 'четвёртый']);
    set('Тип', '');
    set('План/факт', 'plan');
    expect(visible()).toEqual(['третий']);
    set('План/факт', '');
    set('Период с', '2026-10-01');
    set('по', '2026-10-10');
    expect(visible()).toEqual(['второй', 'третий']);
  });

  it('фильтр заказа из адреса ?order=', async () => {
    renderCosts({ ...seed, costs }, '/costs?order=o6');
    await screen.findByText('четвёртый');
    expect(visible()).toEqual(['четвёртый']);
  });

  it('затрату можно удалить из карточки', async () => {
    const { store } = renderCosts({ ...seed, costs });
    fireEvent.click((await screen.findByText('второй')).closest('tr') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Да, удалить' }));
    await waitFor(async () => expect((await store.load()).costs.map((c) => c.id)).toEqual(['c1', 'c3', 'c4']));
  });

  it('пустой журнал — «Затрат пока нет» и кнопка добавления', async () => {
    renderCosts(seed);
    expect(await screen.findByText('Затрат пока нет')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Добавить затрату' })).toBeTruthy();
  });
});

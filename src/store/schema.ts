// Схема листов таблицы пользователя — единственный источник правды (используют store, setup и import).
// Даты пишутся serial-числами Google Sheets (эпоха 1899-12-30), читаются из UNFORMATTED_VALUE + SERIAL_NUMBER.

import type { EntityName } from '../domain/model';

export type ColType = 'string' | 'number' | 'int' | 'bool' | 'date' | 'datetime' | 'formula';
/** Разделитель аргументов в формулах: зависит от локали таблицы (ru_RU — «;»), G27. */
export type FormulaSeparator = ',' | ';';
export interface ColumnDef { key: string; header: string; type: ColType; formula?: (rowRef: (key: string) => string, sep?: FormulaSeparator) => string }
export interface SheetDef { entity: EntityName | 'settings' | 'meta' | 'log'; sheet: string; columns: ColumnDef[] }
export type Cell = string | number | boolean | null;

export const SCHEMA_VERSION = 1;
/** Лист отчёта A01 — пишется целиком, свободный формат, в SHEETS не входит. */
export const REPORT_SHEET = 'Себестоимость' as const;

const c = (key: string, header: string, type: ColType = 'string'): ColumnDef => ({ key, header, type });
const id = c('id', 'id');
const translate = (sourceKey: string) => (rowRef: (key: string) => string, sep: FormulaSeparator = ',') => {
  const ref = rowRef(sourceKey);
  return `=IF(ISBLANK(${ref})${sep}""${sep}GOOGLETRANSLATE(${ref}${sep}"ru"${sep}"en"))`;
};

export const SHEETS: SheetDef[] = [
  { entity: 'meta', sheet: '_meta', columns: [c('key', 'Ключ'), c('value', 'Значение')] },
  { entity: 'settings', sheet: 'Настройки', columns: [c('key', 'Ключ'), c('value', 'Значение')] },
  { entity: 'log', sheet: 'Лог', columns: [c('time', 'Время', 'datetime'), c('level', 'Уровень'), c('message', 'Сообщение'), c('details', 'Подробности')] },
  { entity: 'rates', sheet: 'Курсы', columns: [id, c('date', 'Дата', 'date'), c('currency', 'Валюта'), c('rate', 'Курс', 'number'), c('source', 'Источник'), c('loadedAt', 'Загружено', 'datetime'), c('comment', 'Комментарий')] },
  { entity: 'lists', sheet: 'Списки', columns: [id, c('list', 'Список'), c('value', 'Значение'), c('order', 'Порядок', 'int')] },
  // G21: география. Провинция у города — названием; countryId, страна поставщика и агента — в конце, ensureSchema дописывает их в старые таблицы.
  { entity: 'countries', sheet: 'Страны', columns: [id, c('name', 'Страна')] },
  { entity: 'provinces', sheet: 'Провинции', columns: [id, c('name', 'Провинция'), c('countryId', 'countryId')] },
  { entity: 'cities', sheet: 'Города', columns: [id, c('city', 'Город'), c('province', 'Провинция'), c('population', 'Население', 'int'), c('countryId', 'countryId')] },
  {
    entity: 'suppliers', sheet: 'Поставщики', columns: [
      id, c('name', 'Компания'), c('companyType', 'Тип компании'), c('direction', 'Направление'), c('specialization', 'Специализация'),
      c('products', 'Продукция/услуги'), c('priceNote', 'Цена'), c('contactPerson', 'Контактное лицо'), c('phone', 'Телефон'), c('email', 'Почта'),
      c('city', 'Город'), c('province', 'Провинция'), c('address', 'Адрес'), c('website', 'Сайт'), c('bankBeneficiary', 'Получатель'),
      c('bankName', 'Банк'), c('bankAccount', 'Счёт'), c('bankSwift', 'SWIFT'), c('bankAddress', 'Адрес банка'), c('comment', 'Комментарий'),
      c('createdAt', 'Создан', 'datetime'), c('country', 'Страна'),
    ],
  },
  {
    entity: 'agents', sheet: 'Платежные агенты', columns: [
      id, c('name', 'Наименование'), c('contactPerson', 'Контактное лицо'), c('legalAddress', 'Юридический адрес'), c('city', 'Город'),
      c('province', 'Провинция'), c('phone', 'Телефон'), c('email', 'email'), c('requisites', 'Реквизиты'), c('comment', 'Комментарий'),
      c('country', 'Страна'),
    ],
  },
  {
    entity: 'carriers', sheet: 'Перевозчики', columns: [
      id, c('name', 'Наименование перевозчика'), c('type', 'Тип'), c('specialization', 'Специализация'), c('contactPerson', 'Контактное лицо'),
      c('phone', 'Телефон'), c('email', 'почта'), c('website', 'сайт'), c('contracts', 'Договора'), c('contractValidUntil', 'Срок действия договора', 'date'),
      c('contractSigned', 'Договор подписан?', 'bool'), c('comment', 'Комментарий'),
    ],
  },
  {
    entity: 'orders', sheet: 'Заказы', columns: [
      id, c('number', 'Заказ', 'int'), c('date', 'Дата заказа', 'date'), c('department', 'Подразделение'), c('payer', 'Плательщик'),
      c('customer', 'Заказчик'), c('title', 'Название'), c('bitrixTaskId', 'ID задачи Битрикс'), c('calcDate', 'Дата расчёта', 'date'),
      c('costsComplete', 'Все затраты внесены', 'bool'), c('comment', 'Комментарий'), c('createdAt', 'Создан', 'datetime'),
      c('code', 'Номер заказа'),   // G33: «З-ГГГГ-NNN»; в конце — ensureSchema дописывает её в существующие таблицы
    ],
  },
  {
    entity: 'supplierOrders', sheet: 'Поставщики в заказе', columns: [
      id, c('orderId', 'orderId'), c('seq', '№ поставщика', 'int'), c('supplierId', 'supplierId'), c('bitrixTaskId', 'ID задачи Битрикс'),
      c('currency', 'Валюта'), c('calcDate', 'Дата расчёта', 'date'), c('calcRate', 'Курс расчёта вручную', 'number'), c('paymentTerms', 'Условия оплаты'),
      c('plannedMode', 'План. доставка'), c('launchDate', 'Дата запуска', 'date'), c('productionDays', 'Срок изготовления, дн', 'int'),
      c('actualReadyDate', 'Факт. готовность', 'date'), c('comment', 'Комментарий'),
      c('coef', 'Коэффициент AD', 'number'),   // G05: в конце — ensureSchema дописывает её в существующие таблицы
    ],
  },
  {
    entity: 'lines', sheet: 'Позиции', columns: [
      id, c('orderId', 'orderId'), c('supplierOrderId', 'supplierOrderId'), c('seq', '№ позиции', 'int'), c('customerName', 'Название от заказчика'),
      c('techParams', 'Тех. параметры'), c('docName', 'Название в документах'), c('supplierName', 'Product name from supplier'), c('qty', 'Кол-во', 'number'),
      c('unitPrice', 'Цена в валюте', 'number'), c('purchased', 'Закупка', 'bool'), c('hsCode', 'HS Code'), c('dutyRate', 'Пошлина %', 'number'),
      c('packaging', 'Упаковка'), c('packageSize', 'Размер упаковки'), c('cbm', 'CBM', 'number'), c('weight', 'Вес, кг', 'number'), c('places', 'Мест', 'int'),
      c('coef', 'Коэффициент AD', 'number'), c('comment', 'Комментарий'),
      { key: 'customerNameEn', header: 'Name EN (авто)', type: 'formula', formula: translate('customerName') },
      { key: 'techParamsEn', header: 'Tech EN (авто)', type: 'formula', formula: translate('techParams') },
    ],
  },
  // G29: тип поставки — справочник с правилом деления доставки ('cbm' | 'weight').
  { entity: 'shipmentTypes', sheet: 'Типы поставки', columns: [id, c('name', 'Название'), c('basis', 'Делить доставку')] },
  {
    entity: 'shipments', sheet: 'Поставки', columns: [
      id, c('number', 'Поставка'), c('mode', 'Тип'), c('carrierId', 'Перевозчик'), c('consolidationDate', 'Отправка на консолидацию', 'date'),
      c('sentDate', 'Отправка в РФ', 'date'), c('arrivalDate', 'Прибытие на СВХ', 'date'), c('vatRate', 'НДС %', 'number'), c('comment', 'Комментарий'),
      c('typeId', 'typeId'), c('containerNo', 'Номер контейнера / накладной'),   // G28/G29: в конце
    ],
  },
  {
    entity: 'batches', sheet: 'Партии', columns: [
      id, c('shipmentId', 'shipmentId'), c('lineId', 'lineId'), c('qty', 'Кол-во', 'number'), c('cbm', 'CBM', 'number'), c('weight', 'Вес, кг', 'number'),
      c('places', 'Мест', 'int'), c('declarationId', 'declarationId'),
    ],
  },
  { entity: 'declarations', sheet: 'Декларации', columns: [id, c('shipmentId', 'shipmentId'), c('number', 'Номер ДТ'), c('date', 'Дата', 'date'), c('comment', 'Комментарий')] },
  {
    entity: 'costs', sheet: 'Затраты', columns: [
      id, c('entryDate', 'Дата заполнения', 'date'), c('paymentDate', 'Дата оплаты', 'date'), c('status', 'Статус'), c('targetType', 'Привязка'),
      c('targetId', 'targetId'), c('costType', 'Тип затрат'), c('payeeType', 'payeeType'), c('payeeId', 'payeeId'), c('payeeText', 'Кому платим'),
      c('executor', 'Исполнитель операции'), c('invoiceNumber', 'Номер счёта'), c('invoiceDate', 'Дата счёта', 'date'), c('amount', 'Сумма в валюте', 'number'),
      c('currency', 'Валюта'), c('rate', 'Курс', 'number'), c('rateDate', 'Дата курса', 'date'), c('rateManual', 'Курс вручную', 'bool'),
      c('amountRub', 'Сумма в р.', 'number'), c('comment', 'Комментарий'),
      c('code', 'Номер затраты'),   // G33: «Р-ГГГГ-<заказ>-NNN» / «Р-ГГГГ-П<NNN>-NNN»; в конце
    ],
  },
];

/** Описание листа сущности. */
export function sheetFor(entity: SheetDef['entity']): SheetDef {
  const def = SHEETS.find((s) => s.entity === entity);
  if (!def) throw new Error(`Нет листа для «${entity}»`);
  return def;
}

/** Строка заголовков листа. */
export function headerRow(def: SheetDef): string[] {
  return def.columns.map((col) => col.header);
}

// ---------- даты ↔ serial ----------

const DAY_MS = 86_400_000;
const EPOCH_OFFSET = 25_569; // serial 1970-01-01
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;

export function dateToSerial(date: string): number | null {
  const m = ISO_DATE.exec(date.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms / DAY_MS + EPOCH_OFFSET : null;
}

export function serialToDate(serial: number): string {
  const ms = Math.round((Math.floor(serial) - EPOCH_OFFSET) * DAY_MS);
  return new Date(ms).toISOString().slice(0, 10);
}

// Serial дата-времени в Sheets — местное время таблицы. Таблица живёт в Europe/Moscow:
// UTC+3 круглый год (летнего времени нет с 2014 г.), поэтому сдвиг постоянный.
const SHEET_TZ_OFFSET_MS = 3 * 3_600_000;

/** Момент ISO 8601 → serial местного времени таблицы (Europe/Moscow). */
export function datetimeToSerial(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? (ms + SHEET_TZ_OFFSET_MS) / DAY_MS + EPOCH_OFFSET : null;
}

/** Serial местного времени таблицы (Europe/Moscow) → ISO 8601 в UTC (`...Z`). */
export function serialToDatetime(serial: number): string {
  return new Date(Math.round((serial - EPOCH_OFFSET) * DAY_MS) - SHEET_TZ_OFFSET_MS).toISOString();
}

// ---------- запись ----------

const isEmpty = (v: unknown) => v === undefined || v === null || v === '';

// Пустое значение обычной колонки → '' (RAW-update очищает ячейку; null Sheets пропускает и оставляет старое).
// Формульная колонка → null: её пишет отдельный USER_ENTERED-запрос, RAW-запись её не трогает.
function toCell(col: ColumnDef, value: unknown): Cell {
  if (col.type === 'formula') return null;
  if (isEmpty(value)) return '';
  switch (col.type) {
    case 'number':
    case 'int': {
      const n = typeof value === 'number' ? value : parseNumber(value);
      return n ?? '';
    }
    case 'bool':
      return parseBool(value);
    case 'date':
      return (typeof value === 'string' ? dateToSerial(value) : null) ?? '';
    case 'datetime':
      return (typeof value === 'string' ? datetimeToSerial(value) : null) ?? '';
    default:
      return String(value);
  }
}

/** Запись → строка листа в порядке колонок схемы (для RAW-записи). Пустые → '', формульные → null. */
export function toRow(def: SheetDef, record: object): Cell[] {
  const rec = record as Record<string, unknown>;
  return def.columns.map((col) => toCell(col, rec[col.key]));
}

// ---------- чтение ----------

function parseNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return undefined;
  const s = String(v).replace(/[\s ]/g, '').replace(',', '.');
  if (s === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === 'да' || s === '1' || s === 'истина' || s === 'yes';
}

function parseDate(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? serialToDate(v) : undefined;
  const s = String(v).trim();
  const iso = ISO_DATE.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ru = RU_DATE.exec(s);
  if (ru) return `${ru[3]}-${ru[2].padStart(2, '0')}-${ru[1].padStart(2, '0')}`;
  return undefined;
}

function parseDatetime(v: unknown): string | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? serialToDatetime(v) : undefined;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function fromCell(col: ColumnDef, value: unknown): unknown {
  if (col.type === 'bool') return parseBool(value);
  if (isEmpty(value)) return undefined;
  switch (col.type) {
    case 'number':
    case 'int':
      return parseNumber(value);
    case 'date':
      return parseDate(value);
    case 'datetime':
      return parseDatetime(value);
    default:
      return String(value);
  }
}

/**
 * Строка листа (колонки в порядке схемы) → запись. Пустые ячейки не дают ключей;
 * пустая bool-ячейка читается как false. Строка может быть короче схемы (Sheets обрезает хвост).
 */
export function fromRow(def: SheetDef, row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  def.columns.forEach((col, i) => {
    const v = fromCell(col, row[i]);
    if (v !== undefined) out[col.key] = v;
  });
  return out;
}

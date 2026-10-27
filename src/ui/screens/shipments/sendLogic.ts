// Отправка товаров заказа в поставку (G30, G32): из карточки заказа («Отправить в поставку») и из поставки («Добавить из заказа»).
// Чистые функции: какие товары можно отправить, проверка количеств, партии к записи, черновик новой поставки.

import { newId } from '../../../domain/ids';
import type { Batch, Dataset, ISODate, Line, Order, Shipment } from '../../../domain/model';
import { nextShipmentCode, shipmentCodeYear } from '../../../domain/numbering';
import { TYPE_ID_BY_MODE } from '../../../domain/shipmentTypes';
import { validateBatchQty } from '../../../domain/validation';
import { cleanRecord } from '../../directories/records';
import { defaultVatRate, proportionalDefaults, shippedQty } from './shipmentLogic';

export interface SendRow {
  line: Line;
  supplierName: string;
  /** Порядковый номер поставщика в заказе (для подписи «3-1»). */
  soSeq: number;
  title: string;
  shipped: number;
  remaining: number;
}

/** Количество к отправке по позициям: lineId → кол-во (NaN — в поле не число; 0 или пусто — не отправлять). */
export type SendQtys = Record<string, number | undefined>;

export const lineTitle = (line: Line): string => line.customerName || line.docName || line.supplierName || `позиция ${line.seq}`;

/** Товары заказа «В работе» с неотгруженным остатком — по поставщику в заказе, затем по номеру позиции. */
export function sendableLines(ds: Dataset, orderId: string): SendRow[] {
  const sos = new Map(ds.supplierOrders.filter((s) => s.orderId === orderId).map((s) => [s.id, s]));
  const suppliers = new Map(ds.suppliers.map((s) => [s.id, s]));
  const rows: SendRow[] = [];
  for (const line of ds.lines) {
    if (line.orderId !== orderId || !line.purchased) continue;
    const shipped = shippedQty(ds, line.id);
    const remaining = line.qty - shipped;
    if (!(remaining > 0)) continue;
    const so = sos.get(line.supplierOrderId);
    rows.push({
      line, shipped, remaining, title: lineTitle(line), soSeq: so?.seq ?? 0,
      supplierName: suppliers.get(so?.supplierId ?? '')?.name ?? line.supplierName ?? '',
    });
  }
  return rows.sort((a, b) => a.soSeq - b.soSeq || a.line.seq - b.line.seq);
}

/** Кол-во по умолчанию — весь неотгруженный остаток. */
export const fullQtys = (rows: SendRow[]): SendQtys => Object.fromEntries(rows.map((r) => [r.line.id, r.remaining]));

const toSend = (rows: SendRow[], qtys: SendQtys) =>
  rows.map((r) => ({ row: r, qty: qtys[r.line.id] })).filter((x): x is { row: SendRow; qty: number } => typeof x.qty === 'number' && !Number.isNaN(x.qty) && x.qty > 0);

/** Ошибки по lineId (и `_form` — ничего не выбрано); пусто — можно записывать. */
export function sendQtyErrors(ds: Pick<Dataset, 'lines' | 'batches'>, rows: SendRow[], qtys: SendQtys): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const r of rows) {
    const q = qtys[r.line.id];
    if (q === undefined || q === 0) continue;
    if (Number.isNaN(q)) errors[r.line.id] = 'Введите число';
    else if (q < 0) errors[r.line.id] = 'Количество не может быть отрицательным';
    else {
      const e = validateBatchQty(ds, { id: '', shipmentId: '', lineId: r.line.id, qty: q });
      if (e.qty || e.lineId) errors[r.line.id] = e.qty ?? e.lineId;
    }
  }
  if (Object.keys(errors).length === 0 && toSend(rows, qtys).length === 0) errors._form = 'Укажите количество хотя бы у одного товара';
  return errors;
}

/** Партии к записи: по позиции с кол-вом > 0; CBM, вес и места — доля позиции пропорционально количеству. */
export function planSendBatches(_ds: Pick<Dataset, 'lines'>, shipmentId: string, rows: SendRow[], qtys: SendQtys): Batch[] {
  return toSend(rows, qtys).map(({ row, qty }) => cleanRecord<Batch>({
    id: newId('bat'), shipmentId, lineId: row.line.id, qty, ...proportionalDefaults(row.line, qty),
  }));
}

/** Новая поставка «на лету»: номер П-ГГГГ-NNN следующий в году, тип «Море, контейнер», НДС из настроек. */
export function newShipmentDraft(ds: Dataset, today: ISODate): Shipment {
  return {
    id: newId('shp'), number: nextShipmentCode(ds.shipments, shipmentCodeYear({}, today)),
    mode: 'sea_container', typeId: TYPE_ID_BY_MODE.sea_container, vatRate: defaultVatRate(ds),
  };
}

/** Текст для поиска заказа: код, номер, заказчик, название. */
export const orderSearchText = (o: Order): string =>
  [o.code, `№ ${o.number}`, String(o.number), o.customer, o.title].filter(Boolean).join(' ');

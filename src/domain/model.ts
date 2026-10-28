// Модель данных приложения. Поля сущностей = колонки листов таблицы (interfaces.md §6).
// Даты — строки ISO `YYYY-MM-DD`, дата-время — ISO 8601.

export type ISODate = string;
export type Currency = 'RUB' | 'CNY' | 'USD' | 'EUR';
export type ShipmentMode = 'sea_container' | 'road_container' | 'air' | 'other';
export type CostStatus = 'plan' | 'fact';
export type CostTargetType = 'order' | 'supplierOrder' | 'shipment' | 'declaration' | 'line';
export type PayeeType = 'supplier' | 'agent' | 'carrier' | 'text';
export type ListKey = 'payer' | 'department' | 'customer' | 'costType' | 'companyType' | 'direction' | 'specialization' | 'paymentTerms' | 'unit';

export interface Rate { id: string; date: ISODate; currency: Exclude<Currency, 'RUB'>; rate: number; source: 'vtb' | 'manual'; loadedAt?: string; comment?: string }
export interface ListItem { id: string; list: ListKey; value: string; order: number }
export interface Country { id: string; name: string }
export interface Province { id: string; name: string; countryId: string }
/**
 * Город. Провинция — названием (как у поставщика и агента): так читаются старые строки «Города» без справочника провинций.
 * countryId — ссылка на «Страны»; в старых строках его нет — такие города считаются городами Китая (CHINA_COUNTRY_ID).
 */
export interface City { id: string; city: string; province: string; countryId?: string; population?: number }
export interface Supplier { id: string; name: string; companyType?: string; direction?: string; specialization?: string; products?: string; priceNote?: string; contactPerson?: string; phone?: string; email?: string; city?: string; province?: string; address?: string; website?: string; bankBeneficiary?: string; bankName?: string; bankAccount?: string; bankSwift?: string; bankAddress?: string; comment?: string; createdAt?: string; country?: string /* название страны */ }
export interface PaymentAgent { id: string; name: string; contactPerson?: string; legalAddress?: string; city?: string; province?: string; phone?: string; email?: string; requisites?: string; comment?: string; country?: string /* название страны */ }
export interface Carrier { id: string; name: string; type?: string; specialization?: string; contactPerson?: string; phone?: string; email?: string; website?: string; contracts?: string; contractValidUntil?: ISODate; contractSigned?: boolean; comment?: string }
/**
 * Заказ. code — номер `З-ГГГГ-NNN` (G33); number — NNN этого номера (у старых заказов без кода — прежний номер, он и показывается).
 */
export interface Order { id: string; number: number; code?: string; date: ISODate; department?: string; payer?: string; customer?: string; title?: string; bitrixTaskId?: string; calcDate?: ISODate; costsComplete: boolean; comment?: string; createdAt?: string }
export interface SupplierOrder { id: string; orderId: string; seq: number; supplierId: string; bitrixTaskId?: string; currency: Currency; calcDate?: ISODate; calcRate?: number; paymentTerms?: string; plannedMode?: ShipmentMode; launchDate?: ISODate; productionDays?: number; actualReadyDate?: ISODate; comment?: string; coef?: number /* расчётный коэффициент поставщика; позиции без своего берут его */; plannedTypeId?: string /* тип поставки из «Типов поставки»; plannedMode — прежний */ }
export interface Line { id: string; orderId: string; supplierOrderId: string; seq: number; customerName?: string; techParams?: string; docName?: string; supplierName?: string; qty: number; unit?: string /* единица измерения; пусто — «шт» */; unitPrice: number; purchased: boolean; hsCode?: string; dutyRate?: number; packaging?: string; packageSize?: string; cbm?: number; weight?: number; places?: number; coef?: number /* свой AD — переопределение AD поставщика */; comment?: string; customerNameEn?: string; techParamsEn?: string /* только чтение: формула GOOGLETRANSLATE в листе */ }
/** Как делить доставку поставки: по объёму (CBM) или по весу (G29). */
export type ShipmentBasis = 'cbm' | 'weight';
/** Тип поставки — справочник «Типы поставки» со своим правилом деления доставки. */
export interface ShipmentType { id: string; name: string; basis: ShipmentBasis }
/**
 * Поставка. number — `П-ГГГГ-NNN` (G28; у старых — как был); typeId — тип из «Типов поставки» (правило доставки берётся из него);
 * mode — прежний тип: у поставок без typeId движок делит доставку по нему.
 */
export interface Shipment { id: string; number: string; mode: ShipmentMode; carrierId?: string; consolidationDate?: ISODate; sentDate?: ISODate; arrivalDate?: ISODate; vatRate: number; comment?: string; typeId?: string; containerNo?: string /* номер контейнера / накладной */ }
export interface Batch { id: string; shipmentId: string; lineId: string; qty: number; cbm?: number; weight?: number; places?: number; declarationId?: string }
export interface Declaration { id: string; shipmentId: string; number?: string; date?: ISODate; comment?: string }
/** Затрата. code — номер `Р-ГГГГ-<заказ>-NNN` / `Р-ГГГГ-П<NNN>-NNN` (G33); при смене привязки не меняется. */
export interface Cost { id: string; code?: string; entryDate: ISODate; paymentDate?: ISODate; status: CostStatus; targetType: CostTargetType; targetId: string; costType: string; payeeType?: PayeeType; payeeId?: string; payeeText?: string; executor?: string; invoiceNumber?: string; invoiceDate?: ISODate; amount?: number; currency: Currency; rate?: number; rateDate?: ISODate; rateManual: boolean; amountRub?: number; comment?: string }

export interface Dataset {
  rates: Rate[]; lists: ListItem[]; countries: Country[]; provinces: Province[]; cities: City[]; suppliers: Supplier[]; agents: PaymentAgent[]; carriers: Carrier[];
  orders: Order[]; supplierOrders: SupplierOrder[]; lines: Line[]; shipmentTypes: ShipmentType[]; shipments: Shipment[]; batches: Batch[]; declarations: Declaration[]; costs: Cost[];
  settings: Record<string, string>;   // лист «Настройки»: ratesSourceUrl, bitrixPortalUrl, vatRateDefault
  meta: Record<string, string>;       // лист «_meta»: schemaVersion, scriptId, appVersion, geoVersion
}
export type EntityName = Exclude<keyof Dataset, 'settings' | 'meta'>;

/** Все сущности-массивы набора в порядке листов. */
export const ENTITY_NAMES: readonly EntityName[] = [
  'rates', 'lists', 'countries', 'provinces', 'cities', 'suppliers', 'agents', 'carriers',
  'orders', 'supplierOrders', 'lines', 'shipmentTypes', 'shipments', 'batches', 'declarations', 'costs',
];

/** Пустой набор данных. */
export function emptyDataset(): Dataset {
  return {
    rates: [], lists: [], countries: [], provinces: [], cities: [], suppliers: [], agents: [], carriers: [],
    orders: [], supplierOrders: [], lines: [], shipmentTypes: [], shipments: [], batches: [], declarations: [], costs: [],
    settings: {}, meta: {},
  };
}

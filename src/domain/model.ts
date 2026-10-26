// Модель данных приложения. Поля сущностей = колонки листов таблицы (interfaces.md §6).
// Даты — строки ISO `YYYY-MM-DD`, дата-время — ISO 8601.

export type ISODate = string;
export type Currency = 'RUB' | 'CNY' | 'USD' | 'EUR';
export type ShipmentMode = 'sea_container' | 'road_container' | 'air' | 'other';
export type CostStatus = 'plan' | 'fact';
export type CostTargetType = 'order' | 'supplierOrder' | 'shipment' | 'declaration' | 'line';
export type PayeeType = 'supplier' | 'agent' | 'carrier' | 'text';
export type ListKey = 'payer' | 'department' | 'customer' | 'costType' | 'companyType' | 'direction' | 'specialization' | 'paymentTerms';

export interface Rate { id: string; date: ISODate; currency: Exclude<Currency, 'RUB'>; rate: number; source: 'vtb' | 'manual'; loadedAt?: string; comment?: string }
export interface ListItem { id: string; list: ListKey; value: string; order: number }
export interface City { id: string; city: string; province: string; population?: number }
export interface Supplier { id: string; name: string; companyType?: string; direction?: string; specialization?: string; products?: string; priceNote?: string; contactPerson?: string; phone?: string; email?: string; city?: string; province?: string; address?: string; website?: string; bankBeneficiary?: string; bankName?: string; bankAccount?: string; bankSwift?: string; bankAddress?: string; comment?: string; createdAt?: string }
export interface PaymentAgent { id: string; name: string; contactPerson?: string; legalAddress?: string; city?: string; province?: string; phone?: string; email?: string; requisites?: string; comment?: string }
export interface Carrier { id: string; name: string; type?: string; specialization?: string; contactPerson?: string; phone?: string; email?: string; website?: string; contracts?: string; contractValidUntil?: ISODate; contractSigned?: boolean; comment?: string }
export interface Order { id: string; number: number; date: ISODate; department?: string; payer?: string; customer?: string; title?: string; bitrixTaskId?: string; calcDate?: ISODate; costsComplete: boolean; comment?: string; createdAt?: string }
export interface SupplierOrder { id: string; orderId: string; seq: number; supplierId: string; bitrixTaskId?: string; currency: Currency; calcDate?: ISODate; calcRate?: number; paymentTerms?: string; plannedMode?: ShipmentMode; launchDate?: ISODate; productionDays?: number; actualReadyDate?: ISODate; comment?: string; coef?: number /* прогнозный AD поставщика; позиции без своего AD берут его */ }
export interface Line { id: string; orderId: string; supplierOrderId: string; seq: number; customerName?: string; techParams?: string; docName?: string; supplierName?: string; qty: number; unitPrice: number; purchased: boolean; hsCode?: string; dutyRate?: number; packaging?: string; packageSize?: string; cbm?: number; weight?: number; places?: number; coef?: number /* свой AD — переопределение AD поставщика */; comment?: string; customerNameEn?: string; techParamsEn?: string /* только чтение: формула GOOGLETRANSLATE в листе */ }
export interface Shipment { id: string; number: string; mode: ShipmentMode; carrierId?: string; consolidationDate?: ISODate; sentDate?: ISODate; arrivalDate?: ISODate; vatRate: number; comment?: string }
export interface Batch { id: string; shipmentId: string; lineId: string; qty: number; cbm?: number; weight?: number; places?: number; declarationId?: string }
export interface Declaration { id: string; shipmentId: string; number?: string; date?: ISODate; comment?: string }
export interface Cost { id: string; entryDate: ISODate; paymentDate?: ISODate; status: CostStatus; targetType: CostTargetType; targetId: string; costType: string; payeeType?: PayeeType; payeeId?: string; payeeText?: string; executor?: string; invoiceNumber?: string; invoiceDate?: ISODate; amount?: number; currency: Currency; rate?: number; rateDate?: ISODate; rateManual: boolean; amountRub?: number; comment?: string }

export interface Dataset {
  rates: Rate[]; lists: ListItem[]; cities: City[]; suppliers: Supplier[]; agents: PaymentAgent[]; carriers: Carrier[];
  orders: Order[]; supplierOrders: SupplierOrder[]; lines: Line[]; shipments: Shipment[]; batches: Batch[]; declarations: Declaration[]; costs: Cost[];
  settings: Record<string, string>;   // лист «Настройки»: ratesSourceUrl, bitrixPortalUrl, vatRateDefault
  meta: Record<string, string>;       // лист «_meta»: schemaVersion, scriptId, appVersion
}
export type EntityName = Exclude<keyof Dataset, 'settings' | 'meta'>;

/** Все сущности-массивы набора в порядке листов. */
export const ENTITY_NAMES: readonly EntityName[] = [
  'rates', 'lists', 'cities', 'suppliers', 'agents', 'carriers',
  'orders', 'supplierOrders', 'lines', 'shipments', 'batches', 'declarations', 'costs',
];

/** Пустой набор данных. */
export function emptyDataset(): Dataset {
  return {
    rates: [], lists: [], cities: [], suppliers: [], agents: [], carriers: [],
    orders: [], supplierOrders: [], lines: [], shipments: [], batches: [], declarations: [], costs: [],
    settings: {}, meta: {},
  };
}

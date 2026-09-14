import type { SerialNumber, RentmanRecord, Equipment } from "./api";

export type ElementType = "text" | "barcode" | "qr" | "staticText" | "image";

export interface LabelElement {
  id: string;
  type: ElementType;
  x: number; // mm from left
  y: number; // mm from top
  width: number; // mm
  height: number; // mm
  dataField?: string; // text/barcode/qr — a DataFieldKey, or a "custom_<id>" account custom field (see CustomFieldDef in lib/api.ts)
  text?: string; // literal content, staticText only
  fontSize?: number; // mm-ish character height, text/staticText only
  bold?: boolean;
  align?: "left" | "center" | "right"; // text/staticText only, defaults to left
  valign?: "top" | "middle" | "bottom"; // text/staticText only, defaults to top
  wrap?: boolean; // text/staticText only — wrap to multiple lines within width/height instead of squishing onto one line
  breakWords?: boolean; // wrap only — allow splitting a single word mid-character when it doesn't fit a line on its own (default true, matches old behavior); off just lets that line condense/overflow instead of breaking it
  padding?: number; // mm inset on all sides, text/staticText only
  lockAspect?: boolean; // resize keeps width:height fixed — QR codes and images generally want this
  imageData?: string; // data: URL, image only — a logo/icon baked into the template
  folderLevels?: number[]; // dataField === "equipmentFolder" only — 1-indexed path segments to include; empty/unset = full path
  rotation?: 0 | 90 | 180 | 270; // any element type — rotates around the box's own center
}

export interface LabelTemplateData {
  id?: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: LabelElement[];
}

// Keys and labels mirror Rentman's own field names as closely as possible
// (confirmed against a live token — see server/src/routes/assets.ts) rather
// than inventing our own names for them. "equipment*" / "location*" /
// "project" are resolved from the serial number's reference fields
// (equipment, asset_location, last_subproject) since Rentman doesn't embed
// those records inline.
export type DataFieldKey =
  | "displayname"
  | "serial"
  | "ref"
  | "qrcodes"
  | "tags"
  | "remark"
  | "nextInspection"
  | "purchaseDate"
  | "bookValue"
  | "active"
  | "rentmanId"
  | "depreciationMonthly"
  | "residualValue"
  | "purchasePrice"
  | "currentBookValue"
  | "sealed"
  | "equipmentName"
  | "equipmentCode"
  | "equipmentTags"
  | "equipmentFolder"
  | "equipmentType"
  | "equipmentPrice"
  | "equipmentWeight"
  | "equipmentHeight"
  | "equipmentWidth"
  | "equipmentLength"
  | "equipmentPackedPer"
  | "equipmentCriticalStockLevel"
  | "equipmentStockManagement"
  | "equipmentQrcodesOfSerials"
  | "equipmentInternalRemark"
  | "equipmentExternalRemark"
  | "equipmentRentalSales"
  | "equipmentSubrentalCost"
  | "equipmentListPrice"
  | "equipmentVolume"
  | "equipmentEmptyWeight"
  | "equipmentPower"
  | "equipmentCurrent"
  | "equipmentCountryOfOrigin"
  | "equipmentArchived"
  | "locationInWarehouse"
  | "location"
  | "project";

export const DATA_FIELDS: { key: DataFieldKey; label: string }[] = [
  { key: "displayname", label: "Display name" },
  { key: "serial", label: "Serial" },
  { key: "ref", label: "Reference" },
  { key: "qrcodes", label: "QR codes" },
  { key: "tags", label: "Tags" },
  { key: "remark", label: "Remark" },
  { key: "nextInspection", label: "Next inspection" },
  { key: "purchaseDate", label: "Purchase date" },
  { key: "bookValue", label: "Book value" },
  { key: "active", label: "Active" },
  { key: "rentmanId", label: "Rentman ID" },
  { key: "depreciationMonthly", label: "Depreciation per month" },
  { key: "residualValue", label: "Residual value" },
  { key: "purchasePrice", label: "Purchase price" },
  { key: "currentBookValue", label: "Current book value" },
  { key: "sealed", label: "Sealed" },
  { key: "equipmentName", label: "Name (equipment)" },
  { key: "equipmentCode", label: "Code (equipment)" },
  { key: "equipmentTags", label: "Tags (equipment)" },
  { key: "equipmentFolder", label: "Folder (equipment)" },
  { key: "equipmentType", label: "Type (equipment)" },
  { key: "equipmentPrice", label: "Rental price (equipment)" },
  { key: "equipmentWeight", label: "Weight (equipment)" },
  { key: "equipmentHeight", label: "Height (equipment)" },
  { key: "equipmentWidth", label: "Width (equipment)" },
  { key: "equipmentLength", label: "Length (equipment)" },
  { key: "equipmentPackedPer", label: "Packed per (equipment)" },
  { key: "equipmentCriticalStockLevel", label: "Critical stock level (equipment)" },
  { key: "equipmentStockManagement", label: "Stock management (equipment)" },
  { key: "equipmentQrcodesOfSerials", label: "QR codes of serial numbers (equipment)" },
  { key: "equipmentInternalRemark", label: "Internal remark (equipment)" },
  { key: "equipmentExternalRemark", label: "External remark (equipment)" },
  { key: "equipmentRentalSales", label: "Rental/sales (equipment)" },
  { key: "equipmentSubrentalCost", label: "Subrent-/purchase cost (equipment)" },
  { key: "equipmentListPrice", label: "List price (equipment)" },
  { key: "equipmentVolume", label: "Transport volume (equipment)" },
  { key: "equipmentEmptyWeight", label: "Empty weight (equipment)" },
  { key: "equipmentPower", label: "Power (equipment)" },
  { key: "equipmentCurrent", label: "Current, electrical (equipment)" },
  { key: "equipmentCountryOfOrigin", label: "Country of origin (equipment)" },
  { key: "equipmentArchived", label: "Archived (equipment)" },
  { key: "locationInWarehouse", label: "Location in warehouse (equipment)" },
  { key: "location", label: "Stock location" },
  { key: "project", label: "Current project" },
];

// A plain string-keyed map rather than Record<DataFieldKey, string> — a
// dataField can also be a "custom_<id>" account custom field (dynamic,
// account-specific, not part of the fixed DataFieldKey union). Every
// DATA_FIELDS/SAMPLE_CONTEXT object below still satisfies this structurally.
export type LabelDataContext = Record<string, string>;

// Rentman custom field values arrive typed (string/number/boolean/null) —
// stringified the same way the fixed fields already are (e.g. `active`,
// `sealed` render as "Yes"/"No" rather than true/false).
export function normalizeCustomFields(custom: Record<string, unknown> | null | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!custom) return result;
  for (const [key, value] of Object.entries(custom)) {
    if (value == null) result[key] = "";
    else if (typeof value === "boolean") result[key] = value ? "Yes" : "No";
    else result[key] = String(value);
  }
  return result;
}

// Placeholder values the designer renders with when there's no real asset
// in hand yet (i.e. whenever you're just building/editing a template).
export const SAMPLE_CONTEXT: LabelDataContext = {
  displayname: "LX1435PAC1",
  serial: "LX1435PAC1",
  ref: "REF-001",
  qrcodes: "1003508",
  tags: "fixture",
  remark: "",
  nextInspection: "",
  purchaseDate: "29/04/2024",
  bookValue: "0",
  active: "Yes",
  rentmanId: "352",
  depreciationMonthly: "0",
  residualValue: "0",
  purchasePrice: "0",
  currentBookValue: "0",
  sealed: "No",
  equipmentName: "14-35 1000W PACIFIC",
  equipmentCode: "LX1435PAC",
  equipmentTags: "fixture",
  equipmentFolder: "Old Inventory/LX/Fixture",
  equipmentType: "item",
  equipmentPrice: "60",
  equipmentWeight: "50",
  equipmentHeight: "15",
  equipmentWidth: "120",
  equipmentLength: "240",
  equipmentPackedPer: "6",
  equipmentCriticalStockLevel: "0",
  equipmentStockManagement: "Track stock",
  equipmentQrcodesOfSerials: "",
  equipmentInternalRemark: "",
  equipmentExternalRemark: "",
  equipmentRentalSales: "Rental",
  equipmentSubrentalCost: "0",
  equipmentListPrice: "0",
  equipmentVolume: "0",
  equipmentEmptyWeight: "0",
  equipmentPower: "0",
  equipmentCurrent: "0",
  equipmentCountryOfOrigin: "",
  equipmentArchived: "No",
  locationInWarehouse: "Lock Up",
  location: "Bay AV Workshop",
  project: "Sample Project",
};

// Equipment-level fields, shared between a serial's own equipment join and
// printing the equipment type directly (buildEquipmentLabelContext below) —
// same field, same key, two different sources for the raw record.
function equipmentFields(equipment: RentmanRecord | null | undefined): Pick<
  LabelDataContext,
  | "equipmentName"
  | "equipmentCode"
  | "equipmentTags"
  | "equipmentType"
  | "equipmentPrice"
  | "equipmentWeight"
  | "equipmentHeight"
  | "equipmentWidth"
  | "equipmentLength"
  | "equipmentPackedPer"
  | "equipmentCriticalStockLevel"
  | "equipmentStockManagement"
  | "equipmentQrcodesOfSerials"
  | "equipmentInternalRemark"
  | "equipmentExternalRemark"
  | "equipmentRentalSales"
  | "equipmentSubrentalCost"
  | "equipmentListPrice"
  | "equipmentVolume"
  | "equipmentEmptyWeight"
  | "equipmentPower"
  | "equipmentCurrent"
  | "equipmentCountryOfOrigin"
  | "equipmentArchived"
  | "locationInWarehouse"
> {
  return {
    equipmentName: (equipment?.displayname as string) ?? (equipment?.name as string) ?? "",
    equipmentCode: (equipment?.code as string) ?? "",
    equipmentTags: (equipment?.tags as string) ?? "",
    equipmentType: (equipment?.type as string) ?? "",
    equipmentPrice: equipment?.price != null ? String(equipment.price) : "",
    equipmentWeight: equipment?.weight != null ? String(equipment.weight) : "",
    equipmentHeight: equipment?.height != null ? String(equipment.height) : "",
    equipmentWidth: equipment?.width != null ? String(equipment.width) : "",
    equipmentLength: equipment?.length != null ? String(equipment.length) : "",
    equipmentPackedPer: equipment?.packed_per != null ? String(equipment.packed_per) : "",
    equipmentCriticalStockLevel: equipment?.critical_stock_level != null ? String(equipment.critical_stock_level) : "",
    equipmentStockManagement: (equipment?.stock_management as string) ?? "",
    equipmentQrcodesOfSerials: (equipment?.qrcodes_of_serial_numbers as string) ?? "",
    equipmentInternalRemark: (equipment?.internal_remark as string) ?? "",
    equipmentExternalRemark: (equipment?.external_remark as string) ?? "",
    equipmentRentalSales: (equipment?.rental_sales as string) ?? "",
    equipmentSubrentalCost: equipment?.subrental_costs != null ? String(equipment.subrental_costs) : "",
    equipmentListPrice: equipment?.list_price != null ? String(equipment.list_price) : "",
    equipmentVolume: equipment?.volume != null ? String(equipment.volume) : "",
    equipmentEmptyWeight: equipment?.empty_weight != null ? String(equipment.empty_weight) : "",
    equipmentPower: equipment?.power != null ? String(equipment.power) : "",
    equipmentCurrent: equipment?.current != null ? String(equipment.current) : "",
    equipmentCountryOfOrigin: (equipment?.country_of_origin as string) ?? "",
    equipmentArchived: equipment?.in_archive ? "Yes" : "No",
    locationInWarehouse: (equipment?.location_in_warehouse as string) ?? "",
  };
}

export function buildLabelContext(asset: SerialNumber & { _lastSubproject?: RentmanRecord | null }): LabelDataContext {
  return {
    displayname: asset.displayname ?? "",
    serial: asset.serial ?? "",
    ref: asset.ref ?? "",
    qrcodes: asset.qrcodes ?? "",
    tags: asset.tags ?? "",
    remark: asset.remark ?? "",
    nextInspection: asset.next_inspection ? new Date(asset.next_inspection).toLocaleDateString() : "",
    purchaseDate: asset.purchasedate ? new Date(asset.purchasedate).toLocaleDateString() : "",
    bookValue: asset.book_value != null ? String(asset.book_value) : "",
    active: asset.active === false ? "No" : "Yes",
    rentmanId: String(asset.id),
    depreciationMonthly: asset.depreciation_monthly != null ? String(asset.depreciation_monthly) : "",
    residualValue: asset.residual_value != null ? String(asset.residual_value) : "",
    purchasePrice: asset.purchase_costs != null ? String(asset.purchase_costs) : "",
    currentBookValue: asset.current_book_value != null ? String(asset.current_book_value) : "",
    sealed: asset.sealed ? "Yes" : "No",
    ...equipmentFields(asset._equipment),
    equipmentFolder:
      (asset._folder?.path as string) ?? (asset._folder?.displayname as string) ?? (asset._folder?.name as string) ?? "",
    location: (asset._location?.displayname as string) ?? "",
    project: asset._lastSubproject
      ? ((asset._lastSubproject.displayname as string) ?? (asset._lastSubproject.name as string) ?? "")
      : "",
    // Custom field ids are unique account-wide regardless of which item
    // type they're defined on, so equipment-level and serial-level custom
    // values never collide sharing this one flat namespace.
    ...normalizeCustomFields(asset._equipment?.custom as Record<string, unknown> | undefined),
    ...normalizeCustomFields(asset.custom),
  };
}

// For labeling an equipment *type* rather than one specific serialized unit
// (e.g. bulk stock like tape, which has no serial numbers to open at all).
// The equipment record has its own qrcodes field, separate from any
// individual serial's — that's the QR value to use for a type-level label.
// Serial-only fields (serial, ref, remark, next inspection, purchase date,
// book value, location, project) don't apply at the type level and are left
// blank.
export function buildEquipmentLabelContext(equipment: Equipment & { _folder?: RentmanRecord | null }): LabelDataContext {
  return {
    displayname: equipment.displayname ?? equipment.name ?? "",
    serial: "",
    ref: "",
    qrcodes: equipment.qrcodes ?? "",
    tags: equipment.tags ?? "",
    remark: "",
    nextInspection: "",
    purchaseDate: "",
    bookValue: "",
    active: "",
    rentmanId: String(equipment.id),
    depreciationMonthly: "",
    residualValue: "",
    purchasePrice: "",
    currentBookValue: "",
    sealed: "",
    ...equipmentFields(equipment),
    equipmentFolder:
      (equipment._folder?.path as string) ??
      (equipment._folder?.displayname as string) ??
      (equipment._folder?.name as string) ??
      "",
    location: "",
    project: "",
    ...normalizeCustomFields(equipment.custom),
  };
}

// Rentman's folder "path" is slash-separated from root to leaf (e.g.
// "Old Inventory/LX/Fixture"). `levels` picks specific 1-indexed segments —
// e.g. [2] for just "LX" — joined back with "/"; empty/unset keeps the
// full path. Levels beyond what a given item's folder actually has are
// silently skipped rather than erroring, since depth varies per item.
export function applyFolderLevels(fullPath: string, levels?: number[]): string {
  if (!levels || levels.length === 0) return fullPath;
  const segments = fullPath.split("/");
  return levels
    .slice()
    .sort((a, b) => a - b)
    .map((level) => segments[level - 1])
    .filter((s): s is string => Boolean(s))
    .join("/");
}

// Matches the brother_ql continuous-label identifiers and their exact
// printable dot width (confirmed against brother_ql.labels.ALL_LABELS) —
// the print render must land on these pixel widths exactly.
export const TAPE_WIDTHS = [
  { mm: 12, labelId: "12", printDots: 106 },
  { mm: 29, labelId: "29", printDots: 306 },
  { mm: 62, labelId: "62", printDots: 696 },
] as const;

export function dotsPerMm(widthMm: number): number {
  const spec = TAPE_WIDTHS.find((w) => w.mm === widthMm);
  return spec ? spec.printDots / spec.mm : 300 / 25.4;
}

export function labelIdForWidth(widthMm: number): string {
  return TAPE_WIDTHS.find((w) => w.mm === widthMm)?.labelId ?? "62";
}

export const SIZE_PRESETS: { name: string; widthMm: number; heightMm: number }[] = [
  { name: "Large", widthMm: 62, heightMm: 100 },
  { name: "Medium", widthMm: 62, heightMm: 29 },
  { name: "Small", widthMm: 29, heightMm: 15 },
];

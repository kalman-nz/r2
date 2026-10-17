import type { Item, Serial } from "./api";

export type ElementType = "text" | "barcode" | "qr" | "staticText" | "image";

export interface LabelElement {
  id: string;
  type: ElementType;
  x: number; // mm from left
  y: number; // mm from top
  width: number; // mm
  height: number; // mm
  dataField?: string; // text/barcode/qr — a DataFieldKey, or a "custom_<id>" imported custom field (see CustomFieldDef in lib/api.ts)
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

// The keys are the ones templates were saved with back when this app read
// from Rentman, kept as-is so every existing template still renders (a
// template stores dataField keys, not labels). The labels are R2's.
// Rentman-only fields with no R2 equivalent (book value, depreciation,
// sealed...) were dropped; old templates using them print blank there.
export type DataFieldKey =
  | "displayname"
  | "qrcodes"
  | "serial"
  | "status"
  | "remark"
  | "nextInspection"
  | "purchaseDate"
  | "purchasePrice"
  | "location"
  | "project"
  | "equipmentName"
  | "equipmentCode"
  | "equipmentFolder"
  | "equipmentTags"
  | "equipmentPrice"
  | "equipmentWeight"
  | "equipmentPower"
  | "equipmentExternalRemark"
  | "equipmentInternalRemark"
  | "locationInWarehouse";

export const DATA_FIELDS: { key: DataFieldKey; label: string }[] = [
  { key: "displayname", label: "Unit name" },
  { key: "qrcodes", label: "Barcode / QR value" },
  { key: "serial", label: "Serial number" },
  { key: "status", label: "Status" },
  { key: "remark", label: "Unit notes" },
  { key: "nextInspection", label: "Next test & tag" },
  { key: "purchaseDate", label: "Purchase date" },
  { key: "purchasePrice", label: "Purchase cost" },
  { key: "location", label: "Stock location" },
  { key: "project", label: "Current project" },
  { key: "equipmentName", label: "Item name" },
  { key: "equipmentCode", label: "Item code" },
  { key: "equipmentFolder", label: "Category" },
  { key: "equipmentTags", label: "Item tags" },
  { key: "equipmentPrice", label: "Day rate" },
  { key: "equipmentWeight", label: "Weight (kg)" },
  { key: "equipmentPower", label: "Power (W)" },
  { key: "equipmentExternalRemark", label: "Item description" },
  { key: "equipmentInternalRemark", label: "Item notes" },
  { key: "locationInWarehouse", label: "Location in warehouse" },
];

// A plain string-keyed map rather than Record<DataFieldKey, string> — a
// dataField can also be a "custom_<id>" imported custom field (dynamic,
// account-specific, not part of the fixed DataFieldKey union).
export type LabelDataContext = Record<string, string>;

// Imported custom field values arrive typed (string/number/boolean/null) —
// stringified the same way the fixed fields are (booleans as "Yes"/"No").
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

// Placeholder values the designer renders with when there's no real unit
// in hand yet (i.e. whenever you're just building/editing a template).
export const SAMPLE_CONTEXT: LabelDataContext = {
  displayname: "K12 #1",
  qrcodes: "R2-000123",
  serial: "QSC12345678",
  status: "Active",
  remark: "",
  nextInspection: "15/01/2027",
  purchaseDate: "29/04/2024",
  purchasePrice: "1999",
  location: "Main warehouse",
  project: "#1042 Spring Gala",
  equipmentName: "QSC K12.2",
  equipmentCode: "K12",
  equipmentFolder: "Audio/Speakers",
  equipmentTags: "speaker",
  equipmentPrice: "80",
  equipmentWeight: "17.7",
  equipmentPower: "2000",
  equipmentExternalRemark: "12in powered speaker",
  equipmentInternalRemark: "",
  locationInWarehouse: "Bay 3",
};

const STATUS_LABELS: Record<string, string> = { active: "Active", repair: "In repair", lost: "Lost", retired: "Retired" };

function dateText(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

function numberText(n: number | null | undefined): string {
  return n ? String(n) : "";
}

// Item-level fields, shared by a unit's label and an item-type label.
function itemFields(item: Item | null, categoryPath: string): LabelDataContext {
  return {
    equipmentName: item?.name ?? "",
    equipmentCode: item?.code ?? "",
    equipmentFolder: categoryPath,
    equipmentTags: item?.tags ?? "",
    equipmentPrice: numberText(item?.dayRate),
    equipmentWeight: numberText(item?.weightKg),
    equipmentPower: numberText(item?.powerW),
    equipmentExternalRemark: item?.description ?? "",
    equipmentInternalRemark: item?.notes ?? "",
    locationInWarehouse: item?.locationInWarehouse ?? "",
  };
}

// What a unit's label needs beyond the serial record itself.
export interface LabelUnit {
  serial: Serial;
  item: Item | null;
  categoryPath: string;
  locationName: string;
  currentJob: string;
}

export function unitDisplayName(serial: Serial, item: Item | null): string {
  return serial.label || [item?.name, serial.barcode].filter(Boolean).join(" ");
}

export function buildLabelContext(unit: LabelUnit): LabelDataContext {
  const { serial, item } = unit;
  return {
    displayname: unitDisplayName(serial, item),
    qrcodes: serial.barcode,
    serial: serial.serialNumber,
    status: STATUS_LABELS[serial.status] ?? serial.status,
    remark: serial.notes,
    nextInspection: dateText(serial.nextInspection),
    purchaseDate: dateText(serial.purchaseDate),
    purchasePrice: numberText(serial.purchaseCost),
    location: unit.locationName,
    project: unit.currentJob,
    ...itemFields(item, unit.categoryPath),
    // Older templates' keys for the same values.
    ref: serial.barcode,
    tags: item?.tags ?? "",
    active: serial.status === "active" ? "Yes" : "No",
    rentmanId: serial.rentmanId,
    // Custom field ids are unique account-wide regardless of which item
    // type they're defined on, so item-level and unit-level custom values
    // never collide sharing this one flat namespace.
    ...normalizeCustomFields(item?.custom),
    ...normalizeCustomFields(serial.custom),
  };
}

// For labelling an item *type* rather than one unit (bulk stock like
// cable, which has no units to open at all). The item's own barcode is the
// scan value; unit-only fields are blank.
export function buildItemLabelContext(item: Item, categoryPath: string): LabelDataContext {
  return {
    displayname: item.name,
    qrcodes: item.barcode,
    serial: "",
    status: "",
    remark: "",
    nextInspection: "",
    purchaseDate: "",
    purchasePrice: "",
    location: "",
    project: "",
    ...itemFields(item, categoryPath),
    ref: item.barcode,
    tags: item.tags,
    active: "",
    rentmanId: item.rentmanId,
    ...normalizeCustomFields(item.custom),
  };
}

// A category path is slash-separated from root to leaf (e.g.
// "Audio/Speakers/Powered"). `levels` picks specific 1-indexed segments —
// e.g. [2] for just "Speakers" — joined back with "/"; empty/unset keeps the
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

// Brother sizes print straight to the networked QL printer; any size at
// all can be downloaded as a PDF (one page per label at its real size) and
// printed through a driver — the Zebra presets are common desktop
// thermal label stock.
export const SIZE_PRESETS: { name: string; group: "Brother" | "Zebra"; widthMm: number; heightMm: number }[] = [
  { name: "62 × 100 mm", group: "Brother", widthMm: 62, heightMm: 100 },
  { name: "62 × 29 mm", group: "Brother", widthMm: 62, heightMm: 29 },
  { name: "29 × 15 mm", group: "Brother", widthMm: 29, heightMm: 15 },
  { name: "2.25 × 1.25 in", group: "Zebra", widthMm: 57, heightMm: 32 },
  { name: "2 × 1 in", group: "Zebra", widthMm: 51, heightMm: 25 },
  { name: "4 × 2 in", group: "Zebra", widthMm: 102, heightMm: 51 },
  { name: "4 × 6 in", group: "Zebra", widthMm: 102, heightMm: 152 },
];

// Whether a label can go straight to the Brother QL (its tape widths only).
export function isBrotherWidth(widthMm: number): boolean {
  return TAPE_WIDTHS.some((w) => w.mm === widthMm);
}

import type { RecordModel } from "pocketbase";
import type { LabelTemplateData } from "./labelSpec";
import { pb } from "./pocketbase";
import { currentOrgId } from "./currentOrg";

// Plain catalogue records (items, serials, contacts, venues, jobs...) are
// read and written straight through the PocketBase SDK (pb.collection(...)),
// gated by collection rules — filtered with orgFilter() and created with
// withOrg() (lib/currentOrg.ts). Anything with business logic — job lines,
// quotes, availability, scanning, imports — goes through the custom routes
// below (pocketbase/pb_hooks/routes_*.pb.js), which are told the
// organisation by the X-Org header.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function send(path: string, init?: RequestInit): Promise<Response> {
  const org = currentOrgId();
  return fetch(path, {
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
      ...(org ? { "X-Org": org } : {}),
    },
    ...init,
  });
}

async function failure(res: Response): Promise<ApiError> {
  const body = await res.text().catch(() => "");
  let message = `${res.status} ${res.statusText}`;
  try {
    const parsed = JSON.parse(body);
    if (parsed?.message) message = parsed.message;
  } catch {
    // not JSON — keep the status line
  }
  return new ApiError(message, res.status);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

// For PDFs and CSVs: the file plus the name the server suggested for it.
export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

async function requestFile(path: string, fallbackName: string, init?: RequestInit): Promise<DownloadedFile> {
  const res = await send(path, init);
  if (!res.ok) throw await failure(res);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return { blob: await res.blob(), filename: match?.[1] ?? fallbackName };
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

// --- records (shapes match pocketbase/pb_migrations/0020_r2_core.js) ---

export type JobStatus = "enquiry" | "provisional" | "confirmed" | "out" | "returned" | "cancelled";
export type SerialStatus = "active" | "repair" | "lost" | "retired";

export interface Category extends RecordModel {
  org: string;
  name: string;
  parent: string;
  sortOrder: number;
  rentmanId: string;
}

export interface Location extends RecordModel {
  org: string;
  name: string;
  address: string;
  rentmanId: string;
}

export interface Item extends RecordModel {
  org: string;
  name: string;
  code: string;
  category: string;
  kind: "item" | "kit";
  tracking: "bulk" | "serial" | "";
  stockQty: number;
  outOfServiceQty: number;
  // What price is per (migration 0026); empty means day.
  price: number;
  priceUnit: PriceUnit | "";
  replacementValue: number;
  weightKg: number;
  powerW: number;
  bufferHours: number;
  barcode: string;
  locationInWarehouse: string;
  description: string;
  notes: string;
  photo: string;
  archived: boolean;
  custom: Record<string, unknown> | null;
  rentmanId: string;
}

export interface Serial extends RecordModel {
  org: string;
  item: string;
  barcode: string;
  serialNumber: string;
  label: string;
  status: SerialStatus;
  location: string;
  purchaseDate: string;
  purchaseCost: number;
  nextInspection: string;
  notes: string;
  custom: Record<string, unknown> | null;
  rentmanId: string;
}

export interface ItemComponent extends RecordModel {
  org: string;
  parent: string;
  child: string;
  kind: "component" | "accessory";
  quantity: number;
  chargeable: boolean;
  sortOrder: number;
}

export interface Contact extends RecordModel {
  org: string;
  name: string;
  kind: "company" | "person" | "";
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
  notes: string;
  archived: boolean;
}

export interface Venue extends RecordModel {
  org: string;
  name: string;
  address: string;
  contactName: string;
  phone: string;
  notes: string;
  archived: boolean;
}

export interface Job extends RecordModel {
  org: string;
  number: number;
  name: string;
  status: JobStatus;
  client: string;
  venue: string;
  // Derived from the schedule (pb_hooks/lib/periods.js): kit booked over
  // the usage periods, the project over everything, billing over the
  // billing periods.
  prepAt: string;
  returnAt: string;
  startAt: string;
  endAt: string;
  billingStart: string;
  billingEnd: string;
  chargeDays: number;
  discountPct: number;
  reference: string;
  quoteNotes: string;
  notes: string;
  createdBy: string;
}

export interface Scan extends RecordModel {
  job: string;
  item: string;
  serial: string;
  direction: "out" | "in";
  quantity: number;
  who: string;
  note: string;
}

// --- job page (GET /api/jobs/{id}/summary, see lib/jobs.js) ---

export interface LineAvailability {
  needed: number;
  free: number;
  freeFirm: number;
  short: number;
  shortFirm: number;
}

export type PriceUnit = "hour" | "day" | "week" | "each";
// How a project line is charged: by the project's hours, day factor or
// weeks, or once (pb_hooks/lib/pricing.js).
export type PriceMode = "per_hour" | "per_day" | "per_week" | "fixed";

export interface ItemInfo {
  id: string;
  name: string;
  code: string;
  kind: "item" | "kit";
  tracking: "bulk" | "serial" | "";
  price: number;
  priceUnit: PriceUnit;
  barcode: string;
  description: string;
  locationInWarehouse: string;
  weightKg: number;
  powerW: number;
  archived: boolean;
}

export interface ContactInfo {
  id: string;
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
}

export interface VenueInfo {
  id: string;
  name: string;
  address: string;
  contactName: string;
  phone: string;
}

export interface LineAmount {
  gross: number;
  discount: number;
  net: number;
}

export interface JobLineView {
  id: string;
  parentLine: string;
  lineType: "item" | "component" | "accessory" | "custom";
  item: ItemInfo | null;
  name: string;
  description: string;
  quantity: number;
  perParent: number;
  priceMode: PriceMode;
  group: string;
  sortOrder: number;
  notes: string;
  availability: LineAvailability | null;
  componentsShort: boolean;
  // Planners and admins only:
  unitPrice?: number;
  discountPct?: number;
  amount?: LineAmount;
}

export interface JobInfo {
  id: string;
  org: string;
  number: number;
  name: string;
  status: JobStatus;
  client: string;
  venue: string;
  // Derived from the schedule (pb_hooks/lib/periods.js): kit booked over
  // the usage periods, the project over everything, billing over the
  // billing periods.
  prepAt: string;
  returnAt: string;
  startAt: string;
  endAt: string;
  billingStart: string;
  billingEnd: string;
  chargeDays: number;
  discountPct: number;
  reference: string;
  quoteNotes: string;
  notes: string;
  created: string;
  updated: string;
  clientInfo: ContactInfo | null;
  venueInfo: VenueInfo | null;
}

export interface PackingItem {
  itemId: string;
  name: string;
  tracking: string;
  needed: number;
  scannedOut: number;
  returned: number;
  out: number;
  serialsOut: { id: string; barcode: string; label: string }[];
}

export interface JobTotals {
  gross: number;
  lineDiscount: number;
  jobDiscount: number;
  exGst: number;
  gst: number;
  total: number;
}

export interface JobPricing {
  days: number;
  hours: number;
  weeks: number;
  basis: "override" | "billing" | "hire";
  factor: number;
  gstRate: number;
  discountPct: number;
  totals: JobTotals;
}

export type QuoteStatus = "issued" | "accepted" | "declined" | "void";

export interface QuoteSummary {
  id: string;
  version: number;
  status: QuoteStatus;
  total: number;
  issuedAt: string;
  validUntil: string;
}

export type PeriodKind = "usage" | "billing" | "other";

// A line in a project's schedule (job_periods). The job's date fields are
// derived from these on the server (pb_hooks/lib/periods.js).
export interface JobPeriod {
  id: string;
  kind: PeriodKind;
  name: string;
  start: string;
  end: string;
  notes: string;
}

export interface JobSummary {
  job: JobInfo;
  periods: JobPeriod[];
  lines: JobLineView[];
  packing: { items: PackingItem[]; packed: boolean; allBack: boolean; scanCount: number };
  includesPrices: boolean;
  pricing?: JobPricing;
  quotes?: QuoteSummary[];
}

export interface QuoteLine {
  id: string;
  parentLine: string;
  lineType: JobLineView["lineType"];
  name: string;
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  priceMode: PriceMode;
  discountPct: number;
  group: string;
  amount: LineAmount;
}

export interface QuoteSnapshot {
  business: { name: string; address: string; phone: string; email: string; gstNumber: string };
  job: {
    number: number;
    name: string;
    reference: string;
    prepAt: string;
    returnAt: string;
    billingStart?: string;
    billingEnd?: string;
    // Quotes issued before schedules (migration 0025)
    showStart?: string;
    showEnd?: string;
    quoteNotes: string;
  };
  client: ContactInfo | null;
  venue: VenueInfo | null;
  lines: QuoteLine[];
  pricing: JobPricing;
  terms: string;
  issuedAt: string;
  validUntil: string;
}

export interface Quote extends RecordModel {
  job: string;
  version: number;
  status: QuoteStatus;
  snapshot: QuoteSnapshot;
  exGst: number;
  gst: number;
  total: number;
  issuedAt: string;
  validUntil: string;
}

export interface NewLine {
  itemId?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  priceMode?: PriceMode;
  group?: string;
  discountPct?: number;
}

export type LinePatch = Partial<{
  quantity: number;
  unitPrice: number;
  discountPct: number;
  description: string;
  group: string;
  priceMode: PriceMode;
  notes: string;
  sortOrder: number;
}>;

// --- availability ---

export type AvailabilityMap = Record<string, { stock: number | null; free: number; freeFirm: number }>;

export interface ItemTimeline {
  stock: number | null;
  segments: { start: string; end: string; free: number }[];
  bookings: {
    jobId: string;
    number: number;
    name: string;
    status: JobStatus;
    prepAt: string;
    returnAt: string;
    quantity: number | null;
  }[];
}

// --- everything else ---

export interface Settings {
  printerHost: string;
  businessName: string;
  businessShortName: string;
  defaultTemplateId: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  gstNumber: string;
  gstRate: string;
  dayFactors: string;
  extraDayFactor: string;
  bufferHours: string;
  quoteValidityDays: string;
  quoteTerms: string;
  timezone: string;
  xeroAccountCode: string;
  xeroTaxType: string;
  xeroDueDays: string;
  invoicePrefix: string;
  rentmanApiTokenSet: boolean;
}

export type SettingsUpdate = Partial<Omit<Settings, "rentmanApiTokenSet">> & { rentmanApiToken?: string };

export interface Stats {
  items: number;
  kits: number;
  stockUnits: number;
  serials: number;
  upcomingJobs: number;
  contacts: number;
  labelTemplates: number;
  labelsPrinted: number;
  users: number;
}

export interface LogEntry {
  id: string;
  type: string;
  who: string | null;
  timestamp: string;
  summary: string;
  details: Record<string, unknown>;
}

// --- people and organisations (routes_me, routes_orgs, routes_admin) ---

export interface OrgRef {
  id: string;
  name: string;
  suspended: boolean;
}

// A role as people are given it (Settings → Roles defines them).
export interface RoleRef {
  id: string;
  name: string;
  locked: boolean; // the Admin role: always every permission
}

export interface OrgRole extends RoleRef {
  description: string;
  permissions: string[];
  members?: number;
  invitations?: number;
}

export interface PermissionCatalogue {
  groups: { name: string; permissions: { key: string; label: string }[] }[];
  // permission → the ones it needs (quotes.view needs prices.view…)
  requires: Record<string, string[]>;
}

export interface Membership {
  org: OrgRef;
  role: RoleRef;
  permissions: string[];
}

export interface Invitation {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  roleId: string;
  roleName: string;
  status: "pending" | "accepted" | "declined" | "revoked";
  invitedBy: string;
  created: string;
}

export interface Me {
  user: { id: string; name: string; email: string; verified: boolean; isPlatformAdmin: boolean };
  memberships: Membership[];
  invitations: Invitation[];
  // Whether accepting an invitation needs a verified email on this server
  // (local development trusts addresses).
  verificationRequired: boolean;
}

export interface Member {
  id: string; // the membership's id
  userId: string;
  name: string;
  email: string; // blank unless you're an admin of the organisation
  verified: boolean;
  roleId: string;
  roleName: string;
  isAdmin: boolean;
  created: string;
}

// emailed is false when the server has no mail set up: the inviter passes
// the sign-up link on themselves.
export interface InviteResult {
  invitation: Invitation;
  emailed: boolean;
}

export interface AdminOrgRow {
  id: string;
  name: string;
  suspended: boolean;
  created: string;
  members: number;
  admins: number;
  pendingInvitations: number;
  items: number;
  jobs: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  suspended: boolean;
  created: string;
  members: Member[];
  invitations: Invitation[];
  roles: OrgRole[];
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  verified: boolean;
  isPlatformAdmin: boolean;
  created: string;
  memberships: { orgId: string; orgName: string; roleName: string }[];
}

export interface CustomFieldDef {
  key: string;
  label: string;
  appliesTo: "item" | "serial";
}

export interface SearchResultItem {
  id: string;
  name: string;
  subtitle: string;
}

export interface SearchResults {
  items: SearchResultItem[];
  assets: SearchResultItem[];
  jobs: SearchResultItem[];
  contacts: SearchResultItem[];
  labels: SearchResultItem[];
}

export interface EquipmentView {
  id: string;
  name: string;
  columns: string[];
  widths: Record<string, number>;
  sortKey: string;
  sortDir: "asc" | "desc";
  shared: boolean;
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
}

export type EquipmentViewInput = Omit<EquipmentView, "id" | "ownerId" | "ownerName" | "isOwner">;

export interface ImportRun extends RecordModel {
  source: "rentman" | "csv";
  status: "running" | "ok" | "failed";
  counts: Record<string, number | string>;
  errors: { resource?: string; rentmanId?: string; name?: string; row?: number; message: string }[];
  message: string;
  who: string;
  finishedAt: string;
}

export interface RentmanImportResult {
  runId: string;
  counts: Record<string, number>;
  errors: { resource: string; rentmanId: string; name: string; message: string }[];
  tookMs: number;
}

// A job that could be invoiced (GET /api/exports/xero/jobs).
export interface XeroJob {
  jobId: string;
  number: number;
  name: string;
  status: JobStatus;
  client: string;
  returnAt: string;
  quote: { id: string; version: number; status: QuoteStatus; exGst: number; total: number } | null;
  changedSinceQuote: boolean;
}

export interface CsvImportResult {
  dryRun: boolean;
  committed: boolean;
  counts: Record<string, number>;
  errors: { row: number; message: string }[];
}

export const api = {
  // First run: the login page offers to create the first admin when there
  // are no users yet — see routes_setup.pb.js.
  setupStatus: () => request<{ needed: boolean }>("/api/setup"),
  setup: (data: { name: string; email: string; password: string; businessName: string }) =>
    request<{ ok: true }>("/api/setup", json("POST", data)),

  // Jobs
  getJobSummary: (id: string) => request<JobSummary>(`/api/jobs/${id}/summary`),
  addLine: (jobId: string, line: NewLine) => request<JobSummary>(`/api/jobs/${jobId}/lines`, json("POST", line)),
  updateLine: (lineId: string, patch: LinePatch) => request<JobSummary>(`/api/job-lines/${lineId}`, json("PATCH", patch)),
  deleteLine: (lineId: string) => request<JobSummary>(`/api/job-lines/${lineId}`, json("DELETE")),
  issueQuote: (jobId: string) =>
    request<{ quoteId: string; summary: JobSummary }>(`/api/jobs/${jobId}/quotes`, json("POST")),
  getQuote: (id: string) => request<Quote>(`/api/quotes/${id}`),
  quotePdf: (id: string) => requestFile(`/api/quotes/${id}/pdf`, "quote.pdf"),
  packingPdf: (jobId: string) => requestFile(`/api/jobs/${jobId}/packing.pdf`, "packing-list.pdf"),
  labelsPdf: (labels: { imageDataUrl: string; widthMm: number; heightMm: number; copies: number }[]) =>
    requestFile("/api/labels/pdf", "labels.pdf", json("POST", { labels })),
  setQuoteStatus: (id: string, status: QuoteStatus) => request<Quote>(`/api/quotes/${id}`, json("PATCH", { status })),

  // Availability
  availability: (start: string, end: string, excludeJob?: string) =>
    request<AvailabilityMap>(
      `/api/availability?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${
        excludeJob ? `&excludeJob=${encodeURIComponent(excludeJob)}` : ""
      }`,
    ),
  itemTimeline: (itemId: string, from: string, to: string) =>
    request<ItemTimeline>(`/api/items/${itemId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),

  // Warehouse
  lookup: (code: string) =>
    request<{ kind: "serial" | "item"; id: string; itemId: string }>(`/api/lookup?code=${encodeURIComponent(code)}`),
  scan: (jobId: string, body: { code: string; direction: "out" | "in"; quantity?: number }) =>
    request<{ message: string; summary: JobSummary }>(`/api/jobs/${jobId}/scan`, json("POST", body)),
  setSerialStatus: (id: string, status: SerialStatus, note?: string) =>
    request<Serial>(`/api/serials/${id}/status`, json("POST", { status, note })),
  // Delete an inventory folder, with everything in it or keeping it (moved
  // up a level). See pb_hooks/routes_folders.pb.js.
  deleteFolder: (id: string, contents: boolean) =>
    request<{ deleted: number; archived: number; moved: number }>(`/api/folders/${id}/delete`, json("POST", { contents })),
  setOutOfService: (itemId: string, quantity: number, note?: string) =>
    request<Item>(`/api/items/${itemId}/out-of-service`, json("POST", { quantity, note })),

  // Global search across items/units/jobs/contacts/label templates — see
  // pocketbase/pb_hooks/routes_search.pb.js.
  search: (q: string, signal?: AbortSignal) =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),

  // Imports
  importRentman: () => request<RentmanImportResult>("/api/import/rentman", json("POST")),
  importCsv: (kind: "items" | "contacts", rows: Record<string, string>[], dryRun: boolean) =>
    request<CsvImportResult>("/api/import/csv", json("POST", { kind, rows, dryRun })),
  listImportRuns: () => request<ImportRun[]>("/api/import/runs"),

  // Labels
  listLabels: () => request<(LabelTemplateData & { id: string })[]>("/api/labels"),
  getLabel: (id: string) => request<LabelTemplateData & { id: string }>(`/api/labels/${id}`),
  createLabel: (template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>("/api/labels", json("POST", template)),
  updateLabel: (id: string, template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>(`/api/labels/${id}`, json("PUT", template)),
  deleteLabel: (id: string) => request<{ ok: true }>(`/api/labels/${id}`, json("DELETE")),
  print: (
    args:
      | { templateId: string; serialId?: string; imageDataUrl: string; label: string }
      | { customText: string; imageDataUrl: string; label: string },
  ) => request<{ ok: boolean; message: string }>("/api/print", json("POST", args)),
  // Names for imported "custom_<id>" fields — see routes_custom_fields.pb.js.
  listCustomFields: () => request<CustomFieldDef[]>("/api/custom-fields"),

  // Named app-settings/activity, not settings/logs — those paths are
  // PocketBase's own built-in superuser endpoints (see
  // pocketbase/pb_hooks/routes_app_settings.pb.js and routes_activity.pb.js).
  getSettings: () => request<Settings>("/api/app-settings"),
  updateSettings: (settings: SettingsUpdate) => request<Settings>("/api/app-settings", json("PUT", settings)),

  // Xero invoice import file — see routes_exports.pb.js.
  xeroJobs: (from: string, to: string) =>
    request<XeroJob[]>(`/api/exports/xero/jobs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  xeroCsv: (jobIds: string[], invoiceDate: string) =>
    requestFile(
      `/api/exports/xero.csv?jobs=${encodeURIComponent(jobIds.join(","))}&invoiceDate=${encodeURIComponent(invoiceDate)}`,
      "xero-invoices.csv",
    ),

  // Calendar subscription address (admin) — see routes_ical.pb.js.
  getCalendarLink: () => request<{ url: string }>("/api/ical/link"),
  rotateCalendarLink: () => request<{ url: string }>("/api/ical/rotate", json("POST")),

  getStats: () => request<Stats>("/api/stats"),
  getLogs: () => request<LogEntry[]>("/api/activity"),
  logEvent: (type: string, details?: Record<string, unknown>) =>
    request<LogEntry>("/api/activity", json("POST", { type, details })),

  listEquipmentViews: () => request<EquipmentView[]>("/api/equipment-views"),
  createEquipmentView: (data: EquipmentViewInput) => request<EquipmentView>("/api/equipment-views", json("POST", data)),
  updateEquipmentView: (id: string, data: EquipmentViewInput) =>
    request<EquipmentView>(`/api/equipment-views/${id}`, json("PUT", data)),
  deleteEquipmentView: (id: string) => request<{ ok: true }>(`/api/equipment-views/${id}`, json("DELETE")),

  // You: the organisations you're in and invited to — see routes_me.pb.js.
  me: () => request<Me>("/api/me"),
  acceptInvitation: (id: string) => request<{ ok: true; orgId: string }>(`/api/invitations/${id}/accept`, json("POST")),
  declineInvitation: (id: string) => request<{ ok: true }>(`/api/invitations/${id}/decline`, json("POST")),
  leaveOrg: (orgId: string) => request<{ ok: true }>(`/api/me/memberships/${orgId}`, json("DELETE")),

  // An organisation's team — see routes_orgs.pb.js.
  listMembers: (orgId: string) => request<Member[]>(`/api/orgs/${orgId}/members`),
  setMemberRole: (orgId: string, memberId: string, roleId: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/members/${memberId}`, json("PATCH", { roleId })),
  removeMember: (orgId: string, memberId: string) => request<{ ok: true }>(`/api/orgs/${orgId}/members/${memberId}`, json("DELETE")),
  listInvitations: (orgId: string) => request<Invitation[]>(`/api/orgs/${orgId}/invitations`),
  invite: (orgId: string, email: string, roleId: string) =>
    request<InviteResult>(`/api/orgs/${orgId}/invitations`, json("POST", { email, roleId })),
  revokeInvitation: (orgId: string, invitationId: string) =>
    request<{ ok: true }>(`/api/orgs/${orgId}/invitations/${invitationId}`, json("DELETE")),
  renameOrg: (orgId: string, name: string) => request<{ ok: true }>(`/api/orgs/${orgId}`, json("PATCH", { name })),

  // Roles — see routes_roles.pb.js.
  permissions: () => request<PermissionCatalogue>("/api/permissions"),
  listRoles: (orgId: string) => request<OrgRole[]>(`/api/orgs/${orgId}/roles`),
  createRole: (orgId: string, data: { name: string; description: string; permissions: string[] }) =>
    request<OrgRole>(`/api/orgs/${orgId}/roles`, json("POST", data)),
  updateRole: (orgId: string, roleId: string, data: { name: string; description: string; permissions: string[] }) =>
    request<OrgRole>(`/api/orgs/${orgId}/roles/${roleId}`, json("PATCH", data)),
  deleteRole: (orgId: string, roleId: string) => request<{ ok: true }>(`/api/orgs/${orgId}/roles/${roleId}`, json("DELETE")),
};

// The platform admin panel: every organisation and account — see
// routes_admin.pb.js.
export const adminApi = {
  orgs: () => request<AdminOrgRow[]>("/api/admin/orgs"),
  createOrg: (name: string, adminEmail: string) =>
    request<{ id: string; name: string; invitation: Invitation | null; emailed: boolean }>(
      "/api/admin/orgs",
      json("POST", { name, adminEmail }),
    ),
  org: (id: string) => request<AdminOrg>(`/api/admin/orgs/${id}`),
  updateOrg: (id: string, patch: { name?: string; suspended?: boolean }) =>
    request<{ ok: true }>(`/api/admin/orgs/${id}`, json("PATCH", patch)),
  deleteOrg: (id: string, confirmName: string) => request<{ ok: true }>(`/api/admin/orgs/${id}`, json("DELETE", { confirm: confirmName })),
  invite: (orgId: string, email: string, roleId: string) =>
    request<InviteResult>(`/api/admin/orgs/${orgId}/invitations`, json("POST", { email, roleId })),
  revokeInvitation: (orgId: string, invitationId: string) =>
    request<{ ok: true }>(`/api/admin/orgs/${orgId}/invitations/${invitationId}`, json("DELETE")),
  setRole: (orgId: string, memberId: string, roleId: string) =>
    request<{ ok: true }>(`/api/admin/orgs/${orgId}/members/${memberId}`, json("PATCH", { roleId })),
  removeMember: (orgId: string, memberId: string) =>
    request<{ ok: true }>(`/api/admin/orgs/${orgId}/members/${memberId}`, json("DELETE")),
  users: () => request<AdminUser[]>("/api/admin/users"),
  updateUser: (id: string, patch: { name?: string; verified?: boolean; isPlatformAdmin?: boolean }) =>
    request<{ ok: true }>(`/api/admin/users/${id}`, json("PATCH", patch)),
  deleteUser: (id: string) => request<{ ok: true }>(`/api/admin/users/${id}`, json("DELETE")),
};

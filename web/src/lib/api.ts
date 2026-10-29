import type { RecordModel } from "pocketbase";
import type { LabelTemplateData } from "./labelSpec";
import type { PrintingConfig } from "./printing";

export interface PrintResult {
  ok: boolean;
  message: string;
  printerId?: string;
  printer?: string;
  unreachable?: boolean; // the request itself failed: printer offline or server unreachable
}
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
      // FormData sets its own multipart type, boundary included.
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
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

// One file as multipart "files", the way the file routes take it.
function upload(file: File): RequestInit {
  const body = new FormData();
  body.append("files", file);
  return { method: "POST", body };
}

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

// A bulk item's quantity at one stock location, and the shelf or bin it's
// on there (pb_hooks/lib/stock.js). The item's stockQty is their total.
export interface ItemStock extends RecordModel {
  org: string;
  item: string;
  location: string;
  qty: number;
  bin: string;
}

export interface Serial extends RecordModel {
  org: string;
  item: string;
  barcode: string;
  serialNumber: string;
  label: string;
  status: SerialStatus;
  location: string;
  // Shelf or bin at its location.
  bin: string;
  purchaseDate: string;
  purchaseCost: number;
  nextInspection: string;
  notes: string;
  custom: Record<string, unknown> | null;
  rentmanId: string;
  files: string[];
  fileInfo: FileInfo | null;
}

// What a repair status does to the kit (pb_hooks/lib/repairs.js): open
// keeps it out of service, repaired puts it back, unrepairable retires it.
export type RepairStage = "open" | "repaired" | "unrepairable";
export type StatusColour = "gray" | "amber" | "orange" | "blue" | "teal" | "violet" | "green" | "red";

// One of an organisation's own repair statuses (Settings → Repair statuses).
export interface RepairStatusDef extends RecordModel {
  org: string;
  name: string;
  stage: RepairStage;
  colour: StatusColour | "";
  sortOrder: number;
  isDefault: boolean;
}

export type RepairStatusInput = Pick<RepairStatusDef, "name" | "stage" | "colour" | "isDefault"> & { id?: string };

// One of an organisation's own project statuses (Settings → Project
// statuses, pb_hooks/lib/jobStatuses.js), on one of the fixed stages
// (JobStatus) that availability and scanning run on.
export interface JobStatusDef extends RecordModel {
  org: string;
  name: string;
  stage: JobStatus;
  colour: StatusColour | "";
  sortOrder: number;
  isDefault: boolean;
}

export type JobStatusInput = Pick<JobStatusDef, "name" | "stage" | "colour" | "isDefault"> & { id?: string };

// Equipment tracking (pb_hooks/lib/tracking.js): where kit is on its way
// to a project and back. Each organisation's steps sit on fixed stages:
// prep (pulled, still in the building), out (gone with the project), back.
export type TrackingStage = "prep" | "out" | "back";

export interface TrackingStep extends RecordModel {
  org: string;
  name: string;
  stage: TrackingStage;
  colour: StatusColour | "";
  sortOrder: number;
  // Once everything on a project's reached this step, it moves to this status.
  jobStatus: string;
}

export type TrackingStepInput = Pick<TrackingStep, "name" | "stage" | "colour" | "jobStatus"> & { id?: string };

export interface TrackingSuggestion {
  step: string;
  stepName: string;
  status: string;
  statusName: string;
}

// An address found by the lookup (pb_hooks/lib/addresses.js).
export interface AddressMatch {
  // On one line, for the list.
  label: string;
  // One line each, as it's written on an envelope.
  address: string;
}

// A project on the equipment tracking board (GET /api/tracking/projects).
export interface TrackedProject {
  id: string;
  number: number;
  name: string;
  status: JobStatus;
  jobStatus: string;
  client: string;
  prepAt: string;
  returnAt: string;
  needed: number;
  at: TrackedAt;
  // A project status its kit has all reached, to offer ("" for none).
  suggestion: string;
}

// Units at each tracking step, by step id; the rest haven't started.
export type TrackedAt = Record<string, number>;

// What an organisation uses (Settings → Features, pb_hooks/lib/features.js).
// Starting points for an organisation (lib/workflow.ts PRESETS).
export type PresetKey = "hire" | "venue" | "inventory";
export type FeatureKey = "projects" | "scanning" | "repairs" | "maintenance" | "labels" | "pricing" | "crew" | "integrations" | "xero";
export type Features = Record<FeatureKey, boolean>;

// Files on a repair or maintenance job (pb_hooks/lib/files.js): the stored
// names are in `files`; this has the name each was uploaded with, its size,
// and who added it when.
export type FileInfo = Record<string, { name: string; size: number; by: string; at: string }>;

// A repair job (pb_hooks/lib/repairs.js): one item's broken units, or a
// quantity of a bulk item, out of service until it's closed.
export interface Repair extends RecordModel {
  org: string;
  number: number;
  item: string;
  serials: string[];
  quantity: number;
  // A RepairStatusDef id.
  status: string;
  fault: string;
  repairer: string;
  cost: number;
  dueAt: string;
  closedAt: string;
  notes: string;
  // The project it came back damaged from, if any.
  job: string;
  files: string[];
  fileInfo: FileInfo | null;
  createdBy: string;
}

export type MaintenanceKind = "inspection" | "test_tag" | "service";
export type IntervalUnit = "day" | "week" | "month" | "year";
export type PlanRepeat = "" | "fixed";

// Repeating maintenance (pb_hooks/lib/maintenance.js): each unit of its
// serialised items, and each bulk item, gets its own scheduled job.
export interface MaintenancePlan extends RecordModel {
  org: string;
  name: string;
  kind: MaintenanceKind;
  every: number;
  unit: IntervalUnit;
  // "" counts each next one from when the last was done; "fixed" keeps to
  // the calendar from firstDue (every month on the 15th).
  repeat: PlanRepeat;
  items: string[];
  // Calendar days ("2026-10-22"), like the jobs' dates.
  firstDue: string;
  instructions: string;
  createdBy: string;
}

// One piece of maintenance on one unit, one bulk item or nothing in
// particular: from a plan, or one-off.
export interface MaintenanceJob extends RecordModel {
  org: string;
  plan: string;
  name: string;
  kind: MaintenanceKind;
  item: string;
  serial: string;
  dueOn: string;
  status: "scheduled" | "done";
  result: "pass" | "fail" | "";
  failedQty: number;
  doneOn: string;
  doneBy: string;
  notes: string;
  cost: number;
  files: string[];
  fileInfo: FileInfo | null;
  repair: string;
  createdBy: string;
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
  // The stage, which availability and scanning read; jobStatus is the
  // organisation's own status on it (a JobStatusDef id).
  status: JobStatus;
  jobStatus: string;
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
  // Where it's kept: "Main store, Bay 3", or each place with how many.
  where: string;
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
  // The subproject it's on, "" for the main project.
  subproject: string;
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
  // Physical lines: where its units are (lib/tracking.js).
  tracking?: { at: TrackedAt };
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
  jobStatus: string;
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
  // Equipment headings in order, per part ("" = the main project).
  headings?: { section: string; name: string }[];
  created: string;
  updated: string;
  clientInfo: ContactInfo | null;
  venueInfo: VenueInfo | null;
}

// Units still out on each project that has any, from its scans.
export type Outstanding = Record<string, { units: number; status: JobStatus }>;

// A project document: one of the organisation's printable forms
// (pb_hooks/lib/documents.js, Settings → Documents).
export type DocumentFieldType = "heading" | "note" | "text" | "textarea" | "checkbox" | "date" | "signature";
export interface DocumentField {
  id: string;
  type: DocumentFieldType;
  label: string;
}
export type DocumentEquipment = "none" | "list" | "checklist" | "return";
export interface DocumentTemplate extends RecordModel {
  org: string;
  name: string;
  description: string;
  equipment: DocumentEquipment;
  schedule: boolean;
  notes: boolean;
  fields: DocumentField[];
  sortOrder: number;
}

export interface PackingItem {
  itemId: string;
  name: string;
  tracking: string;
  needed: number;
  // The units it needs that are at each step (up to needed).
  at: TrackedAt;
  // Units that have reached any step.
  scannedOut: number;
  returned: number;
  // With the project now (not back yet).
  out: number;
  serialsOut: { id: string; step: string; barcode: string; label: string }[];
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
  // The subproject it belongs to, "" for the main project.
  subproject: string;
  kind: PeriodKind;
  name: string;
  start: string;
  end: string;
  notes: string;
}

// Part of a project with its own schedule (pb_migrations/0030_subprojects.js):
// its kit is booked and charged over its own periods, on the same quote.
// The charge fields are only there with prices.
export interface Subproject {
  id: string;
  name: string;
  sortOrder: number;
  prepAt: string;
  returnAt: string;
  billingStart: string;
  billingEnd: string;
  days?: number;
  hours?: number;
  weeks?: number;
  factor?: number;
  subtotal?: number;
}

export interface JobSummary {
  job: JobInfo;
  subprojects: Subproject[];
  periods: JobPeriod[];
  lines: JobLineView[];
  packing: { items: PackingItem[]; packed: boolean; allBack: boolean; scanCount: number };
  // A project status its kit has all reached now, to offer (never set by itself).
  trackingSuggestion: TrackingSuggestion | null;
  includesPrices: boolean;
  pricing?: JobPricing;
  quotes?: QuoteSummary[];
}

export interface QuoteLine {
  id: string;
  parentLine: string;
  subproject?: string;
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
  // Quotes from before subprojects don't have these.
  subprojects?: Pick<Subproject, "id" | "name" | "prepAt" | "returnAt" | "billingStart" | "billingEnd" | "days" | "factor" | "subtotal">[];
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
  subproject?: string;
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
  subproject: string;
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
  // Only in /api/me memberships.
  features?: Features;
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
  features: Features;
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

export type CustomFieldType = "text" | "number" | "boolean" | "date" | "select";

// A custom_fields record: an organisation's own field (Settings → Custom
// fields), or a name the Rentman importer brought in. Items keep their
// values under `key` in their `custom` object.
export interface CustomField extends RecordModel {
  org: string;
  key: string;
  label: string;
  appliesTo: "item" | "serial";
  // Empty on fields imported before types existed: those are text.
  type: CustomFieldType | "";
  options: string[] | null;
  sortOrder: number;
  source: string;
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

// Who something saved is shared with (pb_hooks/lib/sharing.js): its owner
// (none for the organisation's own), people they picked, or everyone
// (public, which needs views.publish to change).
export interface Shared {
  ownerId: string;
  ownerName: string;
  isOwner: boolean;
  canEdit: boolean;
  public: boolean;
  sharedWith: { id: string; name: string }[];
}

export interface SharingInput {
  public?: boolean;
  sharedWith?: string[];
}


// A Home page someone designed (pb_hooks/lib/views.js): panels in order,
// from web/src/lib/home.ts.
export interface Dashboard extends Shared {
  id: string;
  name: string;
  panels: { id: string }[];
  // Everyone's Home until they pick their own.
  isDefault: boolean;
}

export interface Dashboards {
  dashboards: Dashboard[];
  // Your pick ("" for the default).
  home: string;
  defaultId: string;
}

// The list pages with saved views (pb_hooks/lib/views.js).
export type ViewPage = "projects" | "inventory" | "contacts" | "locations" | "crew" | "rostering" | "maintenance" | "repairs" | "maintenance-history";

// A saved view's settings: the page's filters and columns, as JSON.
export type ViewConfig = Record<string, unknown>;

// A saved view of a list page: its filters and column settings.
export interface ListView extends Shared {
  id: string;
  page: ViewPage;
  name: string;
  config: ViewConfig;
  // The organisation's default for its page.
  isDefault: boolean;
}

export interface PageViewsData {
  views: ListView[];
  // Your pick: a view's id, "standard" for the page as it comes, or "" to
  // follow the organisation's default.
  pick: string;
  defaultId: string;
}

// Someone on a project (job_crew): filling one of its crew needs (a slot),
// or on the whole project when need is "". user is the person's login, if
// they're a member ("" for freelancers).
export interface CrewMember extends RecordModel {
  org: string;
  job: string;
  person: string;
  need: string;
  user: string;
  function: string;
  sortOrder: number;
}

// One of the organisation's crew roles (Settings → Crew roles).
export interface CrewRole extends RecordModel {
  org: string;
  name: string;
  sortOrder: number;
}

// Someone who can be rostered: a member (user set) or a freelancer.
// skills: the crew roles they do.
export interface CrewPerson extends RecordModel {
  org: string;
  user: string;
  name: string;
  phone: string;
  email: string;
  skills: string[];
  notes: string;
  archived: boolean;
}

// What a schedule item needs: quantity × role, over the item's times
// unless customTimes.
export interface CrewNeed extends RecordModel {
  org: string;
  job: string;
  period: string;
  role: string;
  quantity: number;
  start: string;
  end: string;
  customTimes: boolean;
  notes: string;
  sortOrder: number;
}

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
  // The next page of project lines to import, or null when they're done.
  next: string | null;
  tookMs: number;
}

export type RentmanImportStep = "equipment" | "contacts" | "projects" | "lines";

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

export interface PlanInput {
  name: string;
  kind?: MaintenanceKind;
  every: number;
  unit: IntervalUnit;
  repeat: PlanRepeat;
  items: string[];
  firstDue: string;
  instructions: string;
}

export interface CsvImportResult {
  dryRun: boolean;
  committed: boolean;
  counts: Record<string, number>;
  errors: { row: number; message: string }[];
}

// Live sync (Settings → Integrations, pb_hooks/lib/integrations.js).
export type IntegrationProvider = "rentman" | "momentus";
export type ConflictRule = "newest" | "remote" | "local";

export interface RentmanSyncConfig {
  enabled: boolean;
  paused: boolean;
  conflictRule: ConflictRule;
  firstSync: "remote" | "local";
  pollMinutes: number;
  linesPollHours: number;
  sync: { items: "both" | "in"; contacts: "both" | "in"; venues: "both" | "in" };
  createInRentman: { items: boolean; contacts: boolean; venues: boolean };
  projects: boolean;
  projectRequests: boolean;
  webhookKey: string;
}

export interface MomentusSyncConfig {
  enabled: boolean;
  paused: boolean;
  baseUrl: string;
  orgCode: string;
  apiUserId: string;
  pollMinutes: number;
  pastDays: number;
  windowMonths: number;
  eventStatuses: string[];
  onlyWithOrders: boolean;
  departments: string[];
  prepHours: number;
  returnHours: number;
  statusMap: Record<string, JobStatus>;
  pullEvents: boolean;
  pullOrders: boolean;
  pushQuotes: boolean;
  orderDepartment: string;
  orderType: string;
  miscResource: string;
  pushInventory: boolean;
  inventoryCategories: string[];
  conflictRule: ConflictRule;
  endpoints: Record<string, string>;
}

export interface IntegrationSummary<C> {
  config: C;
  // The organisation has projects off, so the sync leaves projects, contacts and quotes alone.
  projectsOff: boolean;
  state: {
    lastPollAt: number | null;
    lastLinesPollAt: number | null;
    lastWebhookAt: number | null;
    lastError: string;
    initialDone: boolean;
    seenStatuses: Record<string, string>;
    inventoryBlocked: boolean;
    lastInventoryAt: number | null;
  };
  pending: number;
  failed: { id: string; action: string; collection: string; record: string; remoteId: string; attempts: number; error: string; updated: string }[];
  links: Record<string, number>;
  secretSet: boolean;
  webhookUrl?: string;
}

export interface Integrations {
  rentman: IntegrationSummary<RentmanSyncConfig>;
  momentus: IntegrationSummary<MomentusSyncConfig>;
}

export interface SyncConflict {
  collection: string;
  record: string;
  remoteId: string;
  field: string;
  local: unknown;
  remote: unknown;
  winner: "local" | "remote";
}

export interface SyncLogEntry {
  id: string;
  kind: string;
  status: "ok" | "partial" | "failed";
  counts: Record<string, number>;
  errors: { what: string; id: string; name: string; message: string }[];
  conflicts: SyncConflict[];
  message: string;
  who: string;
  startedAt: string;
  finishedAt: string;
}

export interface SyncLink {
  provider: IntegrationProvider;
  remoteType: string;
  remoteId: string;
  syncedAt: string;
  extra: Record<string, unknown>;
  active: boolean;
}

export const api = {
  // First run: the login page offers to create the first admin when there
  // are no users yet — see routes_setup.pb.js.
  setupStatus: () => request<{ needed: boolean }>("/api/setup"),
  setup: (data: { name: string; email: string; password: string; businessName: string; preset?: PresetKey }) =>
    request<{ ok: true }>("/api/setup", json("POST", data)),

  // Jobs
  getJobSummary: (id: string) => request<JobSummary>(`/api/jobs/${id}/summary`),
  addLine: (jobId: string, line: NewLine) => request<JobSummary>(`/api/jobs/${jobId}/lines`, json("POST", line)),
  updateLine: (lineId: string, patch: LinePatch) => request<JobSummary>(`/api/job-lines/${lineId}`, json("PATCH", patch)),
  deleteLine: (lineId: string) => request<JobSummary>(`/api/job-lines/${lineId}`, json("DELETE")),
  headingAction: (
    jobId: string,
    body: { action: "add" | "rename" | "remove" | "move"; section: string; name: string; to?: string; direction?: -1 | 1 },
  ) => request<JobSummary>(`/api/jobs/${jobId}/headings`, json("POST", body)),
  addSubproject: (jobId: string, body: { name: string; usageStart: string; usageEnd: string; billingStart?: string; billingEnd?: string }) =>
    request<JobSummary>(`/api/jobs/${jobId}/subprojects`, json("POST", body)),
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
  // item and serial say what was scanned ("" serial for bulk), for reporting a fault with it.
  scan: (jobId: string, body: { code: string; step: string; quantity?: number }) =>
    request<{ message: string; item: string; serial: string; stage: TrackingStage; summary: JobSummary }>(`/api/jobs/${jobId}/scan`, json("POST", body)),
  setSerialStatus: (id: string, status: SerialStatus, note?: string) =>
    request<Serial>(`/api/serials/${id}/status`, json("POST", { status, note })),
  // Delete an inventory folder, with everything in it or keeping it (moved
  // up a level). See pb_hooks/routes_folders.pb.js.
  deleteFolder: (id: string, contents: boolean) =>
    request<{ deleted: number; archived: number; moved: number }>(`/api/folders/${id}/delete`, json("POST", { contents })),
  // Replace a bulk item's stock by location (pb_hooks/records_stock.pb.js).
  setItemStock: (itemId: string, stock: { location: string; qty: number; bin: string }[]) =>
    request<{ item: Item; stock: ItemStock[] }>(`/api/items/${itemId}/stock`, json("PUT", { stock })),
  setOutOfService: (itemId: string, quantity: number, note?: string) =>
    request<Item>(`/api/items/${itemId}/out-of-service`, json("POST", { quantity, note })),
  // Search online for a photo and let the local vision model pick one; saves
  // it on the item. See pb_hooks/routes_item_photo.pb.js. Takes a while.
  findItemPhoto: (itemId: string) =>
    request<{ item: Item; found: { query: string; source: string; title: string; reason: string } }>(`/api/items/${itemId}/find-photo`, json("POST")),
  // Repairs: see pb_hooks/routes_repairs.pb.js.
  openRepair: (body: {
    item: string;
    serials?: string[];
    quantity?: number;
    fault: string;
    repairer?: string;
    dueAt?: string;
    notes?: string;
    job?: string;
    status?: string;
  }) => request<Repair>("/api/repairs", json("POST", body)),
  updateRepair: (id: string, body: Partial<Pick<Repair, "fault" | "repairer" | "cost" | "dueAt" | "notes" | "status" | "job">>) =>
    request<Repair>(`/api/repairs/${id}`, json("PATCH", body)),
  uploadRepairFile: (id: string, file: File) => request<Repair>(`/api/repairs/${id}/files`, upload(file)),
  deleteRepairFile: (id: string, name: string) => request<Repair>(`/api/repairs/${id}/files/${encodeURIComponent(name)}`, json("DELETE")),
  uploadSerialFile: (id: string, file: File) => request<Serial>(`/api/serials/${id}/files`, upload(file)),
  deleteSerialFile: (id: string, name: string) => request<Serial>(`/api/serials/${id}/files/${encodeURIComponent(name)}`, json("DELETE")),
  repairActivity: (id: string) => request<LogEntry[]>(`/api/repairs/${id}/activity`),
  saveRepairStatuses: (statuses: RepairStatusInput[]) => request<RepairStatusDef[]>("/api/repair-statuses", json("PUT", { statuses })),
  saveCrewRoles: (roles: { id?: string; name: string }[]) => request<CrewRole[]>("/api/crew-roles", json("PUT", { roles })),
  searchAddresses: (q: string) => request<AddressMatch[]>(`/api/addresses?q=${encodeURIComponent(q)}`),
  warmAddressLookup: () => request<AddressMatch[]>("/api/addresses?warm=1"),
  trackingProjects: () => request<TrackedProject[]>("/api/tracking/projects"),
  acceptTrackingStatus: (jobId: string, status: string) => request<JobSummary>(`/api/jobs/${jobId}/tracking-status`, json("POST", { status })),
  saveTrackingSteps: (steps: TrackingStepInput[]) => request<TrackingStep[]>("/api/tracking-steps", json("PUT", { steps })),
  saveJobStatuses: (statuses: JobStatusInput[], moves: Record<string, string> = {}) =>
    request<JobStatusDef[]>("/api/job-statuses", json("PUT", { statuses, moves })),

  // Maintenance: see pb_hooks/routes_maintenance.pb.js.
  createPlan: (body: PlanInput) => request<MaintenancePlan>("/api/maintenance/plans", json("POST", body)),
  updatePlan: (id: string, body: Partial<PlanInput>) => request<MaintenancePlan>(`/api/maintenance/plans/${id}`, json("PATCH", body)),
  deletePlan: (id: string) => request<{ ok: true }>(`/api/maintenance/plans/${id}`, json("DELETE")),
  scheduleJobs: (body: { name: string; kind?: MaintenanceKind; item?: string; serials?: string[]; dueOn: string; notes?: string }) =>
    request<MaintenanceJob[]>("/api/maintenance/jobs", json("POST", body)),
  updateJob: (id: string, body: Partial<Pick<MaintenanceJob, "name" | "dueOn" | "notes" | "cost" | "doneBy">>) =>
    request<MaintenanceJob>(`/api/maintenance/jobs/${id}`, json("PATCH", body)),
  deleteJob: (id: string) => request<{ ok: true }>(`/api/maintenance/jobs/${id}`, json("DELETE")),
  completeJob: (
    id: string,
    body: {
      result: "pass" | "fail";
      doneOn?: string;
      doneBy?: string;
      notes?: string;
      cost?: number;
      failedQty?: number;
      repair?: { fault: string; repairer?: string };
    },
  ) => request<{ job: MaintenanceJob; repair: Repair | null }>(`/api/maintenance/jobs/${id}/done`, json("POST", body)),
  passJobs: (ids: string[], doneOn?: string, doneBy?: string) =>
    request<{ done: number; failed: Record<string, string> }>("/api/maintenance/jobs/pass", json("POST", { ids, doneOn, doneBy })),
  uploadJobFile: (id: string, file: File) => request<MaintenanceJob>(`/api/maintenance/jobs/${id}/files`, upload(file)),
  deleteJobFile: (id: string, name: string) =>
    request<MaintenanceJob>(`/api/maintenance/jobs/${id}/files/${encodeURIComponent(name)}`, json("DELETE")),

  // Global search across items/units/jobs/contacts/label templates — see
  // pocketbase/pb_hooks/routes_search.pb.js.
  search: (q: string, signal?: AbortSignal) =>
    request<SearchResults>(`/api/search?q=${encodeURIComponent(q)}`, { signal }),

  // Imports
  importCsv: (kind: "items" | "contacts", rows: Record<string, string>[], dryRun: boolean) =>
    request<CsvImportResult>("/api/import/csv", json("POST", { kind, rows, dryRun })),
  listImportRuns: () => request<ImportRun[]>("/api/import/runs"),

  // Live sync
  getIntegrations: () => request<Integrations>("/api/integrations"),
  updateIntegration: <P extends IntegrationProvider>(
    provider: P,
    changes: Partial<P extends "rentman" ? RentmanSyncConfig : MomentusSyncConfig> & { secret?: string },
  ) => request<Integrations[P]>(`/api/integrations/${provider}`, json("PUT", changes)),
  testIntegration: (provider: IntegrationProvider) => request<{ ok: boolean; message: string }>(`/api/integrations/${provider}/test`, json("POST")),
  integrationAction: (provider: IntegrationProvider, action: "sync" | "retry" | "discard" | "pushInventory") =>
    request<{ ok: boolean; retried?: number; discarded?: number }>(`/api/integrations/${provider}/actions`, json("POST", { action })),
  integrationLog: (provider: IntegrationProvider) => request<SyncLogEntry[]>(`/api/integrations/${provider}/log`),
  momentusResourcesCsv: () => requestFile("/api/integrations/momentus/resources.csv", "momentus-resources.csv"),
  syncLink: (collection: "jobs" | "items" | "contacts" | "venues", id: string) =>
    request<{ link: SyncLink | null; canSendToRentman: boolean; sending: boolean }>(`/api/integrations/link/${collection}/${id}`),
  sendToRentman: (jobId: string) => request<{ ok: boolean }>(`/api/integrations/rentman/project-request/${jobId}`, json("POST")),

  // Labels
  listLabels: () => request<(LabelTemplateData & { id: string })[]>("/api/labels"),
  getLabel: (id: string) => request<LabelTemplateData & { id: string }>(`/api/labels/${id}`),
  createLabel: (template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>("/api/labels", json("POST", template)),
  updateLabel: (id: string, template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>(`/api/labels/${id}`, json("PUT", template)),
  deleteLabel: (id: string) => request<{ ok: true }>(`/api/labels/${id}`, json("DELETE")),
  // A 502 is a printer that couldn't be reached — reported, not thrown, so
  // the print dialog can try the next printer.
  print: async (
    args: (
      | { templateId: string; serialId?: string; imageDataUrl: string; label: string }
      | { customText: string; imageDataUrl: string; label: string }
    ) & { printerId?: string },
  ): Promise<PrintResult> => {
    try {
      return await request<PrintResult>("/api/print", json("POST", args));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      return { ok: false, message: (err as Error).message, unreachable: status === 502 || status === 0 };
    }
  },
  getPrinting: () => request<PrintingConfig>("/api/printing"),
  updatePrinting: (config: PrintingConfig) => request<PrintingConfig>("/api/printing", json("PUT", config)),
  checkPrinters: (ids?: string[]) =>
    request<Record<string, { ok: boolean; message: string }>>("/api/printing/check", json("POST", ids ? { ids } : {})),
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


  // Everyone's own dashboards and saved views — see routes_views.pb.js.
  dashboards: () => request<Dashboards>("/api/dashboards"),
  createDashboard: (data: { name: string; panels: { id: string }[] } & SharingInput) => request<Dashboard>("/api/dashboards", json("POST", data)),
  updateDashboard: (id: string, data: Partial<{ name: string; panels: { id: string }[]; isDefault: boolean }> & SharingInput) =>
    request<Dashboard>(`/api/dashboards/${id}`, json("PATCH", data)),
  deleteDashboard: (id: string) => request<{ ok: true }>(`/api/dashboards/${id}`, json("DELETE")),
  setHome: (dashboard: string) => request<{ home: string }>("/api/me/home", json("PUT", { dashboard })),
  listViews: (page: ViewPage) => request<PageViewsData>(`/api/views?page=${page}`),
  setPageView: (page: ViewPage, view: string) => request<{ pick: string }>(`/api/me/views/${page}`, json("PUT", { view })),
  createView: (data: { page: ViewPage; name: string; config: ViewConfig } & SharingInput) => request<ListView>("/api/views", json("POST", data)),
  updateView: (id: string, data: Partial<{ name: string; config: ViewConfig; isDefault: boolean }> & SharingInput) =>
    request<ListView>(`/api/views/${id}`, json("PATCH", data)),
  deleteView: (id: string) => request<{ ok: true }>(`/api/views/${id}`, json("DELETE")),
  // How much of each project's kit is needed and out, for "To prep next".
  // Units still out per project, for the ones with any (pb_hooks/lib/tracking.js).
  outstanding: () => request<Outstanding>("/api/jobs/outstanding"),
  packing: (jobIds: string[]) => request<Record<string, { needed: number; at: TrackedAt }>>(`/api/home/packing?jobs=${jobIds.join(",")}`),

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
  createRole: (orgId: string, data: { name: string; permissions: string[] }) =>
    request<OrgRole>(`/api/orgs/${orgId}/roles`, json("POST", data)),
  updateRole: (orgId: string, roleId: string, data: { name: string; permissions: string[] }) =>
    request<OrgRole>(`/api/orgs/${orgId}/roles/${roleId}`, json("PATCH", data)),
  deleteRole: (orgId: string, roleId: string) => request<{ ok: true }>(`/api/orgs/${orgId}/roles/${roleId}`, json("DELETE")),
};

// The platform admin panel: every organisation and account — see
// routes_admin.pb.js.
export const adminApi = {
  orgs: () => request<AdminOrgRow[]>("/api/admin/orgs"),
  // preset: what it starts with on (lib/workflow.ts PRESETS); omitted, everything.
  createOrg: (name: string, adminEmail: string, preset?: PresetKey) =>
    request<{ id: string; name: string; invitation: Invitation | null; emailed: boolean }>(
      "/api/admin/orgs",
      json("POST", { name, adminEmail, preset }),
    ),
  org: (id: string) => request<AdminOrg>(`/api/admin/orgs/${id}`),
  // What it has (it's what it pays for): platform admins only.
  updateFeatures: (orgId: string, features: Partial<Features>) =>
    request<Features>(`/api/admin/orgs/${orgId}/features`, json("PATCH", { features })),
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

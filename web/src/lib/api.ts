import type { LabelTemplateData } from "./labelSpec";
import { pb } from "./pocketbase";

export type RentmanRecord = Record<string, unknown> & { id: string };

export interface RentmanListResponse<T = RentmanRecord> {
  data: T[];
  meta?: Record<string, unknown>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: {
      // Fastify's JSON body parser rejects an empty body when Content-Type
      // says application/json (FST_ERR_CTP_EMPTY_JSON_BODY) — real problem
      // for bodyless calls like DELETE, so only send it when there's
      // actually a body (init.body is always a JSON string here, never
      // FormData/etc, so this check is exactly "did the caller pass one").
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(pb.authStore.token ? { Authorization: `Bearer ${pb.authStore.token}` } : {}),
    },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// Confirmed against a live Rentman token — see server/src/routes/assets.ts.
export interface SerialNumber extends RentmanRecord {
  displayname: string;
  serial: string;
  equipment: string;
  asset_location: string | null;
  ref: string;
  qrcodes: string;
  tags: string;
  active: boolean;
  next_inspection: string | null;
  last_subproject: string | null;
  remark: string;
  purchasedate: string | null;
  book_value: number;
  depreciation_monthly: number;
  residual_value: number;
  purchase_costs: number;
  current_book_value: number;
  sealed: boolean;
  _equipment: RentmanRecord | null;
  _location: RentmanRecord | null;
  _folder: RentmanRecord | null;
}

// Confirmed against a live Rentman token — see server/src/routes/equipment.ts.
export interface Equipment extends RentmanRecord {
  displayname: string;
  name: string;
  code: string;
  tags: string;
  current_quantity: number;
  current_quantity_excl_cases: number;
  location_in_warehouse: string;
  image: string | null;
  qrcodes: string;
  qrcodes_of_serial_numbers: string;
  internal_remark: string;
  external_remark: string;
  price: number;
  weight: number;
  height: number;
  width: number;
  length: number;
  packed_per: number;
  critical_stock_level: number;
  stock_management: string;
  type: string;
  rental_sales: string;
  subrental_costs: number;
  list_price: number;
  volume: number;
  empty_weight: number;
  power: number;
  current: number;
  country_of_origin: string;
  in_archive: boolean;
  folder: string | null;
}

export const api = {
  listAssets: () => request<RentmanListResponse<SerialNumber>>("/api/assets"),
  getAsset: (id: string) => request<SerialNumber & { _lastSubproject: RentmanRecord | null }>(`/api/assets/${id}`),
  searchAssets: (q: string) => request<{ id: string }>(`/api/assets/search?q=${encodeURIComponent(q)}`),

  listEquipment: () => request<RentmanListResponse<Equipment>>("/api/equipment"),
  getEquipment: (id: string) =>
    request<Equipment & { serialNumbers: SerialNumber[]; _folder: RentmanRecord | null }>(`/api/equipment/${id}`),

  listProjects: () => request<RentmanListResponse>("/api/projects"),
  getProject: (id: string) => request<RentmanRecord & { subprojects: RentmanRecord[] }>(`/api/projects/${id}`),
  getProjectEquipment: (id: string) =>
    request<{ lines: RentmanRecord[]; groups: RentmanRecord[] }>(`/api/projects/${id}/equipment`),

  listLabels: () => request<(LabelTemplateData & { id: string })[]>("/api/labels"),
  getLabel: (id: string) => request<LabelTemplateData & { id: string }>(`/api/labels/${id}`),
  createLabel: (template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>("/api/labels", { method: "POST", body: JSON.stringify(template) }),
  updateLabel: (id: string, template: LabelTemplateData) =>
    request<LabelTemplateData & { id: string }>(`/api/labels/${id}`, {
      method: "PUT",
      body: JSON.stringify(template),
    }),
  deleteLabel: (id: string) => request<{ ok: true }>(`/api/labels/${id}`, { method: "DELETE" }),

  print: (
    args:
      | { templateId: string; rentmanSerialNumberId?: string; imageDataUrl: string; label: string }
      | { customText: string; imageDataUrl: string; label: string },
  ) => request<{ ok: boolean; message: string }>("/api/print", { method: "POST", body: JSON.stringify(args) }),

  // Bypasses the server's 60s Rentman cache — use when you need a
  // guaranteed-fresh read right now (e.g. "I just added this in Rentman").
  refresh: () => request<{ ok: boolean }>("/api/refresh", { method: "POST" }),

  // Named app-settings/activity, not settings/logs — those paths are
  // PocketBase's own built-in superuser endpoints (see
  // pocketbase/pb_hooks/routes_app_settings.pb.js and routes_activity.pb.js).
  getSettings: () => request<Settings>("/api/app-settings"),
  updateSettings: (settings: Partial<{ printerHost: string; businessName: string; businessShortName: string }>) =>
    request<Settings>("/api/app-settings", { method: "PUT", body: JSON.stringify(settings) }),

  getStats: () => request<Stats>("/api/stats"),
  getLogs: () => request<LogEntry[]>("/api/activity"),
  logEvent: (type: string, details?: Record<string, unknown>) =>
    request<LogEntry>("/api/activity", { method: "POST", body: JSON.stringify({ type, details }) }),

  listUsers: () => request<UserRecord[]>("/api/users"),
  createUser: (data: { name: string; email: string; password: string; isAdmin?: boolean }) =>
    request<UserRecord>("/api/users", { method: "POST", body: JSON.stringify(data) }),
  updateUser: (id: string, data: Partial<{ name: string; email: string; isAdmin: boolean; password: string }>) =>
    request<UserRecord>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteUser: (id: string) => request<{ ok: true }>(`/api/users/${id}`, { method: "DELETE" }),
  getUserActivity: (id: string) => request<UserActivity>(`/api/users/${id}/activity`),
};

export interface UserActivity {
  stats: { prints: number; logins: number; pageViews: number };
  recent: LogEntry[];
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  verified: boolean;
  created: string;
}

export interface Settings {
  printerHost: string;
  businessName: string;
  businessShortName: string;
}

export interface Stats {
  equipmentTypes: number;
  totalStockUnits: number;
  trackedSerials: number;
  projects: number;
  labelTemplates: number;
  labelsPrinted: number;
  crewAccounts: number;
}

export interface LogEntry {
  id: string;
  type: string;
  who: string | null;
  timestamp: string;
  summary: string;
  details: Record<string, unknown>;
}

// Best-effort helpers for reading Rentman's loosely-typed records — field
// names get tightened once we confirm the real shape against a live token.
export function pick(record: RentmanRecord, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "—";
}

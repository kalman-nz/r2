export function money(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const NZD = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" });

// Always shows the amount, $0.00 included — quotes and totals need it.
export function nzd(n: number | null | undefined): string {
  return NZD.format(n ?? 0);
}

export function num(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

// PocketBase stores datetimes as "2026-10-16 09:30:00.000Z"; Date only
// reliably parses the ISO "T" form.
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d
    ? d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";
}

// The same with the year, for lists that span years ("Tue 3 Mar 2026, 8:00 am").
export function formatDateTimeYear(value: string | null | undefined): string {
  const d = parseDate(value);
  return d
    ? d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "—";
}

export function formatTime(value: string | null | undefined): string {
  const d = parseDate(value);
  return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

// "Tue 3 Mar, 8:00 am → Thu 5 Mar, 12:00 pm"
export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  return `${formatDateTime(start)} → ${formatDateTime(end)}`;
}

// "$85.00/day", "$10.00/hr", "$300.00/week", "$18.50/ea": an item's price
// with what it's per.
export function priceLabel(item: { price: number; priceUnit: string }): string {
  if (!(item.price > 0)) return "";
  return `${nzd(item.price)}${PRICE_SUFFIX[item.priceUnit] ?? "/day"}`;
}

export const PRICE_SUFFIX: Record<string, string> = { hour: "/hr", day: "/day", week: "/week", each: "/ea" };
// The same, for a project line's price mode.
export const MODE_SUFFIX: Record<string, string> = { per_hour: "/hr", per_day: "/day", per_week: "/week", fixed: "" };

// A schedule period: "Fri 16 Oct, 8:00 am – 12:00 pm" on one day, the full
// range across days.
export function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return formatRange(start, end);
  return a.toDateString() === b.toDateString() ? `${formatDateTime(start)} – ${formatTime(end)}` : formatRange(start, end);
}

// "45 min", "4 h", "1 d 4 h"
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return "";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [days && `${days} d`, hours && `${hours} h`, !days && mins && `${mins} min`].filter(Boolean).join(" ");
}

// <input type="datetime-local"> works in the browser's local time with no
// zone ("2026-10-16T09:30"); these convert to/from the UTC PocketBase stores.
export function toLocalInput(value: string | null | undefined): string {
  const d = parseDate(value);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// A Date as <input type="date"> wants it, in the browser's local time.
export function localDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toDateInput(value: string | null | undefined): string {
  return toLocalInput(value).slice(0, 10);
}

export function fromDateInput(value: string): string {
  return value ? fromLocalInput(`${value}T00:00`) : "";
}

// Addresses are stored one line each, as typed or picked from the lookup
// (components/AddressInput.tsx). These tidy them for showing: no blank
// lines, stray spaces or trailing commas.
export function addressLines(address: string | null | undefined): string[] {
  return String(address ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " ").replace(/,+$/, "").trim())
    .filter(Boolean);
}

// On one line, for lists and headers: "12 Main Street, Mount Maunganui 3116".
export function oneLineAddress(address: string | null | undefined): string {
  return addressLines(address).join(", ");
}

// Stacked, as on an envelope (whitespace-pre-line keeps the breaks).
export function stackedAddress(address: string | null | undefined): string {
  return addressLines(address).join("\n");
}

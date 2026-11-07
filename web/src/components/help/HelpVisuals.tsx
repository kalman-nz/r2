// Pictures and pieces of the screen for the Help page (lib/helpContent.ts
// refers to them by id). Built from the app's own styles, so they look like
// the real thing and keep up when the look changes. Not interactive.

import type { ReactNode } from "react";
import Segmented from "../Segmented";
import { Dotted } from "../StatusBadge";

export type VisualId =
  | "sidebar"
  | "search"
  | "dashboard"
  | "filters"
  | "view-menu"
  | "naming"
  | "folders"
  | "item-kind"
  | "item-units"
  | "kit"
  | "availability-timeline"
  | "availability-strip"
  | "label"
  | "schedule"
  | "job-lines"
  | "status-stages"
  | "crew-needs"
  | "tracking-steps"
  | "scan"
  | "tracking-offer"
  | "tracking-board"
  | "plan-repeat"
  | "repair-flow"
  | "roles";

const noop = () => {};

function Menu({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card shadow-lg py-1 text-sm w-60 max-w-full ${className}`}>{children}</div>;
}

function MenuRow({ children, active = false, muted = false }: { children: ReactNode; active?: boolean; muted?: boolean }) {
  return <div className={`px-3 py-1.5 ${active ? "bg-gray-100 text-gray-900 font-medium" : muted ? "text-gray-500" : "text-gray-700"}`}>{children}</div>;
}

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Sidebar() {
  const section = (title: string, items: string[], active?: string) => (
    <div className="flex flex-col gap-0.5 pt-3">
      <div className="px-3 pb-1 eyebrow text-steel/70">{title}</div>
      {items.map((i) => (
        <div
          key={i}
          className={`mx-1.5 px-2 h-8 flex items-center rounded-md text-sm font-medium ${
            i === active ? "bg-graphite text-white shadow-[inset_2px_0_0_var(--color-signal)]" : "text-steel"
          }`}
        >
          {i}
        </div>
      ))}
    </div>
  );
  return (
    <div className="bg-carbon rounded-md py-3 w-52 max-w-full">
      <div className="mx-1.5 px-2 h-8 flex items-center rounded-md text-sm font-medium text-steel">Home</div>
      {section("Planning", ["Projects", "Rostering", "Crew"])}
      {section("Warehouse", ["Inventory", "Equipment tracking", "Maintenance", "Print label"], "Inventory")}
      {section("Relations", ["Contacts", "Locations"])}
      <div className="mt-3 pt-2 border-t border-graphite">
        {["Help", "Settings"].map((i) => (
          <div key={i} className="mx-1.5 px-2 h-8 flex items-center rounded-md text-sm font-medium text-steel">
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}

function Search() {
  return (
    <div className="flex items-center gap-2 bg-white border border-gray-300 rounded-md px-2.5 h-9 w-72 max-w-full">
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="11" cy="11" r="6" />
        <path d="M20 20l-4-4" />
      </svg>
      <span className="text-sm text-gray-400 flex-1 truncate">Search or scan…</span>
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="3.5" />
      </svg>
    </div>
  );
}

function Dashboard() {
  const tile = (label: string, value: string, tone = "text-gray-900") => (
    <div className="card px-3 py-2 flex flex-col min-w-0">
      <span className="eyebrow text-gray-500 truncate">{label}</span>
      <span className={`text-lg font-semibold ${tone}`}>{value}</span>
    </div>
  );
  const row = (n: string, name: string, right: string) => (
    <div className="flex justify-between gap-3 py-1.5 border-t border-gray-100 text-sm min-w-0">
      <span className="truncate text-gray-700">
        <span className="text-gray-400 tabular-nums">#{n}</span> {name}
      </span>
      <span className="text-gray-500 tabular-nums shrink-0">{right}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold text-gray-900">Overview ▾</span>
        <div className="flex gap-2">
          <span className="btn-secondary">Track equipment</span>
          <span className="btn-primary">New project</span>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tile("Going out today", "3")}
        {tile("Due back today", "2")}
        {tile("Overdue back", "1", "text-fault")}
        {tile("Out on hire", "7")}
      </div>
      <div className="card px-3 py-2">
        <div className="eyebrow text-gray-500 pb-1">To prep next</div>
        {row("1042", "Spring Gala Dinner 2026", "71/78 prepped")}
        {row("1045", "Harbour Fun Run", "0/24 prepped")}
      </div>
    </div>
  );
}

function Filters() {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex flex-wrap gap-2">
        <span className="input py-1.5 w-40 text-gray-400">Search projects…</span>
        <span className="input py-1.5">Any client ▾</span>
        <span className="btn-secondary">Filters</span>
        <span className="btn-secondary">Columns</span>
      </div>
      <Menu className="w-64">
        <div className="px-3 pt-1 pb-1 eyebrow text-gray-500">Sort</div>
        <MenuRow>Start · earliest first</MenuRow>
        <MenuRow>Client · A to Z</MenuRow>
        <div className="px-3 pt-2 pb-1 eyebrow text-gray-500">Group</div>
        <MenuRow>Status</MenuRow>
        <MenuRow muted>then by: Client</MenuRow>
      </Menu>
    </div>
  );
}

function ViewMenu() {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-gray-900">
        Hire desk ▾ <span className="text-xs font-normal text-gray-500">edited</span>
      </span>
      <Menu>
        <MenuRow muted>Standard</MenuRow>
        <div className="px-3 pt-2 pb-1 eyebrow text-gray-500">Yours</div>
        <MenuRow active>Hire desk</MenuRow>
        <MenuRow>Overdue</MenuRow>
        <div className="px-3 pt-2 pb-1 eyebrow text-gray-500">Everyone</div>
        <MenuRow>This week's prep</MenuRow>
        <div className="border-t border-gray-100 my-1" />
        <MenuRow>Save changes</MenuRow>
        <MenuRow>Edit view…</MenuRow>
        <MenuRow>New view…</MenuRow>
        <MenuRow>Copy this view…</MenuRow>
        <MenuRow>Share…</MenuRow>
        <MenuRow>Manage views…</MenuRow>
      </Menu>
    </div>
  );
}

function Naming() {
  const part = (text: string, label: string, tone: string) => (
    <span className="flex flex-col items-center gap-1">
      <span className={`px-2 py-1 rounded border-b-2 ${tone} text-base font-semibold text-gray-900`}>{text}</span>
      <span className="eyebrow text-gray-500">{label}</span>
    </span>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-1.5">
        {part("Shure", "Brand", "border-signal")}
        {part("SM58", "Model", "border-data")}
        {part("Vocal Mic", "Human name", "border-lock")}
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        {part("Prolyte", "Brand", "border-signal")}
        {part("H30V", "Model", "border-data")}
        {part("Truss", "Human name", "border-lock")}
        {part("2m", "Specs, last", "border-violet-500")}
      </div>
      <div className="flex flex-col gap-1 w-80 max-w-full">
        <span className="text-xs font-medium text-gray-500">Name</span>
        <span className="input py-2">Prolyte H30V Truss 2m</span>
      </div>
    </div>
  );
}

function Folders() {
  const row = (depth: number, name: string, open = false, active = false) => (
    <div
      className={`flex items-center gap-1.5 py-1 pr-2 rounded text-sm ${active ? "bg-gray-900 text-white" : "text-gray-700"}`}
      style={{ paddingLeft: `${0.5 + depth * 1}rem` }}
    >
      <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>
      {name}
    </div>
  );
  return (
    <div className="card p-2 w-64 max-w-full">
      {row(0, "Audio", true)}
      {row(1, "Microphones", true)}
      {row(2, "Wired")}
      {row(2, "Wireless", false, true)}
      {row(1, "Speakers")}
      {row(1, "Mixing Consoles")}
      {row(0, "Lighting")}
      {row(0, "Video")}
      {row(0, "Cables & Power")}
      {row(0, "Staging & Rigging")}
    </div>
  );
}

function ItemKind() {
  return (
    <div className="flex flex-wrap gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-500">Kind</span>
        <Segmented label="Kind" value="item" onChange={noop} options={[{ value: "item", label: "Physical item" }, { value: "kit", label: "Kit" }]} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-gray-500">Item type</span>
        <Segmented label="Item type" value="serial" onChange={noop} options={[{ value: "bulk", label: "Bulk" }, { value: "serial", label: "Serialised" }]} />
      </div>
    </div>
  );
}

function ItemUnits() {
  const unit = (code: string, serial: string, dot: string, status: string, where: string) => (
    <div className="flex items-center gap-3 py-1.5 border-t border-gray-100 text-sm">
      <span className="font-mono text-xs text-gray-900 w-16 shrink-0">{code}</span>
      <span className="text-gray-500 w-20 shrink-0 truncate">{serial}</span>
      <span className="w-20 shrink-0">
        <Dotted dot={dot}>{status}</Dotted>
      </span>
      <span className="text-gray-500 truncate hidden sm:inline">{where}</span>
    </div>
  );
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full">
      <div className="card px-3 py-2 shrink-0">
        <div className="eyebrow text-gray-500">Item</div>
        <div className="font-semibold text-gray-900">Shure SM58 Vocal Mic</div>
        <div className="text-xs text-gray-500">Serialised · 12 units</div>
      </div>
      <div className="hidden sm:block">
        <Arrow />
      </div>
      <div className="card px-3 py-1 flex-1 min-w-0">
        <div className="eyebrow text-gray-500 py-1">Units</div>
        {unit("4821736", "1A2203", "bg-emerald-500", "Active", "Main warehouse · Bay 3")}
        {unit("4821744", "1A2210", "bg-emerald-500", "Active", "Main warehouse · Bay 3")}
        {unit("4821751", "1A2291", "bg-amber-500", "In repair", "Workshop")}
      </div>
    </div>
  );
}

function Kit() {
  const line = (qty: number, name: string) => (
    <div className="flex gap-3 py-1.5 border-t border-gray-100 text-sm">
      <span className="tabular-nums text-gray-500 w-6 text-right">{qty}×</span>
      <span className="text-gray-700 truncate">{name}</span>
    </div>
  );
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:items-center w-full">
      <div className="card px-3 py-2 shrink-0">
        <div className="eyebrow text-gray-500">Kit</div>
        <div className="font-semibold text-gray-900">Wireless Mic Pack (4ch)</div>
        <div className="text-xs text-gray-500">$240/day · 2 free</div>
      </div>
      <div className="hidden sm:block">
        <Arrow />
      </div>
      <div className="card px-3 py-1 flex-1 min-w-0">
        <div className="eyebrow text-gray-500 py-1">Contents</div>
        {line(1, "Shure ULXD4Q Quad Wireless Receiver")}
        {line(4, "Shure ULXD2 Handheld Wireless Mic")}
        {line(1, "Shure UA874 Active Antenna Pair")}
        {line(8, "AA Rechargeable Battery")}
      </div>
    </div>
  );
}

// Days 1–10 across the box; bars by percentage so it fits any width.
function AvailabilityTimeline() {
  const pct = (day: number) => `${(day / 10) * 100}%`;
  const bar = (from: number, to: number, cls: string, text: string) => (
    <div className={`absolute top-0 h-7 rounded-sm flex items-center px-2 text-xs font-medium overflow-hidden whitespace-nowrap ${cls}`} style={{ left: pct(from), width: pct(to - from) }}>
      {text}
    </div>
  );
  return (
    <div className="w-full flex flex-col gap-2">
      <div className="relative h-7">
        {bar(1, 5, "bg-data text-carbon", "#1042 prep → return")}
        {bar(5, 6.5, "bg-[repeating-linear-gradient(135deg,var(--color-gray-300)_0_6px,var(--color-gray-200)_6px_12px)] text-gray-700", "turnaround")}
      </div>
      <div className="relative h-7">{bar(6, 9, "bg-fault/80 text-white", "#1045 clashes")}</div>
      <div className="relative h-7">{bar(6.5, 9.5, "bg-lock/80 text-carbon", "#1046 fine")}</div>
      <div className="flex justify-between text-[11px] text-gray-400 tabular-nums pt-1 border-t border-gray-200">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function AvailabilityStrip() {
  const free = [8, 8, 6, 6, 5, 5, 8, 8, 3, 3, 3, 0, 0, 8, 8, 8, 7, 7, 8, 8, 4, 4, 4, 8, 8, 8, 8, 8, 8, 6];
  const hovered = 9;
  return (
    <div className="relative w-full pt-24">
      <div className="absolute top-0 card shadow-lg px-3 py-2 text-sm w-60 max-w-full" style={{ left: `max(0px, min(calc(${((hovered + 0.5) / free.length) * 100}% - 7.5rem), calc(100% - 15rem)))` }}>
        <div className="flex justify-between gap-3">
          <span className="font-medium text-gray-900">Fri 13 Nov</span>
          <span className="tabular-nums text-gray-600">3 of 8 free</span>
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1">
          <div className="flex justify-between gap-3">
            <span className="truncate text-gray-700">
              <span className="text-gray-400 tabular-nums">#1042</span> Spring Gala Dinner
            </span>
            <span className="text-gray-500 tabular-nums">5</span>
          </div>
        </div>
      </div>
      <div className="flex items-end gap-px h-12">
        {free.map((f, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end h-full">
            <div
              className={`w-full rounded-sm ${f <= 0 ? "bg-fault/80" : "bg-lock/70"} ${i === hovered ? "ring-1 ring-gray-900/30" : "opacity-60"}`}
              style={{ height: f <= 0 ? "100%" : `${Math.max(6, (f / 8) * 100)}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Label() {
  return (
    <div className="bg-white border border-gray-300 rounded shadow-sm w-72 max-w-full aspect-[62/29] flex items-center gap-3 p-3">
      <svg viewBox="0 0 21 21" className="h-full aspect-square shrink-0" aria-hidden>
        {/* A made-up QR-ish pattern, for the picture only. */}
        {[
          [0, 0], [14, 0], [0, 14],
        ].map(([x, y], i) => (
          <g key={i}>
            <rect x={x} y={y} width="7" height="7" fill="#0e1114" />
            <rect x={x + 1} y={y + 1} width="5" height="5" fill="#fff" />
            <rect x={x + 2} y={y + 2} width="3" height="3" fill="#0e1114" />
          </g>
        ))}
        {[
          [9, 1], [10, 3], [8, 5], [11, 6], [9, 8], [12, 9], [1, 9], [3, 10], [5, 9], [7, 11], [10, 11], [13, 12],
          [15, 9], [17, 10], [19, 8], [16, 12], [18, 13], [9, 14], [11, 15], [14, 16], [16, 15], [19, 17], [9, 18],
          [12, 19], [15, 19], [17, 18], [19, 19], [10, 12], [6, 12], [2, 12],
        ].map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="1.5" height="1.5" fill="#0e1114" />
        ))}
      </svg>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold text-gray-900 leading-tight">Shure SM58 Vocal Mic</span>
        <span className="font-mono text-sm text-gray-900 mt-1">4821736</span>
        <span className="text-[11px] text-gray-500 mt-auto">Test & tag due 03/2027</span>
      </div>
    </div>
  );
}

function Schedule() {
  const pct = (h: number) => `${(h / 100) * 100}%`;
  const row = (label: string, from: number, to: number, cls: string, kind: string) => (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-sm text-gray-700 truncate">{label}</div>
      <div className="relative flex-1 h-5">
        <div className={`absolute top-1 h-3 rounded-sm ${cls}`} style={{ left: pct(from), width: pct(to - from) }} />
      </div>
      <div className="w-24 shrink-0 eyebrow text-gray-500 hidden sm:block">{kind}</div>
    </div>
  );
  return (
    <div className="w-full flex flex-col gap-1.5">
      {row("Prep → return", 0, 100, "bg-data", "Usage")}
      {row("Show days", 35, 70, "bg-signal", "Billing")}
      {row("Pack in", 25, 35, "bg-steel", "Schedule only")}
      {row("Rehearsal", 30, 35, "bg-steel", "Schedule only")}
      {row("Pack out", 70, 78, "bg-steel", "Schedule only")}
      <div className="flex justify-between text-[11px] text-gray-400 pt-1 border-t border-gray-200 sm:mr-[6.75rem] ml-[7.75rem]">
        <span>Wed</span>
        <span>Thu</span>
        <span>Fri</span>
        <span>Sat</span>
        <span>Sun</span>
      </div>
    </div>
  );
}

function JobLines() {
  const head = (t: string) => <div className="eyebrow text-gray-500 pt-2 pb-1">{t}</div>;
  const line = (qty: number, name: string, avail: ReactNode, amount: string) => (
    <div className="flex items-center gap-3 py-1.5 border-t border-gray-100 text-sm">
      <span className="tabular-nums text-gray-900 w-6 text-right shrink-0">{qty}</span>
      <span className="text-gray-700 flex-1 truncate">{name}</span>
      <span className="w-20 shrink-0 text-right">{avail}</span>
      <span className="w-16 shrink-0 text-right tabular-nums text-gray-700 hidden sm:inline">{amount}</span>
    </div>
  );
  return (
    <div className="card px-3 py-1 w-full">
      <div className="flex gap-3 text-xs text-gray-500 pt-1.5">
        <span className="w-6 text-right">Qty</span>
        <span className="flex-1">Item</span>
        <span className="w-20 text-right">Availability</span>
        <span className="w-16 text-right hidden sm:inline">Amount</span>
      </div>
      {head("Audio")}
      {line(8, "d&b Y10P Speaker", <span className="text-gray-500 tabular-nums">12 free</span>, "$1,280")}
      {line(1, "Yamaha CL5 Mixing Console", <span className="text-gray-500 tabular-nums">1 free</span>, "$450")}
      {line(6, "Shure ULXD2 Handheld Wireless Mic", <span className="text-fault font-medium tabular-nums">2 short</span>, "$360")}
      {head("Services")}
      {line(1, "Delivery & collection", <span />, "$180")}
    </div>
  );
}

function StatusStages() {
  const rows: [string, string, string][] = [
    ["Enquiry", "bg-gray-400", "Enquiry"],
    ["Provisional", "bg-amber-500", "Pencilled in"],
    ["Confirmed", "bg-data", "Confirmed"],
    ["Prepped", "bg-teal-500", "Confirmed"],
    ["Out", "bg-violet-500", "Out"],
    ["Returned", "bg-emerald-500", "Done"],
    ["Cancelled", "bg-gray-300", "Cancelled"],
  ];
  return (
    <div className="card px-3 py-1 w-full max-w-md">
      <div className="flex gap-3 text-xs text-gray-500 py-1.5">
        <span className="flex-1">Your status</span>
        <span className="w-4" />
        <span className="flex-1">Stage</span>
      </div>
      {rows.map(([name, dot, stage]) => (
        <div key={name} className="flex items-center gap-3 py-1.5 border-t border-gray-100">
          <span className="flex-1">
            <Dotted dot={dot}>{name}</Dotted>
          </span>
          <Arrow />
          <span className="flex-1 text-sm text-gray-600">{stage}</span>
        </div>
      ))}
    </div>
  );
}

function CrewNeeds() {
  const slot = (name: string | null, note?: string) => (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      {name ? <span className="text-gray-900">{name}</span> : <span className="text-gray-400">Nobody yet</span>}
      {note && <span className="text-xs text-amber-700">{note}</span>}
    </div>
  );
  return (
    <div className="card p-3 w-full max-w-md flex flex-col gap-2">
      <div className="flex justify-between gap-3">
        <span className="font-medium text-gray-900">Pack in</span>
        <span className="text-sm text-gray-500 tabular-nums">Thu 08:00 – 12:00</span>
      </div>
      <div className="border-t border-gray-100 pt-2">
        <div className="text-sm text-gray-700">
          1× Audio operator <span className="text-gray-400">· Advanced or above</span>
        </div>
        <div className="pl-4">{slot("Sam Lee")}</div>
      </div>
      <div className="border-t border-gray-100 pt-2">
        <div className="text-sm text-gray-700">3× Technical labour</div>
        <div className="pl-4">
          {slot("Aroha Wright")}
          {slot("Jordan Fox", "Also on #1045")}
          {slot(null)}
        </div>
      </div>
    </div>
  );
}

const STEPS: [string, string, string][] = [
  ["Prepped", "bg-teal-500", "Getting ready"],
  ["Loaded", "bg-violet-500", "Gone"],
  ["Returned", "bg-emerald-500", "Back"],
];

function TrackingSteps() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map(([name, dot, stage], i) => (
        <div key={name} className="flex items-center gap-2">
          <div className="card px-3 py-2 flex flex-col">
            <Dotted dot={dot}>{name}</Dotted>
            <span className="eyebrow text-gray-500 mt-1">{stage}</span>
          </div>
          {i < STEPS.length - 1 && <Arrow />}
        </div>
      ))}
    </div>
  );
}

function Scan() {
  return (
    <div className="flex flex-col gap-3 w-full max-w-md">
      <div className="text-sm font-semibold text-gray-900">#1042 Spring Gala Dinner 2026</div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-500">Tracking step</span>
        <Segmented label="Tracking step" value="Prepped" onChange={noop} options={STEPS.map(([n]) => ({ value: n, label: n }))} />
      </div>
      <div className="flex gap-2">
        <span className="input py-2 flex-1 text-gray-400">Scan or type a barcode</span>
        <span className="btn-primary flex items-center">Scan</span>
      </div>
      <div className="text-sm text-emerald-700">✓ Shure SM58 Vocal Mic 4821736 → Prepped</div>
    </div>
  );
}

function TrackingOffer() {
  return (
    <div className="card px-4 py-3 w-full max-w-md flex flex-wrap items-center justify-between gap-3 border-l-2 border-l-signal">
      <span className="text-sm text-gray-900">
        Everything's <strong>Loaded</strong>. Set the project to <strong>Out</strong>?
      </span>
      <div className="flex gap-2">
        <span className="btn-secondary">Not now</span>
        <span className="btn-primary">Set to Out</span>
      </div>
    </div>
  );
}

function TrackingBoard() {
  const card = (n: string, name: string, progress: string, done: number) => (
    <div className="card p-2 flex flex-col gap-1.5">
      <span className="text-sm text-gray-900 truncate">
        <span className="text-gray-400 tabular-nums">#{n}</span> {name}
      </span>
      <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-signal" style={{ width: `${done}%` }} />
      </div>
      <span className="text-xs text-gray-500 tabular-nums">{progress}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
      <div className="flex flex-col gap-2 bg-gray-100 rounded-md p-2">
        <Dotted dot="bg-teal-500">Prepped</Dotted>
        {card("1042", "Spring Gala Dinner", "71/78 Prepped", 91)}
        {card("1045", "Harbour Fun Run", "0/24 Prepped", 2)}
      </div>
      <div className="flex flex-col gap-2 bg-gray-100 rounded-md p-2">
        <Dotted dot="bg-violet-500">Loaded</Dotted>
        {card("1039", "Winter Ballet", "40/40 Loaded", 100)}
      </div>
      <div className="flex flex-col gap-2 bg-gray-100 rounded-md p-2">
        <Dotted dot="bg-emerald-500">Returned</Dotted>
        {card("1031", "Tech Conference", "112/120 Returned", 93)}
      </div>
    </div>
  );
}

function PlanRepeat() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const row = (title: string, due: number[], done: number[]) => (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-gray-900">{title}</span>
      <div className="relative h-6 border-b border-gray-200">
        {due.map((m) => (
          <span key={`d${m}`} className="absolute bottom-0 w-px h-5 bg-gray-400" style={{ left: `${(m / 12) * 100}%` }} />
        ))}
        {done.map((m) => (
          <span key={`x${m}`} className="absolute bottom-1 w-2.5 h-2.5 -ml-1 rounded-full bg-signal" style={{ left: `${(m / 12) * 100}%` }} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="w-full flex flex-col gap-3">
      {row("On a set day: every 3 months", [0, 3, 6, 9], [0.5, 4, 6.2, 9.1])}
      {row("After completion: every 3 months", [0, 3.5, 7], [0.5, 4, 7])}
      <div className="flex justify-between text-[11px] text-gray-400">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-px h-3 bg-gray-400" /> due
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-signal" /> done
        </span>
      </div>
    </div>
  );
}

function RepairFlow() {
  const rows: [string, string, string, string][] = [
    ["Backlog", "bg-gray-400", "Out of service", "text-amber-700"],
    ["To repair", "bg-amber-500", "Out of service", "text-amber-700"],
    ["In repair", "bg-data", "Out of service", "text-amber-700"],
    ["Repaired", "bg-emerald-500", "Back in service", "text-emerald-700"],
    ["Unrepairable", "bg-red-500", "Retired", "text-fault-ink"],
  ];
  return (
    <div className="card px-3 py-1 w-full max-w-md">
      <div className="flex gap-3 text-xs text-gray-500 py-1.5">
        <span className="flex-1">Repair status</span>
        <span className="w-4" />
        <span className="flex-1">The kit</span>
      </div>
      {rows.map(([name, dot, kit, tone]) => (
        <div key={name} className="flex items-center gap-3 py-1.5 border-t border-gray-100">
          <span className="flex-1">
            <Dotted dot={dot}>{name}</Dotted>
          </span>
          <Arrow />
          <span className={`flex-1 text-sm ${tone}`}>{kit}</span>
        </div>
      ))}
    </div>
  );
}

function Roles() {
  const perm = (on: boolean, text: string) => (
    <div className="flex items-center gap-2 py-1 text-sm">
      <span className={`w-4 h-4 rounded border flex items-center justify-center text-[11px] ${on ? "bg-carbon border-carbon text-white" : "border-gray-300 bg-white"}`}>{on ? "✓" : ""}</span>
      <span className={on ? "text-gray-900" : "text-gray-500"}>{text}</span>
    </div>
  );
  return (
    <div className="card p-3 w-full max-w-md flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-gray-500">Name</span>
        <span className="input py-1.5">Warehouse</span>
      </div>
      <div>
        <div className="eyebrow text-gray-500 pt-1">Warehouse</div>
        {perm(true, "Track kit going out (prep, load)")}
        {perm(true, "Track kit coming back")}
        <div className="eyebrow text-gray-500 pt-2">Prices and quotes</div>
        {perm(false, "See prices and totals")}
        {perm(false, "Issue quotes")}
      </div>
    </div>
  );
}

const VISUALS: Record<VisualId, () => ReactNode> = {
  sidebar: Sidebar,
  search: Search,
  dashboard: Dashboard,
  filters: Filters,
  "view-menu": ViewMenu,
  naming: Naming,
  folders: Folders,
  "item-kind": ItemKind,
  "item-units": ItemUnits,
  kit: Kit,
  "availability-timeline": AvailabilityTimeline,
  "availability-strip": AvailabilityStrip,
  label: Label,
  schedule: Schedule,
  "job-lines": JobLines,
  "status-stages": StatusStages,
  "crew-needs": CrewNeeds,
  "tracking-steps": TrackingSteps,
  scan: Scan,
  "tracking-offer": TrackingOffer,
  "tracking-board": TrackingBoard,
  "plan-repeat": PlanRepeat,
  "repair-flow": RepairFlow,
  roles: Roles,
};

export default function HelpVisual({ id, caption }: { id: VisualId; caption?: string }) {
  const Visual = VISUALS[id];
  return (
    <figure className="flex flex-col gap-1.5 my-1">
      <div inert className="rounded-md border border-gray-200 bg-gray-50 p-3 md:p-4 overflow-hidden select-none">
        <Visual />
      </div>
      {caption && <figcaption className="text-xs text-gray-500">{caption}</figcaption>}
    </figure>
  );
}

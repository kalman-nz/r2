import type { IntervalUnit, JobStatus, MaintenanceKind, PeriodKind, RepairStage, SerialStatus, StatusColour } from "./api";

export const JOB_STATUSES: { value: JobStatus; label: string; hint: string }[] = [
  { value: "enquiry", label: "Enquiry", hint: "Price check only — holds no stock" },
  { value: "provisional", label: "Provisional", hint: "Pencilled in — holds stock" },
  { value: "confirmed", label: "Confirmed", hint: "Booked — holds stock" },
  { value: "out", label: "Out", hint: "Kit has left the warehouse" },
  { value: "returned", label: "Returned", hint: "Done — stock released" },
  { value: "cancelled", label: "Cancelled", hint: "Stock released" },
];

// What each organisation's own repair statuses can do to the kit
// (Settings → Repair statuses names them; pb_hooks/lib/repairs.js).
export const REPAIR_STAGES: { value: RepairStage; label: string; hint: string }[] = [
  { value: "open", label: "Out of service", hint: "The kit's held out of service while the repair's in this status" },
  { value: "repaired", label: "Repaired", hint: "Ends the repair: the kit goes back in service" },
  { value: "unrepairable", label: "Unrepairable", hint: "Ends the repair: units are retired, bulk stock goes down" },
];

// Badge colours a status can have.
export const STATUS_COLOURS: Record<StatusColour, { label: string; badge: string; dot: string }> = {
  gray: { label: "Grey", badge: "bg-gray-100 text-gray-600", dot: "bg-gray-400" },
  amber: { label: "Amber", badge: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  orange: { label: "Orange", badge: "bg-orange-50 text-orange-700", dot: "bg-orange-500" },
  blue: { label: "Blue", badge: "bg-data-soft text-data-ink", dot: "bg-data" },
  teal: { label: "Teal", badge: "bg-teal-50 text-teal-700", dot: "bg-teal-500" },
  violet: { label: "Violet", badge: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  green: { label: "Green", badge: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  red: { label: "Red", badge: "bg-red-50 text-red-700", dot: "bg-red-500" },
};

// What a project status can mean for its kit: the fixed stages that
// availability, scanning and the Xero export run on
// (pb_hooks/lib/jobStatuses.js). Organisations put their own statuses on
// these. starts: a new project can begin here.
export const JOB_STAGES: { value: JobStatus; label: string; hint: string; starts: boolean }[] = [
  { value: "enquiry", label: "Enquiry", hint: "A price check: holds no kit", starts: true },
  { value: "provisional", label: "Pencilled in", hint: "Holds kit, but shortages say it'd go if released", starts: true },
  { value: "confirmed", label: "Confirmed", hint: "Booked: holds kit", starts: true },
  { value: "out", label: "Out", hint: "The kit's left the warehouse. A project's first scan out moves it to the first status here", starts: false },
  { value: "returned", label: "Done", hint: "Finished: holds nothing, and can be invoiced", starts: false },
  { value: "cancelled", label: "Cancelled", hint: "Holds nothing", starts: false },
];

// Repairs still keeping their kit out of service, as a collection filter.
export const OPEN_REPAIRS_FILTER = "status.stage = 'open'";

// Maintenance work (pb_hooks/lib/maintenance.js). Inspections and tests
// pass or fail; a service is done or finds a problem.
export const MAINTENANCE_KINDS: { value: MaintenanceKind; label: string; hint: string; pass: string; fail: string }[] = [
  { value: "inspection", label: "Inspection", hint: "Checked over, like PPE, rigging or harnesses: passes or fails", pass: "Passed", fail: "Failed" },
  {
    value: "test_tag",
    label: "Test & tag",
    hint: "Electrical safety test (PAT): passes or fails, and keeps each unit's Next test & tag date",
    pass: "Passed",
    fail: "Failed",
  },
  { value: "service", label: "Service", hint: "Routine work, like cleaning, lamp changes or firmware", pass: "Done", fail: "Needs repair" },
];

export const INTERVAL_UNITS: { value: IntervalUnit; label: string }[] = [
  { value: "day", label: "days" },
  { value: "week", label: "weeks" },
  { value: "month", label: "months" },
  { value: "year", label: "years" },
];

export const SERIAL_STATUS_LABELS: Record<SerialStatus, string> = {
  active: "Active",
  repair: "In repair",
  lost: "Lost",
  retired: "Retired",
};

// "Active" is what a warehouse cares about day to day: anything not yet
// finished. These are the views under Projects in the sidebar; the status
// dropdown on the list reaches the rest.
export type ProjectView = "active" | "mine" | "all" | JobStatus;

export const PROJECT_VIEWS: { value: ProjectView; label: string }[] = [
  { value: "active", label: "Active" },
  // The ones you're on the crew for.
  { value: "mine", label: "Mine" },
  { value: "enquiry", label: "Enquiries" },
  { value: "out", label: "Out on hire" },
  { value: "returned", label: "Completed" },
  { value: "all", label: "All projects" },
];

// What a schedule period does. Every project keeps at least one usage and
// one billing period; the rest are plain named times. Must match KINDS in
// pocketbase/pb_hooks/lib/periods.js. bar is the timeline colour.
export const PERIOD_KINDS: { value: PeriodKind; label: string; hint: string; bar: string }[] = [
  { value: "usage", label: "Usage", hint: "Books the equipment: it's unavailable to other projects for this time", bar: "bg-data" },
  { value: "billing", label: "Billing", hint: "Charged: the equipment's days are counted from these, one period at a time", bar: "bg-signal" },
  { value: "other", label: "Schedule only", hint: "Crew calls, pack in, rehearsals. On the plan, but doesn't book or charge", bar: "bg-steel" },
];

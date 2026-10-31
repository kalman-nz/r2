import type { JobInfo, JobStatus } from "./api";
import { COUNT, numberProblem } from "./numbers";
import { fromLocalInput, toLocalInput } from "./format";

// The job form's working copy: dates as datetime-local strings in the
// browser's time zone, converted to/from the UTC PocketBase stores.
export interface JobDraft {
  name: string;
  // The organisation's own status (sent), and its stage (shown; the server
  // works it out from the status).
  jobStatus: string;
  status: JobStatus;
  client: string;
  venue: string;
  // datetime-local strings in the browser's time zone
  prepAt: string;
  returnAt: string;
  // Only used when creating, to seed the first billing period ("" = the
  // same as prep → return).
  billingStart: string;
  billingEnd: string;
  reference: string;
  discountPct: number;
  chargeDays: number;
  quoteNotes: string;
  notes: string;
}

export function draftFromJob(job: JobInfo): JobDraft {
  return {
    name: job.name,
    jobStatus: job.jobStatus,
    status: job.status,
    client: job.client,
    venue: job.venue,
    prepAt: toLocalInput(job.prepAt),
    returnAt: toLocalInput(job.returnAt),
    billingStart: toLocalInput(job.billingStart),
    billingEnd: toLocalInput(job.billingEnd),
    reference: job.reference,
    discountPct: job.discountPct,
    chargeDays: job.chargeDays,
    quoteNotes: job.quoteNotes,
    notes: job.notes,
  };
}

// Tomorrow 8am out, back the day after at noon — a sensible starting
// point that's quicker to adjust than to type from scratch.
export function newJobDraft(): JobDraft {
  const prep = new Date();
  prep.setDate(prep.getDate() + 1);
  prep.setHours(8, 0, 0, 0);
  const ret = new Date(prep);
  ret.setDate(ret.getDate() + 1);
  ret.setHours(12, 0, 0, 0);
  return {
    name: "",
    // "" is the organisation's default status, filled in by the server.
    jobStatus: "",
    status: "" as JobStatus,
    client: "",
    venue: "",
    prepAt: toLocalInput(prep.toISOString()),
    returnAt: toLocalInput(ret.toISOString()),
    billingStart: "",
    billingEnd: "",
    reference: "",
    discountPct: 0,
    chargeDays: 0,
    quoteNotes: "",
    notes: "",
  };
}

// Creating sends the dates, which become the project's first usage and
// billing periods; updating never does (the server refuses: dates come from the
// schedule).
export function draftToUpdate(d: JobDraft) {
  const { prepAt: _p, returnAt: _r, billingStart: _bs, billingEnd: _be, status: _s, ...rest } = d;
  return { ...rest, name: d.name.trim() };
}

export function draftToPayload(d: JobDraft) {
  const { status: _s, ...rest } = d;
  return {
    ...rest,
    name: d.name.trim(),
    prepAt: fromLocalInput(d.prepAt),
    returnAt: fromLocalInput(d.returnAt),
    billingStart: fromLocalInput(d.billingStart),
    billingEnd: fromLocalInput(d.billingEnd),
  };
}

export const DISCOUNT = { min: 0, max: 100 };

// What's wrong with the project's numbers, if anything: Save waits for it.
export function jobFieldsProblem(draft: Pick<JobDraft, "discountPct" | "chargeDays">): string | null {
  const discount = numberProblem(draft.discountPct, DISCOUNT);
  if (discount) return `Project discount: ${discount.toLowerCase()}`;
  const days = numberProblem(draft.chargeDays, COUNT);
  return days ? `Charge for days: ${days.toLowerCase()}` : null;
}

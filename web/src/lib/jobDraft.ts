import type { JobInfo, JobStatus } from "./api";
import { fromLocalInput, toLocalInput } from "./format";

// The job form's working copy: dates as datetime-local strings in the
// browser's time zone, converted to/from the UTC PocketBase stores.
export interface JobDraft {
  name: string;
  status: JobStatus;
  client: string;
  venue: string;
  // datetime-local strings in the browser's time zone
  prepAt: string;
  showStart: string;
  showEnd: string;
  returnAt: string;
  reference: string;
  discountPct: number;
  chargeDays: number;
  quoteNotes: string;
  notes: string;
}

export function draftFromJob(job: JobInfo): JobDraft {
  return {
    name: job.name,
    status: job.status,
    client: job.client,
    venue: job.venue,
    prepAt: toLocalInput(job.prepAt),
    showStart: toLocalInput(job.showStart),
    showEnd: toLocalInput(job.showEnd),
    returnAt: toLocalInput(job.returnAt),
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
    status: "enquiry",
    client: "",
    venue: "",
    prepAt: toLocalInput(prep.toISOString()),
    showStart: "",
    showEnd: "",
    returnAt: toLocalInput(ret.toISOString()),
    reference: "",
    discountPct: 0,
    chargeDays: 0,
    quoteNotes: "",
    notes: "",
  };
}

export function draftToPayload(d: JobDraft) {
  return {
    ...d,
    name: d.name.trim(),
    prepAt: fromLocalInput(d.prepAt),
    showStart: fromLocalInput(d.showStart),
    showEnd: fromLocalInput(d.showEnd),
    returnAt: fromLocalInput(d.returnAt),
  };
}

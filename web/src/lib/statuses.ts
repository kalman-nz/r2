import type { JobStatus, SerialStatus } from "./api";

export const JOB_STATUSES: { value: JobStatus; label: string; hint: string }[] = [
  { value: "enquiry", label: "Enquiry", hint: "Price check only — holds no stock" },
  { value: "provisional", label: "Provisional", hint: "Pencilled in — holds stock" },
  { value: "confirmed", label: "Confirmed", hint: "Booked — holds stock" },
  { value: "out", label: "Out", hint: "Kit has left the warehouse" },
  { value: "returned", label: "Returned", hint: "Done — stock released" },
  { value: "cancelled", label: "Cancelled", hint: "Stock released" },
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
export type ProjectView = "active" | "all" | JobStatus;

export const PROJECT_VIEWS: { value: ProjectView; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "enquiry", label: "Enquiries" },
  { value: "out", label: "Out on hire" },
  { value: "returned", label: "Completed" },
  { value: "all", label: "All projects" },
];

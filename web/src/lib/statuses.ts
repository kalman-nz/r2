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

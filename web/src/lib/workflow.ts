import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { FeatureKey, JobStatus, JobStatusDef } from "./api";
import { orgFilter } from "./currentOrg";

// How an organisation works: the features it uses (Settings → Features,
// pb_hooks/lib/features.js) and its own project statuses on the fixed
// stages (Settings → Project statuses, pb_hooks/lib/jobStatuses.js).

// Must match FEATURES in pb_hooks/lib/features.js.
export const FEATURES: { key: FeatureKey; label: string; hint: string; off: string; needs?: FeatureKey; permissions: string[] }[] = [
  {
    key: "scanning",
    permissions: ["scan.out", "scan.in"],
    label: "Check in & out",
    hint: "Scan kit out to projects and back in, with each project's packing state.",
    off: "Check in & out and the packing state are hidden; kit doesn't have to be scanned to go out.",
  },
  {
    key: "repairs",
    permissions: [],
    label: "Repairs",
    hint: "Repair jobs for broken kit, with statuses, files, costs and who's repairing it.",
    off: "Broken units are just flagged In repair, with no repair jobs to keep up.",
  },
  {
    key: "maintenance",
    permissions: ["maintenance.plans"],
    label: "Maintenance plans",
    hint: "Scheduled and repeating work like PPE inspections, test & tag and services.",
    off: "No scheduled maintenance, plans or inspection records.",
  },
  {
    key: "labels",
    permissions: ["labels.print", "templates.create", "templates.edit", "templates.delete"],
    label: "Labels and printing",
    hint: "Barcode and QR labels, label templates and the label printer.",
    off: "Label printing and templates are hidden.",
  },
  {
    key: "pricing",
    permissions: ["prices.view", "quotes.view", "quotes.issue", "quotes.status", "export.xero"],
    label: "Prices and quotes",
    hint: "Day rates, project totals, quotes and quote PDFs.",
    off: "No prices anywhere, for anyone: for kit that's only used in house.",
  },
  {
    key: "xero",
    permissions: ["export.xero"],
    label: "Xero export",
    hint: "Invoices for Xero from accepted quotes.",
    off: "The Xero export is hidden.",
    needs: "pricing",
  },
];

const NO_STATUSES: JobStatusDef[] = [];

// The organisation's project statuses, in order, with lookups (the same
// objects until the list changes, so they can go in hook deps).
export function useJobStatuses() {
  const { data: statuses = NO_STATUSES, isLoading } = useQuery({
    queryKey: ["job-statuses"],
    queryFn: () => pb.collection("job_statuses").getFullList<JobStatusDef>({ filter: orgFilter(), sort: "sortOrder,created" }),
    staleTime: 60_000,
  });
  return useMemo(() => {
    const byId = new Map(statuses.map((s) => [s.id, s]));
    const starts = statuses.filter((s) => s.stage === "enquiry" || s.stage === "provisional" || s.stage === "confirmed");
    return {
      statuses,
      isLoading,
      byId,
      // Where new projects start.
      defaultId: (starts.find((s) => s.isDefault) ?? starts[0])?.id ?? "",
      // A stage's statuses, in order.
      ofStage: (stage: JobStatus) => statuses.filter((s) => s.stage === stage),
    };
  }, [statuses, isLoading]);
}

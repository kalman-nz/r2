import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { pb } from "./pocketbase";
import type { FeatureKey, JobStatus, JobStatusDef, PresetKey } from "./api";
import { orgFilter } from "./currentOrg";

// How an organisation works: the features it uses (Settings → Features,
// pb_hooks/lib/features.js) and its own project statuses on the fixed
// stages (Settings → Project statuses, pb_hooks/lib/jobStatuses.js).

// Must match FEATURES in pb_hooks/lib/features.js.
export const FEATURES: { key: FeatureKey; label: string; hint: string; off: string; needs?: FeatureKey; permissions: string[] }[] = [
  {
    key: "projects",
    permissions: [
      "jobs.create",
      "jobs.edit",
      "jobs.delete",
      "jobs.lines",
      "calendar.manage",
      "contacts.create",
      "contacts.edit",
      "contacts.delete",
      "venues.create",
      "venues.edit",
      "venues.delete",
    ],
    label: "Projects",
    hint: "Projects with their schedules, equipment and status, availability, and the contacts and locations they're for.",
    off: "R2 is just for looking after your inventory: no projects, contacts or locations, and with them equipment tracking, prices and quotes, and crew.",
  },
  {
    key: "scanning",
    permissions: ["scan.out", "scan.in"],
    needs: "projects",
    label: "Equipment tracking",
    hint: "Scan kit through your steps (prepped, loaded, returned) so every bit of equipment on a project has its own status.",
    off: "Equipment tracking is hidden; kit doesn't have to be scanned to go out.",
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
    needs: "projects",
    label: "Prices and quotes",
    hint: "Day rates, project totals, quotes and quote PDFs.",
    off: "No prices anywhere, for anyone: for kit that's only used in house.",
  },
  {
    key: "crew",
    permissions: ["crew.manage"],
    needs: "projects",
    label: "Crew rostering",
    hint: "Crew needs on schedule items (2× Audio operator for the pack in), a crew list with skills and freelancers, and rostering people onto them.",
    off: "Crew are just added to projects, with no crew needs, crew list or rostering.",
  },
  {
    key: "integrations",
    permissions: ["integrations.manage"],
    label: "Live sync",
    hint: "Keep R2 in step with Rentman, or pull event bookings from Momentus (Settings → Integrations).",
    off: "Rentman and Momentus sync stop, and Settings → Integrations is hidden.",
  },
  {
    key: "xero",
    permissions: ["export.xero"],
    label: "Xero export",
    hint: "Invoices for Xero from accepted quotes.",
    off: "The Xero export is hidden.",
    needs: "pricing",
  },
  {
    key: "ai",
    permissions: [],
    label: "AI features",
    hint: "Find photo on items, using the server's own vision model.",
    off: "Find photo is hidden and the server won't run it.",
  },
];

// Starting points: what's on for a kind of business. Each feature can still
// be changed on its own afterwards. Must match PRESETS in
// pb_hooks/lib/features.js.
export const PRESETS: { key: PresetKey; label: string; hint: string; on: FeatureKey[] }[] = [
  {
    key: "hire",
    label: "Hire and production company",
    hint: "Everything: projects, quotes and invoicing, equipment tracking, crew, repairs and maintenance.",
    on: FEATURES.map((f) => f.key),
  },
  {
    key: "venue",
    label: "Venue with its own shows",
    hint: "Projects for your own shows and events, with equipment tracking, crew, repairs and maintenance. No prices or quotes.",
    on: ["projects", "scanning", "repairs", "maintenance", "labels", "crew", "ai"],
  },
  {
    key: "inventory",
    label: "Inventory and maintenance",
    hint: "Your equipment, asset tags, repairs and maintenance. For a venue that plans its shows somewhere else, like Momentus.",
    on: ["repairs", "maintenance", "labels"],
  },
];

// Every feature on or off as a preset has it, for Settings → Features.
export function presetChanges(key: PresetKey): Record<FeatureKey, boolean> {
  const preset = PRESETS.find((p) => p.key === key)!;
  return Object.fromEntries(FEATURES.map((f) => [f.key, preset.on.includes(f.key)])) as Record<FeatureKey, boolean>;
}

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

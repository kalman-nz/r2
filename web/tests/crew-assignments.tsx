import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import CrewCard from "../src/components/job/CrewCard";
import JobCrew from "../src/components/job/JobCrew";
import { ConfirmProvider } from "../src/components/ConfirmProvider";
import { ToastProvider } from "../src/components/ToastProvider";
import { OrgProvider } from "../src/lib/org";
import { pb } from "../src/lib/pocketbase";
import type { JobSummary } from "../src/lib/api";

const off = new URLSearchParams(location.search).has("off");
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
pb.authStore.save("fixture-token", { id: "user-1", collectionName: "users" });
client.setQueryData(["me", "user-1"], {
  user: { id: "user-1" }, invitations: [],
  memberships: [{ org: { id: "org-1", features: { crew: !off } }, permissions: ["jobs.edit"], role: { id: "role-admin" } }],
});
const summary: JobSummary = {
  job: {
    id: "job-1", org: "org-1", number: 1, name: "Show", status: "confirmed",
    jobStatus: "", client: "", venue: "", spaces: [],
    prepAt: "", returnAt: "", startAt: "", endAt: "", billingStart: "", billingEnd: "",
    chargeDays: 1, discountPct: 0, reference: "", quoteNotes: "", notes: "",
    created: "", updated: "", clientInfo: null, venueInfo: null,
  },
  periods: [{ id: "period-1", subproject: "", kind: "other", name: "Show day", start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "", space: "" }],
  subprojects: [], lines: [], packing: { items: [], packed: false, allBack: false, scanCount: 0 },
  trackingSuggestion: null, includesPrices: false,
};

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <OrgProvider>
        <ToastProvider>
          <ConfirmProvider>
            {off || new URLSearchParams(location.search).has("summary")
              ? <CrewCard summary={summary} canEdit />
              : <JobCrew summary={summary} canEdit />}
          </ConfirmProvider>
        </ToastProvider>
      </OrgProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../src/components/ConfirmProvider";
import JobCrew from "../src/components/job/JobCrew";
import JobSchedule from "../src/components/job/JobSchedule";
import { ToastProvider } from "../src/components/ToastProvider";
import type { JobPeriod, JobSummary } from "../src/lib/api";
import { OrgProvider } from "../src/lib/org";

const periods: JobPeriod[] = [
  { id: "usage-1", subproject: "", kind: "usage", name: "Equipment booked", start: "2026-11-07T08:00:00Z", end: "2026-11-07T10:00:00Z", notes: "", space: "" },
  { id: "billing-1", subproject: "", kind: "billing", name: "Charged", start: "2026-11-07T10:00:00Z", end: "2026-11-07T12:00:00Z", notes: "", space: "" },
  { id: "other-1", subproject: "", kind: "other", name: "Crew call", start: "2026-11-07T12:00:00Z", end: "2026-11-07T14:00:00Z", notes: "", space: "" },
];
const job = {
  id: "job-1", org: "org-1", number: 1, name: "Test project", status: "confirmed", jobStatus: "",
  client: "", venue: "", spaces: [], prepAt: periods[0].start, returnAt: periods[2].end,
  startAt: periods[0].start, endAt: periods[2].end, billingStart: periods[1].start,
  billingEnd: periods[1].end, chargeDays: 1, discountPct: 0, reference: "", quoteNotes: "",
  notes: "", created: "", updated: "", clientInfo: null, venueInfo: null,
};
function summary(items: JobPeriod[]): JobSummary {
  return {
    job, subprojects: [], periods: items, lines: [], packing: { items: [], packed: false, allBack: false, scanCount: 0 },
    trackingSuggestion: null, includesPrices: false,
  };
}

export function Fixture() {
  const query = new URLSearchParams(location.search);
  if (query.has("crew")) return <JobCrew summary={summary(periods)} canEdit />;
  const items = query.has("new-item") ? [periods[2]] : periods;
  return <JobSchedule summary={summary(items)} canEdit />;
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <MemoryRouter>
      <OrgProvider>
        <ToastProvider>
          <ConfirmProvider>
            <Fixture />
          </ConfirmProvider>
        </ToastProvider>
      </OrgProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);

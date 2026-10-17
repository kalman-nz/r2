import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { Item, JobStatus } from "../../lib/api";
import { errorText } from "../../lib/errors";
import { formatDateTime, formatRange, parseDate } from "../../lib/format";
import { JobStatusBadge } from "../StatusBadge";

interface HistoryJob {
  id: string;
  number: number;
  name: string;
  status: JobStatus;
  prepAt: string;
  returnAt: string;
}

interface Entry {
  job: HistoryJob;
  quantity: number;
  lastOut: string;
  lastIn: string;
}

// Every project the item has been on: what it's planned for next, then
// where it's been. One row per project, however many lines it's on.
export function useItemHistory(itemId: string) {
  return useQuery({
    queryKey: ["item-history", itemId, "projects"],
    queryFn: async () => {
      const filter = pb.filter("item = {:item}", { item: itemId });
      const [lines, scans] = await Promise.all([
        pb.collection("job_lines").getFullList<{ job: string; quantity: number; expand?: { job?: HistoryJob } }>({
          filter,
          expand: "job",
          fields: "job,quantity,expand.job.id,expand.job.number,expand.job.name,expand.job.status,expand.job.prepAt,expand.job.returnAt",
        }),
        pb.collection("scans").getFullList<{ job: string; direction: "out" | "in"; created: string }>({
          filter,
          fields: "job,direction,created",
          sort: "created",
        }),
      ]);
      const byJob = new Map<string, Entry>();
      for (const l of lines) {
        const job = l.expand?.job;
        if (!job) continue;
        const entry = byJob.get(job.id) ?? { job, quantity: 0, lastOut: "", lastIn: "" };
        entry.quantity += l.quantity;
        byJob.set(job.id, entry);
      }
      // Sorted oldest first, so the last scan each way wins.
      for (const s of scans) {
        const entry = byJob.get(s.job);
        if (!entry) continue;
        if (s.direction === "out") entry.lastOut = s.created;
        else entry.lastIn = s.created;
      }
      return [...byJob.values()];
    },
    enabled: !!itemId,
  });
}

const time = (value: string) => parseDate(value)?.getTime() ?? 0;

export default function HistorySection({ item }: { item: Item }) {
  const { data, isLoading, error } = useItemHistory(item.id);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !data) return <p className="text-red-600 text-sm">Couldn't load history: {errorText(error)}</p>;

  // Coming up: anything not finished or cancelled that hasn't come back yet.
  const now = Date.now();
  const upcoming = data
    .filter((e) => e.job.status !== "returned" && e.job.status !== "cancelled" && time(e.job.returnAt) >= now)
    .sort((a, b) => time(a.job.prepAt) - time(b.job.prepAt));
  const past = data.filter((e) => !upcoming.includes(e)).sort((a, b) => time(b.job.prepAt) - time(a.job.prepAt));

  return (
    <div className="flex flex-col gap-4">
      <HistoryCard title="Coming up" entries={upcoming} empty="Not planned on any projects." />
      <HistoryCard title="Past" entries={past} empty="Hasn't been on any projects yet." />
    </div>
  );
}

function HistoryCard({ title, entries, empty }: { title: string; entries: Entry[]; empty: string }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <h2 className="eyebrow text-gray-500">
        {title}
        {entries.length > 0 && <span className="ml-1.5 font-mono text-gray-400">{entries.length}</span>}
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 -mx-4">
          {entries.map((e) => (
            <Link key={e.job.id} to={`/projects/${e.job.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-50">
              <span className="flex flex-col min-w-0">
                <span className="text-gray-900 truncate">
                  #{e.job.number} {e.job.name}
                </span>
                <span className="text-xs text-gray-500">{formatRange(e.job.prepAt, e.job.returnAt)}</span>
                {(e.lastOut || e.lastIn) && (
                  <span className="text-xs text-gray-400">
                    {e.lastOut && `Scanned out ${formatDateTime(e.lastOut)}`}
                    {e.lastOut && e.lastIn && " · "}
                    {e.lastIn && `${e.lastOut ? "back" : "Scanned back"} in ${formatDateTime(e.lastIn)}`}
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span className="tabular-nums text-gray-700">× {e.quantity}</span>
                <JobStatusBadge status={e.job.status} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

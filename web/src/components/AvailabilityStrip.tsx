import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatRange, parseDate } from "../lib/format";
import { JobStatusBadge } from "./StatusBadge";

const DAYS = 60;

// One bar per local day for the next DAYS days: the lowest free count at
// any moment that day (the engine's own rule — one clashing hour is a
// clash). Red at zero or below, so overbookings jump out. Underneath, the
// jobs holding the item in that window.
export default function AvailabilityStrip({ itemId }: { itemId: string }) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS);
  const fromIso = from.toISOString();

  const { data, isLoading, error } = useQuery({
    queryKey: ["availability", "timeline", itemId, fromIso],
    queryFn: () => api.itemTimeline(itemId, fromIso, to.toISOString()),
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !data) return <p className="text-red-600 text-sm">Couldn't load availability: {(error as Error)?.message}</p>;

  const segments = data.segments.map((s) => ({
    start: parseDate(s.start)?.getTime() ?? 0,
    end: parseDate(s.end)?.getTime() ?? 0,
    free: s.free,
  }));
  const days: { date: Date; free: number }[] = [];
  for (let i = 0; i < DAYS; i++) {
    const dayStart = new Date(from);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    let min = Infinity;
    for (const s of segments) {
      if (s.start < dayEnd.getTime() && dayStart.getTime() < s.end && s.free < min) min = s.free;
    }
    days.push({ date: dayStart, free: min === Infinity ? 0 : min });
  }
  const scale = Math.max(1, data.stock ?? 0, ...days.map((d) => d.free));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-px h-20" aria-label="Free units per day for the next 60 days">
        {days.map((d) => {
          const short = d.free <= 0;
          const height = short ? 100 : Math.max(6, (d.free / scale) * 100);
          return (
            <div
              key={d.date.toISOString()}
              className="flex-1 flex flex-col justify-end h-full"
              title={`${d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${d.free} free`}
            >
              <div className={`w-full rounded-sm ${short ? "bg-[#fc3465]/80" : "bg-[#16d590]/70"}`} style={{ height: `${height}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-gray-400 -mt-2">
        {days
          .filter((_, i) => i % 14 === 0)
          .map((d) => (
            <span key={d.date.toISOString()}>{d.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
          ))}
      </div>

      {data.bookings.length === 0 ? (
        <p className="text-sm text-gray-500">Not booked on anything in the next {DAYS} days.</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 -mx-4">
          {data.bookings.map((b) => (
            <Link key={b.jobId} to={`/jobs/${b.jobId}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-50">
              <span className="flex flex-col min-w-0">
                <span className="text-gray-900 truncate">
                  #{b.number} {b.name}
                </span>
                <span className="text-xs text-gray-500">{formatRange(b.prepAt, b.returnAt)}</span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {b.quantity !== null && <span className="tabular-nums text-gray-700">× {b.quantity}</span>}
                <JobStatusBadge status={b.status} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { parseDate } from "../lib/format";

const DAYS = 60;

function windowStart() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  return from;
}

// The item's next DAYS days of availability, shared by the strip and the
// item page's summary tiles (one request between them).
export function useItemTimeline(itemId: string) {
  const from = windowStart();
  const to = new Date(from);
  to.setDate(to.getDate() + DAYS);
  const fromIso = from.toISOString();
  return useQuery({
    queryKey: ["availability", "timeline", itemId, fromIso],
    queryFn: () => api.itemTimeline(itemId, fromIso, to.toISOString()),
  });
}

// How many are free at this moment, or null before it's loaded.
export function freeNow(data: ReturnType<typeof useItemTimeline>["data"]): number | null {
  if (!data) return null;
  const now = Date.now();
  const segment = data.segments.find((s) => (parseDate(s.start)?.getTime() ?? 0) <= now && now < (parseDate(s.end)?.getTime() ?? 0));
  return segment ? segment.free : (data.stock ?? 0);
}

// One bar per local day for the next DAYS days: the lowest free count at
// any moment that day (the engine's own rule — one clashing hour is a
// clash). Red at zero or below, so overbookings jump out. The projects
// themselves are on the item's History tab.
export default function AvailabilityStrip({ itemId }: { itemId: string }) {
  const from = windowStart();
  const { data, isLoading, error } = useItemTimeline(itemId);

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
      <div className="flex items-end gap-px h-12" aria-label="Free units per day for the next 60 days">
        {days.map((d) => {
          const short = d.free <= 0;
          const height = short ? 100 : Math.max(6, (d.free / scale) * 100);
          return (
            <div
              key={d.date.toISOString()}
              className="flex-1 flex flex-col justify-end h-full"
              title={`${d.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${d.free} free`}
            >
              <div className={`w-full rounded-sm ${short ? "bg-fault/80" : "bg-lock/70"}`} style={{ height: `${height}%` }} />
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
    </div>
  );
}

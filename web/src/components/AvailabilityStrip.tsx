import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { parseDate } from "../lib/format";

const DAYS = 60;
const CARD_WIDTH = 256;

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
// clash). Red at zero or below, so overbookings jump out. Hovering (or
// tapping) a day shows its free count and the projects booking it.
export default function AvailabilityStrip({ itemId }: { itemId: string }) {
  const from = windowStart();
  const { data, isLoading, error } = useItemTimeline(itemId);
  const [hover, setHover] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

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
  const bookings = data.bookings.map((b) => ({
    ...b,
    start: parseDate(b.prepAt)?.getTime() ?? 0,
    end: parseDate(b.returnAt)?.getTime() ?? 0,
  }));

  const day = hover === null ? null : days[hover];
  const dayBookings = day
    ? bookings.filter((b) => {
        const dayStart = day.date.getTime();
        const dayEnd = new Date(day.date).setDate(day.date.getDate() + 1);
        return b.start < dayEnd && dayStart < b.end;
      })
    : [];
  // Centre the card on the bar, but keep it inside the strip.
  const width = strip.current?.offsetWidth ?? 0;
  const cardWidth = Math.min(CARD_WIDTH, width);
  const left = hover === null ? 0 : Math.min(Math.max(0, ((hover + 0.5) / DAYS) * width - cardWidth / 2), width - cardWidth);

  return (
    <div className="flex flex-col gap-3">
      <div ref={strip} className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex items-end gap-px h-12" aria-label="Free units per day for the next 60 days">
          {days.map((d, i) => {
            const short = d.free <= 0;
            const height = short ? 100 : Math.max(6, (d.free / scale) * 100);
            return (
              <div
                key={d.date.toISOString()}
                className="flex-1 flex flex-col justify-end h-full cursor-default"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(hover === i ? null : i)}
              >
                <div
                  className={`w-full rounded-sm ${short ? "bg-fault/80" : "bg-lock/70"} ${hover === i ? "opacity-100 ring-1 ring-gray-900/30" : hover !== null ? "opacity-60" : ""}`}
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
        {day && (
          // Padding, not margin, under the card, so the mouse can cross the
          // gap from the bars without closing it.
          <div
            className="absolute bottom-full pb-2 z-40 text-sm"
            style={{ left, width: cardWidth }}
          >
          <div className="card shadow-lg px-3 py-2">
            <div className="flex justify-between gap-3">
              <span className="font-medium text-gray-900">
                {day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
              </span>
              <span className={`tabular-nums ${day.free <= 0 ? "text-fault font-medium" : "text-gray-600"}`}>
                {data.stock !== null ? `${day.free} of ${data.stock} free` : `${day.free} free`}
              </span>
            </div>
            {dayBookings.length > 0 && (
              <ul className="mt-1.5 flex flex-col gap-1 border-t border-gray-100 pt-1.5">
                {dayBookings.map((b) => (
                  <li key={b.jobId}>
                    <Link
                      to={`/projects/${b.jobId}`}
                      className="flex justify-between gap-3 min-w-0 -mx-1.5 px-1.5 py-0.5 rounded hover:bg-gray-100"
                    >
                      <span className="truncate text-gray-700">
                        <span className="text-gray-400 tabular-nums">#{b.number}</span> {b.name}
                      </span>
                      {b.quantity !== null && <span className="text-gray-500 tabular-nums shrink-0">{b.quantity}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </div>
        )}
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

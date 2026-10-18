import { useEffect, useMemo, useRef, useState } from "react";
import type { JobPeriod, PeriodKind } from "../../lib/api";
import { formatTime, parseDate } from "../../lib/format";
import Segmented from "../Segmented";

const HOUR_PX = 44;
const MINUTE = 60000;
const SNAP = 15 * MINUTE;
// How many days are on screen, remembered per browser. Fewer means wider
// columns, so names and times on the blocks can be read.
const SPANS = [1, 3, 5, 7] as const;
const SPAN_KEY = "schedule.calendarDays";
function loadSpan(): number {
  try {
    const n = Number(localStorage.getItem(SPAN_KEY));
    return (SPANS as readonly number[]).includes(n) ? n : 3;
  } catch {
    return 3;
  }
}
// Below this a press on a block is a click (open it), not a drag.
const DRAG_PX = 4;

const ms = (value: string) => parseDate(value)?.getTime() ?? NaN;
const snap = (t: number) => Math.round(t / SNAP) * SNAP;

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Calendar days, not 24-hour steps, so a daylight saving change doesn't skew them.
function addDays(t: number, n: number) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

const BLOCK: Record<PeriodKind, { box: string; bar: string }> = {
  usage: { box: "bg-data-soft text-data-ink border-data/40", bar: "bg-data" },
  billing: { box: "bg-signal-soft text-signal-ink border-signal/40", bar: "bg-signal" },
  other: { box: "bg-gray-100 text-gray-800 border-gray-300", bar: "bg-steel" },
};

// Usage and billing periods are thin coloured lines down the left of each
// day (one slot for each, per project part) so the room goes to the named
// times; hovering one says what it is.
const LINE_W = 4;
const LINE_GAP = 2;

type Drag =
  | { mode: "create"; day: number; anchor: number; current: number }
  | { mode: "move" | "resize"; period: JobPeriod; x: number; y: number; dayIndex: number; start: number; end: number; moved: boolean };

// A week of the schedule, hour by hour: every period (the main project's and
// each subproject's) as a block. With editing allowed: drag across empty
// time to make a period, drag a block to move it (across days too), drag its
// bottom edge to change when it ends, click it to edit the rest. Times snap
// to 15 minutes. The caller saves; this only reports what was done.
export default function ScheduleCalendar({
  periods: allPeriods,
  sections,
  sectionName,
  firstDay,
  canEdit,
  onCreate,
  onOpen,
  onChange,
}: {
  periods: JobPeriod[];
  // The project's parts, for the filter: the main project ("") and its subprojects.
  sections: { id: string; name: string }[];
  // "" for the main project, else the subproject's name.
  sectionName: (subproject: string) => string;
  // Where the calendar opens: the project's start.
  firstDay: number;
  canEdit: boolean;
  onCreate: (start: number, end: number) => void;
  onOpen: (period: JobPeriod) => void;
  // Resolves false (or rejects) if it couldn't be saved: the block goes back.
  onChange: (period: JobPeriod, start: number, end: number) => Promise<boolean>;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfDay(Number.isFinite(firstDay) ? firstDay : Date.now()));
  // Parts of the project left off the calendar.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const periods = useMemo(() => allPeriods.filter((p) => !hidden.has(p.subproject || "")), [allPeriods, hidden]);
  const toggle = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as of the last render, for the pointer-up handler: saving
  // happens there, outside any state update (those can run twice).
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // Where a block was dropped, shown until the saved schedule comes back.
  const [pending, setPending] = useState<Record<string, { start: number; end: number }>>({});
  const [DAYS, setDaysState] = useState(loadSpan);
  const setDays = (n: number) => {
    setDaysState(n);
    try {
      localStorage.setItem(SPAN_KEY, String(n));
    } catch {
      // not remembered, that's all
    }
  };
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(weekStart, i)), [weekStart, DAYS]);
  const weekEnd = addDays(weekStart, DAYS);

  // Times as shown: a drag in progress, then anything just dropped.
  const timesOf = (p: JobPeriod) => {
    if (drag && drag.mode !== "create" && drag.period.id === p.id) return { start: drag.start, end: drag.end };
    return pending[p.id] ?? { start: ms(p.start), end: ms(p.end) };
  };

  // Fresh data from the server replaces anything pending.
  useEffect(() => setPending({}), [periods]);

  // Opens scrolled to the first thing on screen this week, or 7am.
  useEffect(() => {
    const starts = periods
      .map((p) => ms(p.start))
      .filter((t) => t >= weekStart && t < weekEnd)
      .map((t) => (t - startOfDay(t)) / 3600000);
    const hour = starts.length > 0 ? Math.max(0, Math.floor(Math.min(...starts)) - 1) : 7;
    scroller.current?.scrollTo({ top: hour * HOUR_PX });
    // Only when the week changes, not on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  // A line slot for each usage and billing period's (part, kind): the main
  // project's first, then each subproject's, the same on every day.
  const lineSlots = useMemo(() => {
    const keys: string[] = [];
    const ordered = [...periods].filter((p) => p.kind !== "other").sort((a, b) => Number(!!a.subproject) - Number(!!b.subproject) || a.kind.localeCompare(b.kind) * -1);
    for (const p of ordered) {
      const key = `${p.subproject || ""}:${p.kind}`;
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }, [periods]);
  const slotOf = (p: JobPeriod) => lineSlots.indexOf(`${p.subproject || ""}:${p.kind}`);
  const lineArea = lineSlots.length > 0 ? lineSlots.length * (LINE_W + LINE_GAP) + 2 : 0;

  // Each day's lines and blocks, the blocks side by side where they overlap.
  const segmentsByDay = useMemo(() => {
    return days.map((dayStart) => {
      const dayEnd = addDays(dayStart, 1);
      const segs = periods
        .map((p) => ({ p, ...timesOf(p) }))
        .filter((s) => s.start < dayEnd && s.end > dayStart && s.start < s.end)
        .map((s) => ({ ...s, top: Math.max(s.start, dayStart), bottom: Math.min(s.end, dayEnd), dayStart, dayEnd }))
        .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
      const lines = segs.filter((x) => x.p.kind !== "other");
      const laneEnds: number[] = [];
      const placed = segs.filter((x) => x.p.kind === "other").map((s) => {
        let lane = laneEnds.findIndex((end) => end <= s.top);
        if (lane === -1) lane = laneEnds.push(0) - 1;
        laneEnds[lane] = s.bottom;
        return { ...s, lane };
      });
      return { lanes: Math.max(1, laneEnds.length), segs: placed, lines };
    });
    // timesOf reads drag and pending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, periods, drag, pending]);

  // The time at a point in a day column.
  function timeAt(dayStart: number, clientY: number, column: HTMLElement) {
    const y = clientY - column.getBoundingClientRect().top;
    return snap(dayStart + (y / HOUR_PX) * 3600000);
  }

  function dayIndexAt(clientX: number) {
    const i = columns.current.findIndex((c) => {
      if (!c) return false;
      const r = c.getBoundingClientRect();
      return clientX >= r.left && clientX < r.right;
    });
    return i;
  }

  // While dragging, follow the pointer anywhere on the page.
  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      setDrag((d) => {
        if (!d) return d;
        if (d.mode === "create") {
          const column = columns.current[days.indexOf(d.day)];
          return column ? { ...d, current: timeAt(d.day, e.clientY, column) } : d;
        }
        const moved = d.moved || Math.abs(e.clientX - d.x) > DRAG_PX || Math.abs(e.clientY - d.y) > DRAG_PX;
        const minutes = snap(((e.clientY - d.y) / HOUR_PX) * 3600000);
        const at = dayIndexAt(e.clientX);
        const dayShift = at === -1 ? 0 : at - d.dayIndex;
        const origStart = ms(d.period.start);
        const origEnd = ms(d.period.end);
        if (d.mode === "move") {
          const start = addDays(origStart, dayShift) + minutes;
          return { ...d, moved, start, end: start + (origEnd - origStart) };
        }
        return { ...d, moved, end: Math.max(origStart + SNAP, addDays(origEnd, dayShift) + minutes) };
      });
    }
    function onUp() {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === "create") {
        const a = Math.min(d.anchor, d.current);
        const b = Math.max(d.anchor, d.current);
        // A click (or a tiny drag) makes an hour.
        onCreate(a, b - a < SNAP ? a + 60 * MINUTE : b);
      } else if (!d.moved) {
        onOpen(d.period);
      } else if (d.start !== ms(d.period.start) || d.end !== ms(d.period.end)) {
        setPending((p) => ({ ...p, [d.period.id]: { start: d.start, end: d.end } }));
        const putBack = () =>
          setPending((p) => {
            const next = { ...p };
            delete next[d.period.id];
            return next;
          });
        onChange(d.period, d.start, d.end).then((ok) => ok || putBack(), putBack);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // The handlers only need the drag's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, days]);

  function startCreate(e: React.PointerEvent<HTMLDivElement>, dayStart: number) {
    if (!canEdit || e.button !== 0 || e.target !== e.currentTarget) return;
    e.preventDefault();
    const t = timeAt(dayStart, e.clientY, e.currentTarget);
    setDrag({ mode: "create", day: dayStart, anchor: t, current: t + SNAP });
  }

  function startBlock(e: React.PointerEvent, period: JobPeriod, mode: "move" | "resize", dayIndex: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!canEdit) {
      onOpen(period);
      return;
    }
    e.preventDefault();
    const { start, end } = timesOf(period);
    setDrag({ mode, period, x: e.clientX, y: e.clientY, dayIndex, start, end, moved: mode === "resize" });
  }

  const today = startOfDay(Date.now());
  const label = (t: number) => {
    const a = new Date(t);
    const b = new Date(addDays(t, DAYS - 1));
    if (DAYS === 1) return a.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const sameMonth = a.getMonth() === b.getMonth();
    return `${a.toLocaleDateString(undefined, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) })} – ${b.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  };

  return (
    <div className="flex flex-col gap-2 select-none">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekStart((w) => addDays(w, -DAYS))} className="btn-secondary py-1 px-2" aria-label={`Previous ${DAYS === 1 ? "day" : `${DAYS} days`}`}>
            ←
          </button>
          <button onClick={() => setWeekStart((w) => addDays(w, DAYS))} className="btn-secondary py-1 px-2" aria-label={`Next ${DAYS === 1 ? "day" : `${DAYS} days`}`}>
            →
          </button>
          <button onClick={() => setWeekStart(startOfDay(firstDay))} className="btn-secondary py-1">
            Project start
          </button>
          <span className="text-sm font-medium text-gray-900 ml-2">{label(weekStart)}</span>
        </div>
        <Segmented
          label="Days shown"
          compact
          value={String(DAYS)}
          onChange={(v) => setDays(Number(v))}
          options={SPANS.map((n) => ({ value: String(n), label: n === 1 ? "1 day" : `${n} days` }))}
        />
        <span className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className={`w-1 h-3 rounded-full ${BLOCK.usage.bar}`} />
            Equipment booked
          </span>
          <span className="flex items-center gap-1">
            <span className={`w-1 h-3 rounded-full ${BLOCK.billing.bar}`} />
            Charged
          </span>
        </span>
      </div>

      {sections.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-gray-500 mr-1">Show</span>
          {sections.map((sec) => {
            const on = !hidden.has(sec.id);
            return (
              <button
                key={sec.id || "main"}
                onClick={() => toggle(sec.id)}
                aria-pressed={on}
                className={`px-2 py-0.5 rounded-full border ${on ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-500 border-gray-300 hover:text-gray-900"}`}
              >
                {sec.name}
              </button>
            );
          })}
          {hidden.size > 0 && (
            <button onClick={() => setHidden(new Set())} className="text-signal-ink hover:text-signal-ink-hover ml-1">
              Show all
            </button>
          )}
        </div>
      )}

      <div className="border border-gray-200 rounded-md overflow-hidden">
        {/* Day headings */}
        <div className="grid border-b border-gray-200 bg-gray-50" style={{ gridTemplateColumns: `3rem repeat(${DAYS}, minmax(0, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div
              key={d}
              className={`px-2 py-1.5 text-xs border-l border-gray-200 ${d === today ? "text-signal-ink font-semibold" : "text-gray-600"}`}
            >
              {new Date(d).toLocaleDateString(undefined, { weekday: "short" })} <span className="font-semibold">{new Date(d).getDate()}</span>{" "}
              {new Date(d).toLocaleDateString(undefined, { month: "short" })}
            </div>
          ))}
        </div>

        <div ref={scroller} className="overflow-y-auto max-h-[36rem]">
          <div className="grid relative" style={{ gridTemplateColumns: `3rem repeat(${DAYS}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
            {/* Hour labels */}
            <div className="relative">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] text-gray-400 tabular-nums" style={{ top: h * HOUR_PX }}>
                  {h === 0 ? "" : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}
                </span>
              ))}
            </div>

            {days.map((dayStart, dayIndex) => {
              const { lanes, segs, lines } = segmentsByDay[dayIndex];
              const creating = drag && drag.mode === "create" && drag.day === dayStart ? drag : null;
              return (
                <div
                  key={dayStart}
                  ref={(el) => {
                    columns.current[dayIndex] = el;
                  }}
                  onPointerDown={(e) => startCreate(e, dayStart)}
                  className={`relative border-l border-gray-200 ${canEdit ? "cursor-crosshair" : ""} ${dayStart === today ? "bg-signal-soft/30" : ""}`}
                  style={{
                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgb(229 231 235) ${HOUR_PX - 1}px, rgb(229 231 235) ${HOUR_PX}px)`,
                  }}
                >
                  {lines.map((s) => {
                    const top = ((s.top - s.dayStart) / 3600000) * HOUR_PX;
                    const height = Math.max(6, ((s.bottom - s.top) / 3600000) * HOUR_PX);
                    const section = s.p.subproject ? sectionName(s.p.subproject) : "";
                    const what = s.p.kind === "usage" ? "Equipment booked" : "Charged";
                    const dragging = drag && drag.mode !== "create" && drag.period.id === s.p.id;
                    return (
                      <div
                        key={s.p.id}
                        onPointerDown={(e) => startBlock(e, s.p, "move", dayIndex)}
                        title={`${what}${section ? ` (${section})` : ""}: ${s.p.name}, ${formatTime(new Date(s.start).toISOString())} – ${formatTime(new Date(s.end).toISOString())}`}
                        className={`absolute rounded-full ${BLOCK[s.p.kind].bar} ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} hover:ring-2 hover:ring-gray-400/50 ${dragging ? "ring-2 ring-signal/50 z-20" : "z-10"}`}
                        style={{ top, height, left: slotOf(s.p) * (LINE_W + LINE_GAP) + 2, width: LINE_W }}
                      >
                        {canEdit && s.end <= s.dayEnd && (
                          <span
                            onPointerDown={(e) => startBlock(e, s.p, "resize", dayIndex)}
                            className="absolute -left-1 -right-1 bottom-0 h-2 cursor-ns-resize"
                            aria-label="Drag to change the end"
                          />
                        )}
                      </div>
                    );
                  })}
                  {segs.map((s) => {
                    const top = ((s.top - s.dayStart) / 3600000) * HOUR_PX;
                    const height = Math.max(14, ((s.bottom - s.top) / 3600000) * HOUR_PX);
                    const width = 100 / lanes;
                    const style = BLOCK[s.p.kind];
                    const section = s.p.subproject ? sectionName(s.p.subproject) : "";
                    const endsHere = s.end <= s.dayEnd;
                    const dragging = drag && drag.mode !== "create" && drag.period.id === s.p.id;
                    return (
                      <div
                        key={s.p.id}
                        onPointerDown={(e) => startBlock(e, s.p, "move", dayIndex)}
                        title={`${section ? `${section} · ` : ""}${s.p.name}: ${formatTime(new Date(s.start).toISOString())} – ${formatTime(new Date(s.end).toISOString())}`}
                        className={`absolute rounded border text-[11px] leading-tight overflow-hidden flex ${style.box} ${canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${dragging ? "shadow-lg ring-2 ring-signal/40 z-20" : "z-10"}`}
                        style={{
                          top,
                          height,
                          left: `calc(${lineArea + 1}px + (100% - ${lineArea}px) * ${s.lane / lanes})`,
                          width: `calc((100% - ${lineArea}px) * ${width / 100} - 3px)`,
                        }}
                      >
                        <span className={`w-1 shrink-0 ${style.bar}`} />
                        <span className="px-1 py-0.5 min-w-0">
                          <span className="block font-semibold truncate">{s.p.name}</span>
                          {section && <span className="block truncate opacity-80">{section}</span>}
                          <span className="block truncate opacity-80 tabular-nums">
                            {formatTime(new Date(s.start).toISOString())} – {formatTime(new Date(s.end).toISOString())}
                          </span>
                        </span>
                        {canEdit && endsHere && (
                          <span
                            onPointerDown={(e) => startBlock(e, s.p, "resize", dayIndex)}
                            className="absolute left-0 right-0 bottom-0 h-1.5 cursor-ns-resize"
                            aria-label="Drag to change the end"
                          />
                        )}
                      </div>
                    );
                  })}
                  {creating && (
                    <div
                      className="absolute left-0.5 right-0.5 rounded border-2 border-dashed border-signal bg-signal-soft/70 text-[11px] text-signal-ink px-1 z-20 pointer-events-none"
                      style={{
                        top: ((Math.min(creating.anchor, creating.current) - dayStart) / 3600000) * HOUR_PX,
                        height: Math.max(8, (Math.abs(creating.current - creating.anchor) / 3600000) * HOUR_PX),
                      }}
                    >
                      {formatTime(new Date(Math.min(creating.anchor, creating.current)).toISOString())} –{" "}
                      {formatTime(new Date(Math.max(creating.anchor, creating.current)).toISOString())}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {canEdit && <p className="text-xs text-gray-400">Drag on empty time to add · drag a block or line to move it · drag its bottom edge to resize · click to edit</p>}
    </div>
  );
}

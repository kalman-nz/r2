import { parseDate, shortDay } from "../lib/format";

// A date on one line in a list table, short enough for a narrow column,
// with the time after it unless dateOnly. The full date goes in the
// column's hover text.
export default function DateCell({ value, alert, dateOnly }: { value: string; alert?: boolean; dateOnly?: boolean }) {
  const d = parseDate(value);
  if (!d) return <span className="text-gray-300">—</span>;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?([AP]M)$/i, (_, m: string) => ` ${m.toLowerCase()}`);
  return (
    <span className={`tabular-nums ${alert ? "text-fault-ink font-medium" : "text-gray-700"}`}>
      {shortDay(d)}
      {!dateOnly && <span className={`ml-1.5 ${alert ? "" : "text-gray-400"}`}>{time}</span>}
    </span>
  );
}

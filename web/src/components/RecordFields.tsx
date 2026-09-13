import type { RentmanRecord } from "../lib/api";

// Renders every field Rentman gave us for a record. Field-name-specific
// layout can replace this once the real shapes are confirmed against a live
// token (see server/src/rentman/client.ts) — for now this guarantees nothing
// is hidden from the UI just because we haven't special-cased it yet.
export default function RecordFields({ record }: { record: RentmanRecord }) {
  const entries = Object.entries(record).filter(([key]) => !key.startsWith("_"));
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-gray-500">{key}</dt>
          <dd className="text-gray-900 break-words">
            {value === null || value === undefined || value === ""
              ? "—"
              : typeof value === "object"
                ? JSON.stringify(value)
                : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

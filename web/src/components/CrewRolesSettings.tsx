import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type CrewNeed } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { levelsOf, useCrewPeople, useCrewRoles } from "../lib/crew";
import { useToast } from "./ToastProvider";
import { DragHandle, moveItem, useDragReorder } from "./DragReorder";

// levels: as typed, "1F, 2F, 4F" (lowest first).
type Row = { id?: string; name: string; levels: string; key: string };

const splitLevels = (text: string) => [...new Set(text.split(",").map((l) => l.trim()).filter(Boolean))];

let nextKey = 0;

// Settings > Crew roles: the jobs crew are booked for ("Audio operator",
// "Technical labour"), in this business's words and order. Schedule items
// need so many of each, and people's skills are these. A role a schedule
// item needs stays until it's taken off there. A role can have levels
// (Driver 1F, 2F, 4F), lowest first, that people and slots are set to.
export default function CrewRolesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { roles, isLoading } = useCrewRoles();
  const { people } = useCrewPeople();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(() => roles.map((r) => ({ id: r.id, name: r.name, levels: levelsOf(r).join(", "), key: r.id })), [roles]);
  useEffect(() => setRows(saved), [saved]);

  const { data: needed = {} } = useQuery({
    queryKey: ["crew-needs", "by-role"],
    queryFn: async () => {
      const counts: Record<string, number> = {};
      for (const n of await pb.collection("crew_needs").getFullList<Pick<CrewNeed, "role">>({ filter: orgFilter(), fields: "role" })) {
        counts[n.role] = (counts[n.role] ?? 0) + 1;
      }
      return counts;
    },
  });
  const skilled = (id: string) => people.filter((p) => !p.archived && p.skills.includes(id)).length;

  const strip = (r: Row[]) => JSON.stringify(r.map(({ id, name, levels }) => ({ id, name, levels: splitLevels(levels) })));
  const dirty = strip(rows) !== strip(saved);
  const set = (key: string, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const drag = useDragReorder({ count: rows.length, onMove: (from, to) => setRows((prev) => moveItem(prev, from, to)), gap: 16 });

  async function save() {
    setSaving(true);
    try {
      await api.saveCrewRoles(rows.map((r) => ({ id: r.id, name: r.name.trim(), levels: splitLevels(r.levels) })));
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["crew-roles"] }), queryClient.invalidateQueries({ queryKey: ["crew-people"] })]);
      showToast("success", "Crew roles saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <h2 className="text-sm font-semibold text-gray-900">Crew roles</h2>

      <div className="card p-4 flex flex-col gap-2 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {!isLoading && rows.length === 0 && <p className="text-gray-500">No crew roles yet.</p>}
        {rows.map((r, i) => {
          const uses = r.id ? (needed[r.id] ?? 0) : 0;
          const people = r.id ? skilled(r.id) : 0;
          return (
            <div key={r.key} {...drag.item(i)} className={`flex items-center gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0 bg-white ${drag.cls(i)}`} style={drag.style}>
              <DragHandle {...drag.handle(i)} />
              <input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Name" className="input py-1.5 flex-1 min-w-32" maxLength={60} />
              <input
                value={r.levels}
                onChange={(e) => set(r.key, { levels: e.target.value })}
                placeholder="Levels"
                title="Lowest first, separated by commas: 1F, 2F, 4F"
                aria-label={`Levels of ${r.name}`}
                className="input py-1.5 w-48"
                maxLength={330}
              />
              <span className="text-xs text-gray-400 w-40 text-right tabular-nums">
                {[people > 0 && `${people} ${people === 1 ? "person" : "people"}`, uses > 0 && `needed ${uses}×`].filter(Boolean).join(" · ")}
              </span>
              <button
                onClick={() => setRows((prev) => prev.filter((x) => x.key !== r.key))}
                disabled={uses > 0}
                title={uses > 0 ? "Schedule items need this role: take it off them first" : `Remove ${r.name}`}
                className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label={`Remove ${r.name}`}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setRows((prev) => [...prev, { name: "", levels: "", key: `new-${++nextKey}` }])}
          disabled={rows.length >= 100}
          className="self-start text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 pt-1"
        >
          + Add role
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!dirty || saving || rows.some((r) => !r.name.trim())} className="btn-primary">
          {saving ? "Saving…" : "Save"}
        </button>
        {dirty && (
          <button onClick={() => setRows(saved)} disabled={saving} className="text-xs text-gray-500 hover:text-gray-900">
            Discard changes
          </button>
        )}
      </div>
    </div>
  );
}

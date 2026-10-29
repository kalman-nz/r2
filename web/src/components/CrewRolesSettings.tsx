import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type CrewNeed } from "../lib/api";
import { orgFilter } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { useCrewPeople, useCrewRoles } from "../lib/crew";
import { useToast } from "./ToastProvider";

type Row = { id?: string; name: string; key: string };

let nextKey = 0;

// Settings > Crew roles: the jobs crew are booked for ("Audio operator",
// "Technical labour"), in this business's words and order. Schedule items
// need so many of each, and people's skills are these. A role a schedule
// item needs stays until it's taken off there.
export default function CrewRolesSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { roles, isLoading } = useCrewRoles();
  const { people } = useCrewPeople();
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(() => roles.map((r) => ({ id: r.id, name: r.name, key: r.id })), [roles]);
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

  const strip = (r: Row[]) => JSON.stringify(r.map(({ id, name }) => ({ id, name })));
  const dirty = strip(rows) !== strip(saved);
  const set = (key: string, name: string) => setRows((prev) => prev.map((r) => (r.key === key ? { ...r, name } : r)));
  const move = (i: number, by: number) =>
    setRows((prev) => {
      const next = [...prev];
      const [row] = next.splice(i, 1);
      next.splice(i + by, 0, row);
      return next;
    });

  async function save() {
    setSaving(true);
    try {
      await api.saveCrewRoles(rows.map((r) => ({ id: r.id, name: r.name.trim() })));
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
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Crew roles</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          What crew are booked to do. Schedule items say how many of each they need, and each person&apos;s skills are the roles they can do, so rostering
          suggests them first.
        </p>
      </div>

      <div className="card p-4 flex flex-col gap-2 text-sm">
        {isLoading && <p className="text-gray-500">Loading…</p>}
        {!isLoading && rows.length === 0 && <p className="text-gray-500">No crew roles yet.</p>}
        {rows.map((r, i) => {
          const uses = r.id ? (needed[r.id] ?? 0) : 0;
          const people = r.id ? skilled(r.id) : 0;
          return (
            <div key={r.key} className="flex items-center gap-2 border-b border-gray-100 pb-2 last:border-0 last:pb-0">
              <span className="flex flex-col">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs" aria-label={`Move ${r.name} up`}>
                  ▲
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="text-gray-400 hover:text-gray-900 disabled:opacity-30 leading-none text-xs"
                  aria-label={`Move ${r.name} down`}
                >
                  ▼
                </button>
              </span>
              <input value={r.name} onChange={(e) => set(r.key, e.target.value)} placeholder="e.g. Audio operator" className="input py-1.5 flex-1 min-w-40" maxLength={60} />
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
        <div className="flex items-center gap-2 pt-2">
          <button onClick={() => setRows((prev) => [...prev, { name: "", key: `new-${++nextKey}` }])} disabled={rows.length >= 100} className="btn-secondary">
            Add role
          </button>
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
    </div>
  );
}

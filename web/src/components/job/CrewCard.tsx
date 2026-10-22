import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import { api, type CrewMember } from "../../lib/api";
import { withOrg } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { useOrg } from "../../lib/org";
import { useAuthRecord } from "../../lib/pocketbase";
import { useToast } from "../ToastProvider";

// Who's working on a project (job_crew), and what they're doing. They see
// it under "My projects" on their dashboards and in the Projects list.
// Planners (jobs.edit) change it; anyone in the organisation can see it.
export default function CrewCard({ jobId, canEdit }: { jobId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { org } = useOrg();
  const me = useAuthRecord();
  const { showToast } = useToast();
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: crew = [] } = useQuery({
    queryKey: ["job-crew", jobId],
    queryFn: () => pb.collection("job_crew").getFullList<CrewMember>({ filter: pb.filter("job = {:job}", { job: jobId }), sort: "sortOrder,created" }),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api.listMembers(org!.id),
    enabled: !!org,
  });
  const nameOf = (userId: string) => {
    const m = members.find((x) => x.userId === userId);
    return m ? m.name || m.email || "Someone" : "Someone";
  };
  const free = members.filter((m) => !crew.some((c) => c.user === m.userId));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["job-crew"] });

  async function add() {
    if (!person) return;
    setBusy(true);
    try {
      await pb.collection("job_crew").create(withOrg({ job: jobId, user: person, function: role.trim(), sortOrder: crew.length * 10 }));
      setPerson("");
      setRole("");
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't add them: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: CrewMember) {
    setBusy(true);
    try {
      await pb.collection("job_crew").delete(c.id);
      await refresh();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <h2 className="text-sm font-semibold text-gray-500">Crew</h2>
      {crew.length === 0 && <p className="text-xs text-gray-500">Nobody's on it yet.</p>}
      {crew.map((c) => (
        <div key={c.id} className="group flex items-center justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-gray-900 truncate">
              {nameOf(c.user)}
              {c.user === me?.id && <span className="text-xs text-gray-400"> (you)</span>}
            </span>
            {c.function && <span className="block text-xs text-gray-500 truncate">{c.function}</span>}
          </span>
          {canEdit && (
            <button
              onClick={() => remove(c)}
              disabled={busy}
              className="w-6 h-6 rounded text-gray-400 hover:text-fault-ink hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100"
              aria-label={`Take ${nameOf(c.user)} off the crew`}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {canEdit && free.length > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-gray-100">
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="input py-1.5">
            <option value="">Add someone…</option>
            {free.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name || m.email}
              </option>
            ))}
          </select>
          {person && (
            <div className="flex items-center gap-1.5">
              <input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
                placeholder="Doing what? e.g. Sound op"
                maxLength={60}
                className="input py-1.5 flex-1 min-w-0"
              />
              <button onClick={add} disabled={busy} className="btn-secondary py-1.5">
                Add
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

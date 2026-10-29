import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { CrewMember, CrewNeed, CrewPerson, CrewRole, JobPeriod } from "../../lib/api";
import { withOrg } from "../../lib/currentOrg";
import { errorText } from "../../lib/errors";
import { formatPeriod, fromLocalInput, toLocalInput } from "../../lib/format";
import { clashesFor, clashLabel, useRosterActions, type Booking } from "../../lib/crew";
import { useAuthRecord } from "../../lib/pocketbase";
import NumberInput from "../NumberInput";
import PersonPicker from "./PersonPicker";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";

// A crew need's slots: who's filling it, and a picker for the rest.
export function NeedSlots({
  need,
  role,
  period,
  crew,
  people,
  peopleById,
  bookings,
  canEdit,
  onEdit,
  heading,
}: {
  need: CrewNeed;
  role?: CrewRole;
  period?: JobPeriod;
  // Everyone on this need.
  crew: CrewMember[];
  people: CrewPerson[];
  peopleById: Map<string, CrewPerson>;
  // Everyone's slots around this time, for double bookings.
  bookings: Booking[];
  canEdit: boolean;
  onEdit?: () => void;
  // Shown before the role (the project and item, on the Rostering page).
  heading?: React.ReactNode;
}) {
  const me = useAuthRecord();
  const { showToast } = useToast();
  const { assign, unassign } = useRosterActions();
  const [busy, setBusy] = useState(false);
  const open = Math.max(0, need.quantity - crew.length);
  const roleName = role?.name ?? "Crew";

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const busyNote = (personId: string) => clashesFor(bookings, personId, need).map(clashLabel).join("; ");
  const ownTimes = need.customTimes || !period;

  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap">
        {heading}
        <span className="text-sm font-medium text-gray-900">
          {need.quantity}× {roleName}
        </span>
        <span className={`text-xs tabular-nums ${open > 0 ? "text-amber-700" : "text-gray-500"}`}>{open > 0 ? `${crew.length} of ${need.quantity} filled` : "Filled"}</span>
        {ownTimes && <span className="text-xs text-gray-500">{formatPeriod(need.start, need.end)}</span>}
        {need.notes && <span className="text-xs text-gray-500">{need.notes}</span>}
        {canEdit && onEdit && (
          <button onClick={onEdit} className="text-xs text-gray-500 hover:text-gray-900 ml-auto">
            Edit
          </button>
        )}
      </div>
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-sm">
        {crew.map((c) => {
          const person = peopleById.get(c.person);
          const clash = busyNote(c.person);
          return (
            <span key={c.id} className="group inline-flex items-center gap-1.5" title={clash ? `Also booked then: ${clash}` : undefined}>
              <span className="text-gray-800">
                {person?.name ?? "Someone"}
                {c.user && c.user === me?.id && <span className="text-xs text-gray-400"> (you)</span>}
              </span>
              {clash && <span className="text-xs text-amber-700">double-booked</span>}
              {canEdit && (
                <button
                  onClick={() => run(() => unassign(c.id))}
                  disabled={busy}
                  className="w-4 h-4 leading-none rounded text-gray-400 hover:text-fault-ink opacity-0 group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Take ${person?.name ?? "them"} off ${roleName}`}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        {crew.length === 0 && !canEdit && <span className="text-xs text-gray-400">Nobody yet</span>}
        {canEdit && open > 0 && (
          <PersonPicker
            people={people}
            roleId={need.role}
            roleName={roleName}
            exclude={new Set(crew.map((c) => c.person))}
            busy={busyNote}
            disabled={busy}
            label={crew.length === 0 ? `+ Pick ${need.quantity === 1 ? "someone" : "people"}` : "+ Add person"}
            onPick={(p) => run(() => assign(need.job, p.id, need.id))}
          />
        )}
      </div>
    </div>
  );
}

interface NeedDraft {
  role: string;
  quantity: number;
  customTimes: boolean;
  start: string; // datetime-local
  end: string;
  notes: string;
}

// Adding or changing what a schedule item needs.
export function NeedForm({
  jobId,
  period,
  need,
  roles,
  onDone,
}: {
  jobId: string;
  period: JobPeriod;
  need?: CrewNeed;
  roles: CrewRole[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<NeedDraft>(() => ({
    role: need?.role ?? roles[0]?.id ?? "",
    quantity: need?.quantity ?? 1,
    customTimes: need?.customTimes ?? false,
    start: toLocalInput(need?.customTimes ? need.start : period.start),
    end: toLocalInput(need?.customTimes ? need.end : period.end),
    notes: need?.notes ?? "",
  }));
  const set = <K extends keyof NeedDraft>(key: K, value: NeedDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crew-needs"] });

  async function save() {
    setSaving(true);
    const body = {
      role: draft.role,
      quantity: draft.quantity,
      customTimes: draft.customTimes,
      start: draft.customTimes ? fromLocalInput(draft.start) : "",
      end: draft.customTimes ? fromLocalInput(draft.end) : "",
      notes: draft.notes.trim(),
    };
    try {
      if (need) await pb.collection("crew_needs").update(need.id, body);
      else await pb.collection("crew_needs").create(withOrg({ ...body, job: jobId, period: period.id }));
      await refresh();
      onDone();
    } catch (err) {
      showToast("error", `Couldn't save it: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!need) return;
    const ok = await confirm({
      title: "Remove crew need",
      message: "Remove this crew need? Anyone rostered on it comes off.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await pb.collection("crew_needs").delete(need.id);
      await Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ["job-crew"] })]);
      onDone();
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setSaving(false);
    }
  }

  if (roles.length === 0) {
    return (
      <p className="text-xs text-gray-500 py-2">
        Add some crew roles first, in Settings → Crew roles.{" "}
        <button onClick={onDone} className="text-signal-ink">
          OK
        </button>
      </p>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-2 py-2"
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <NumberInput value={draft.quantity} onChange={(n) => set("quantity", n)} min={1} max={99} className="input py-1.5 w-16" />
        <span className="text-gray-500 text-sm">×</span>
        <select value={draft.role} onChange={(e) => set("role", e.target.value)} className="input py-1.5 w-auto" aria-label="Crew role" autoFocus>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input value={draft.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Notes, e.g. bring PPE" maxLength={500} className="input py-1.5 flex-1 min-w-40" />
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600">
        <input type="checkbox" checked={draft.customTimes} onChange={(e) => set("customTimes", e.target.checked)} />
        Their own times (otherwise {formatPeriod(period.start, period.end)}, moving with it)
      </label>
      {draft.customTimes && (
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-gray-500">
          <input type="datetime-local" value={draft.start} onChange={(e) => set("start", e.target.value)} required className="input py-1.5 w-auto" aria-label="Start" />
          to
          <input type="datetime-local" value={draft.end} onChange={(e) => set("end", e.target.value)} required className="input py-1.5 w-auto" aria-label="Finish" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || !draft.role} className="btn-primary py-1.5">
          {saving ? "Saving…" : need ? "Save" : "Add crew need"}
        </button>
        <button type="button" onClick={onDone} className="btn-secondary py-1.5">
          Cancel
        </button>
        {need && (
          <button type="button" onClick={remove} disabled={saving} className="text-xs text-gray-500 hover:text-fault-ink ml-auto">
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

// Under a schedule item: what crew it needs and how full each is, with
// adding a need right there. Picking people happens on the Crew tab.
export function PeriodNeeds({
  jobId,
  period,
  needs,
  crew,
  roles,
  canEdit,
  rosterHref,
}: {
  jobId: string;
  period: JobPeriod;
  needs: CrewNeed[];
  crew: CrewMember[];
  roles: CrewRole[];
  canEdit: boolean;
  rosterHref: string;
}) {
  const [adding, setAdding] = useState(false);
  const here = needs.filter((n) => n.period === period.id);
  if (here.length === 0 && !canEdit) return null;
  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? "Crew";
  return (
    <div className="flex flex-col text-xs min-w-0">
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <span className="eyebrow text-gray-400">Crew</span>
        {here.length === 0 && !adding && <span className="text-gray-400">None needed</span>}
        {here.map((n) => {
          const filled = crew.filter((c) => c.need === n.id).length;
          return (
            <span key={n.id} className="text-gray-700">
              {n.quantity}× {roleName(n.role)}{" "}
              <span className={`tabular-nums ${filled < n.quantity ? "text-amber-700" : "text-gray-400"}`}>
                ({filled}/{n.quantity})
              </span>
            </span>
          );
        })}
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="font-medium text-signal-ink hover:text-signal-ink-hover">
            + Crew need
          </button>
        )}
        {here.length > 0 && (
          <Link to={rosterHref} className="font-medium text-signal-ink hover:text-signal-ink-hover">
            {canEdit ? "Roster" : "Who's on it"}
          </Link>
        )}
      </div>
      {adding && <NeedForm jobId={jobId} period={period} roles={roles} onDone={() => setAdding(false)} />}
    </div>
  );
}

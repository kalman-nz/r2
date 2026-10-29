import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { CrewPerson, ViewConfig } from "../lib/api";
import { withOrg } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { formatDateTime, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { asBool, asString, asStrings } from "../lib/views";
import { readSorts, sortRows, sortSettings, type Sort } from "../lib/table";
import { clashLabel, useCrewBookings, useCrewPeople, useCrewRoles, type Booking } from "../lib/crew";
import ColumnsMenu from "../components/ColumnsMenu";
import DataTable, { type TableColumn } from "../components/DataTable";
import Field from "../components/Field";
import FiltersMenu, { FilterCheck, FilterField, SortList } from "../components/FiltersMenu";
import Modal from "../components/Modal";
import PageViews from "../components/PageViews";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";

// The crew list: everyone who can be rostered. Members of the organisation
// are on it already (their name's their account's); freelancers who don't
// log in are added here. Skills are the crew roles someone does, which
// rostering suggests them for. crew.manage adds freelancers and sets skills.

interface Row extends CrewPerson {
  skillNames: string[];
  next?: Booking;
}

interface Column extends TableColumn<Row> {
  toggleable: boolean;
  shown: boolean;
}

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);
const DAY = 24 * 60 * 60 * 1000;

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "Name",
    toggleable: false,
    shown: true,
    width: 220,
    minWidth: 140,
    sortValue: (p) => p.name.toLowerCase(),
    title: (p) => p.name,
    render: (p) => (
      <span className="font-medium text-gray-900">
        {p.name}
        {p.archived && <span className="ml-2 text-xs text-gray-400 font-normal">Archived</span>}
      </span>
    ),
  },
  {
    key: "type",
    label: "Type",
    toggleable: true,
    shown: true,
    width: 110,
    sortValue: (p) => (p.user ? 0 : 1),
    render: (p) => muted(p.user ? "Member" : "Freelancer"),
  },
  {
    key: "skills",
    label: "Skills",
    toggleable: true,
    shown: true,
    width: 300,
    minWidth: 120,
    flex: true,
    sortValue: (p) => p.skillNames.join(", ").toLowerCase() || "￿",
    title: (p) => p.skillNames.join(", "),
    render: (p) => muted(p.skillNames.join(", ")),
  },
  {
    key: "next",
    label: "Next booked",
    toggleable: true,
    shown: true,
    width: 240,
    minWidth: 120,
    sortValue: (p) => (p.next?.expand?.need ? (parseDate(p.next.expand.need.start)?.getTime() ?? Infinity) : Infinity),
    title: (p) => (p.next ? clashLabel(p.next) : ""),
    render: (p) =>
      p.next?.expand?.need ? (
        <span className="text-gray-600">
          <span className="tabular-nums">{formatDateTime(p.next.expand.need.start)}</span>
          <span className="text-gray-400"> · {clashLabel(p.next)}</span>
        </span>
      ) : (
        <span className="text-gray-300">—</span>
      ),
  },
  {
    key: "phone",
    label: "Phone",
    toggleable: true,
    shown: true,
    width: 140,
    sortValue: (p) => p.phone || "￿",
    render: (p) => muted(p.phone),
  },
  {
    key: "email",
    label: "Email",
    toggleable: true,
    shown: false,
    width: 200,
    sortValue: (p) => p.email.toLowerCase() || "￿",
    title: (p) => p.email,
    render: (p) => muted(p.email),
  },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);
const SORTABLE = COLUMNS.filter((c) => c.sortValue);

const DEFAULT_VIEW: ViewConfig = {
  skill: "",
  type: "",
  archived: false,
  columns: COLUMNS.filter((c) => c.toggleable && c.shown).map((c) => c.key),
  widths: {},
  ...sortSettings([{ key: "name", dir: "asc" }]),
};

export default function CrewPage() {
  const { can } = useRole();
  const { roles, byId: roleById } = useCrewRoles();
  const { people, isLoading } = useCrewPeople();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [type, setType] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([{ key: "name", dir: "asc" }]);
  const [editing, setEditing] = useState<CrewPerson | "new" | null>(null);

  // Everyone's slots over the next 60 days, for "Next booked".
  const [range] = useState(() => ({ from: new Date().toISOString(), to: new Date(Date.now() + 60 * DAY).toISOString() }));
  const { data: bookings = [] } = useCrewBookings(range.from, range.to);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const nextOf = new Map<string, Booking>();
    for (const b of bookings) {
      const end = parseDate(b.expand?.need?.end ?? "")?.getTime() ?? 0;
      if (end < now) continue;
      const current = nextOf.get(b.person);
      if (!current || (b.expand?.need?.start ?? "") < (current.expand?.need?.start ?? "")) nextOf.set(b.person, b);
    }
    return people.map((p) => ({
      ...p,
      skillNames: p.skills.map((id) => roleById.get(id)?.name).filter((n): n is string => !!n),
      next: nextOf.get(p.id),
    }));
  }, [people, roleById, bookings]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = rows.filter((p) => {
      if (!showArchived && p.archived) return false;
      if (skill && !p.skills.includes(skill)) return false;
      if (type === "member" && !p.user) return false;
      if (type === "freelancer" && p.user) return false;
      return !term || [p.name, p.phone, p.email, ...p.skillNames].some((v) => v.toLowerCase().includes(term));
    });
    return sortRows(result, COLUMNS, sorts);
  }, [rows, search, showArchived, skill, type, sorts]);

  const settings: ViewConfig = { skill, type, archived: showArchived, columns: shown, widths, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    setSkill(asString(s.skill));
    setType(asString(s.type));
    setShowArchived(asBool(s.archived));
    setShown(asStrings(s.columns, COLUMN_KEYS));
    const sized: Record<string, number> = {};
    if (s.widths && typeof s.widths === "object") for (const [k, v] of Object.entries(s.widths)) if (typeof v === "number" && v > 0) sized[k] = v;
    setWidths(sized);
    setSorts(readSorts(s, SORTABLE.map((c) => c.key), { key: "name", dir: "asc" }));
  }
  const activeFilters = (skill ? 1 : 0) + (type ? 1 : 0) + (showArchived ? 1 : 0);

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Crew</h1>
          <p className="text-xs text-gray-500">
            {isLoading ? "Loading…" : `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "person" : "people"}`} · members of the organisation, and freelancers
          </p>
        </div>
        {can("crew.manage") && (
          <button onClick={() => setEditing("new")} className="btn-primary">
            New freelancer
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page="crew" settings={settings} defaults={DEFAULT_VIEW} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names, skills, phone…" className="input flex-1 min-w-40 max-w-72" />
        <div className="ml-auto flex items-center gap-1.5">
          <FiltersMenu
            active={activeFilters}
            onReset={() => {
              setSkill("");
              setType("");
              setShowArchived(false);
            }}
          >
            <FilterField label="Skill">
              <select value={skill} onChange={(e) => setSkill(e.target.value)} className="input">
                <option value="">Any skill</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Type">
              <select value={type} onChange={(e) => setType(e.target.value)} className="input">
                <option value="">Members and freelancers</option>
                <option value="member">Members</option>
                <option value="freelancer">Freelancers</option>
              </select>
            </FilterField>
            <FilterCheck checked={showArchived} onChange={setShowArchived}>
              Show archived
            </FilterCheck>
            <SortList columns={SORTABLE} sorts={sorts} onChange={setSorts} />
          </FiltersMenu>
          <ColumnsMenu columns={COLUMNS.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      <DataTable
        columns={COLUMNS.filter((c) => !c.toggleable || shown.includes(c.key))}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={(p) => setEditing(p)}
        sorts={sorts}
        onSortsChange={setSorts}
        widths={widths}
        onWidthsChange={setWidths}
        empty={
          !isLoading &&
          filtered.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm text-center">{people.length === 0 ? "Nobody on the crew list yet." : "Nobody matches."}</p>
        }
      />

      {editing && <PersonModal person={editing === "new" ? null : editing} canEdit={can("crew.manage")} onClose={() => setEditing(null)} />}
    </div>
  );
}

// A person on the crew list. Members' names and emails are their
// account's; everything else is the crew list's.
function PersonModal({ person, canEdit, onClose }: { person: CrewPerson | null; canEdit: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { roles } = useCrewRoles();
  const member = !!person?.user;
  const [draft, setDraft] = useState(() => ({
    name: person?.name ?? "",
    phone: person?.phone ?? "",
    email: person?.email ?? "",
    skills: person?.skills ?? [],
    notes: person?.notes ?? "",
    archived: person?.archived ?? false,
  }));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["crew-people"] });

  async function save() {
    setSaving(true);
    try {
      const body = member ? { phone: draft.phone, skills: draft.skills, notes: draft.notes } : draft;
      if (person) await pb.collection("crew_people").update(person.id, body);
      else await pb.collection("crew_people").create(withOrg(body));
      await refresh();
      showToast("success", person ? "Saved" : `${draft.name.trim()} added to the crew list`);
      onClose();
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!person) return;
    const ok = await confirm({
      title: "Delete freelancer",
      message: `Delete ${person.name} from the crew list? Anyone who's been on projects is archived instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("crew_people").delete(person.id);
      await refresh();
      onClose();
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  const toggleSkill = (id: string) => set("skills", draft.skills.includes(id) ? draft.skills.filter((s) => s !== id) : [...draft.skills, id]);

  return (
    <Modal title={person ? person.name : "New freelancer"} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Name" hint={member ? "Their account's name" : undefined} className="sm:col-span-2">
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} disabled={!canEdit || member} maxLength={120} className="input py-2" autoFocus={!person} />
        </Field>
        <Field label="Phone">
          <input value={draft.phone} onChange={(e) => set("phone", e.target.value)} disabled={!canEdit} maxLength={40} className="input py-2" />
        </Field>
        <Field label="Email" hint={member ? "Their account's, in Settings → Team" : undefined}>
          <input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} disabled={!canEdit || member} className="input py-2" />
        </Field>
      </div>
      <Field label="Skills" hint="The crew roles they do: rostering suggests them for these first">
        {roles.length === 0 ? (
          <p className="text-xs text-gray-500">No crew roles yet (Settings → Crew roles).</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-1">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={draft.skills.includes(r.id)} onChange={() => toggleSkill(r.id)} disabled={!canEdit} />
                {r.name}
              </label>
            ))}
          </div>
        )}
      </Field>
      <Field label="Notes">
        <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} disabled={!canEdit} rows={3} maxLength={2000} className="input py-2" />
      </Field>
      {!member && person && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={draft.archived} onChange={(e) => set("archived", e.target.checked)} disabled={!canEdit} />
          Archived: kept on the projects they worked, but not offered for new ones
        </label>
      )}
      {member && person?.archived && <p className="text-xs text-gray-500">They&apos;ve left the organisation, so they can&apos;t be rostered.</p>}
      {canEdit && (
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={saving || !draft.name.trim()} className="btn-primary">
            {saving ? "Saving…" : person ? "Save" : "Add freelancer"}
          </button>
          <button onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          {person && !member && (
            <button onClick={remove} className="text-xs text-gray-500 hover:text-fault-ink ml-auto">
              Delete
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

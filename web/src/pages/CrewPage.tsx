import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { CrewPerson, ViewConfig } from "../lib/api";
import { errorText } from "../lib/errors";
import { formatDateTime, parseDate } from "../lib/format";
import { useRole } from "../lib/roles";
import { asBool, asString, asStrings } from "../lib/views";
import { readGroups, readSorts, readWidths, sortRows, sortSettings, type GroupOption, type Sort } from "../lib/table";
import { updateEach } from "../lib/bulk";
import { clashLabel, skillNames, useCrewBookings, useCrewPeople, useCrewRoles, type Booking } from "../lib/crew";
import ColumnsMenu from "../components/ColumnsMenu";
import DataTable, { type TableColumn } from "../components/DataTable";
import FiltersMenu, { FilterCheck, FilterField, GroupFields, SortList } from "../components/FiltersMenu";
import PageViews from "../components/PageViews";
import SelectionBar from "../components/SelectionBar";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";

// The crew list: everyone who can be rostered, like the contacts list.
// Members of the organisation are on it already (their name's their
// account's); freelancers who don't log in are added here. Skills are the
// crew roles someone does, which rostering suggests them for. Each person
// has a page (CrewPersonPage.tsx); crew.manage adds freelancers and edits.

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
const startOf = (b?: Booking) => parseDate(b?.expand?.need?.start ?? "")?.getTime() ?? Infinity;

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
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium text-gray-900 truncate">{p.name}</span>
        {p.archived && <span className="shrink-0 text-[11px] text-gray-400">{p.user ? "Left" : "Archived"}</span>}
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
    sortValue: (p) => startOf(p.next),
    title: (p) => (p.next ? clashLabel(p.next) : ""),
    render: (p) =>
      p.next?.expand?.need ? (
        <span className="text-gray-600">
          <span className="tabular-nums">{startOf(p.next) <= Date.now() ? "On now" : formatDateTime(p.next.expand.need.start)}</span>
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

const GROUPS: GroupOption<Row>[] = [
  { key: "type", label: "Type", value: (p) => (p.user ? { id: "member", label: "Members", order: 0 } : { id: "freelancer", label: "Freelancers", order: 1 }) },
  {
    key: "booked",
    label: "Booked",
    value: (p) => (p.next ? { id: "booked", label: "Booked in the next 60 days", order: 0 } : { id: "free", label: "Free for the next 60 days", order: 1 }),
  },
];
const GROUP_KEYS = GROUPS.map((g) => g.key);

const DEFAULT_VIEW: ViewConfig = {
  skill: "",
  type: "",
  archived: false,
  columns: COLUMNS.filter((c) => c.toggleable && c.shown).map((c) => c.key),
  widths: {},
  groupBy: [],
  ...sortSettings([{ key: "name", dir: "asc" }]),
};

export default function CrewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { roles, byId: roleById } = useCrewRoles();
  const { people, isLoading } = useCrewPeople();
  const [search, setSearch] = useState("");
  const [skill, setSkill] = useState("");
  const [type, setType] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [shown, setShown] = useState<string[]>(DEFAULT_VIEW.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([{ key: "name", dir: "asc" }]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const canManage = can("crew.manage");

  // Everyone's slots over the next 60 days, for "Next booked".
  const [range] = useState(() => ({ from: new Date().toISOString(), to: new Date(Date.now() + 60 * DAY).toISOString() }));
  const { data: bookings = [] } = useCrewBookings(range.from, range.to);

  const rows = useMemo<Row[]>(() => {
    const now = Date.now();
    const nextOf = new Map<string, Booking>();
    for (const b of bookings) {
      const end = parseDate(b.expand?.need?.end ?? "")?.getTime() ?? 0;
      if (end < now || b.expand?.job?.status === "cancelled") continue;
      const current = nextOf.get(b.person);
      if (!current || (b.expand?.need?.start ?? "") < (current.expand?.need?.start ?? "")) nextOf.set(b.person, b);
    }
    return people.map((p) => ({
      ...p,
      skillNames: skillNames(p, roleById),
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

  const settings: ViewConfig = { skill, type, archived: showArchived, columns: shown, widths, groupBy, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    setSkill(asString(s.skill));
    setType(asString(s.type));
    setShowArchived(asBool(s.archived));
    setShown(asStrings(s.columns, COLUMN_KEYS));
    setWidths(readWidths(s));
    setGroupBy(readGroups(s, GROUP_KEYS));
    setSorts(readSorts(s, SORTABLE.map((c) => c.key), { key: "name", dir: "asc" }));
    setSelected(new Set());
  }
  const activeFilters = (skill ? 1 : 0) + (type ? 1 : 0) + (showArchived ? 1 : 0);
  const searching = search.trim() !== "" || skill !== "" || type !== "";

  // Members are archived by leaving the organisation, so only freelancers
  // are archived, restored or deleted here.
  const selectedRows = filtered.filter((p) => selected.has(p.id));
  const freelancers = selectedRows.filter((p) => !p.user);
  const membersPicked = selectedRows.length - freelancers.length;

  async function archiveSelected(archived: boolean) {
    const targets = freelancers.filter((p) => p.archived !== archived);
    const what = `${targets.length} freelancer${targets.length === 1 ? "" : "s"}`;
    if (targets.length === 0) return;
    if (archived) {
      const ok = await confirm({
        title: `Archive ${what}`,
        message: `Archive ${what}? They stay on the projects they've worked, but aren't offered for new ones. You can restore them any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    setBusy(true);
    const failed = await updateEach("crew_people", targets, () => ({ archived }));
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["crew-people"] });
    if (failed.length === 0) {
      showToast("success", `${archived ? "Archived" : "Restored"} ${what}`);
      setSelected(new Set());
    } else {
      showToast("error", `${failed.length} of ${targets.length} couldn't be ${archived ? "archived" : "restored"}: ${errorText(failed[0].error)}`);
    }
  }

  // The server refuses anyone who's been on a project; they stay selected, to archive instead.
  async function deleteSelected() {
    const targets = freelancers;
    const what = `${targets.length} freelancer${targets.length === 1 ? "" : "s"}`;
    if (targets.length === 0) return;
    const ok = await confirm({
      title: `Delete ${what}`,
      message: `Delete ${what}? This can't be undone. Anyone who's been on a project is skipped: archive them instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const kept = new Set<string>();
    for (const p of targets) {
      try {
        await pb.collection("crew_people").delete(p.id);
      } catch {
        kept.add(p.id);
      }
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: ["crew-people"] });
    setSelected(kept);
    if (kept.size === 0) showToast("success", `Deleted ${what}`);
    else showToast("error", `Deleted ${targets.length - kept.size}. ${kept.size} couldn't be deleted (they've been on projects) and are still selected, so you can archive them.`);
  }

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Crew</h1>
          <p className="text-xs text-gray-500">
            {isLoading ? "Loading…" : `${filtered.length.toLocaleString()} ${searching ? "found" : filtered.length === 1 ? "person" : "people"}`}
          </p>
        </div>
        {canManage && (
          <Link to="/crew/new" className="btn-primary">
            New freelancer
          </Link>
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
              Show archived and people who&apos;ve left
            </FilterCheck>
            <SortList columns={SORTABLE} sorts={sorts} onChange={setSorts} />
            <GroupFields options={GROUPS} groupBy={groupBy} onChange={setGroupBy} />
          </FiltersMenu>
          <ColumnsMenu columns={COLUMNS.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      {selectedRows.length > 0 && (
        <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
          {freelancers.length > 0 &&
            (freelancers.some((p) => !p.archived) ? (
              <button onClick={() => archiveSelected(true)} disabled={busy} className="btn-secondary">
                Archive
              </button>
            ) : (
              <button onClick={() => archiveSelected(false)} disabled={busy} className="btn-secondary">
                Restore
              </button>
            ))}
          {freelancers.length > 0 && (
            <button onClick={deleteSelected} disabled={busy} className="btn-secondary hover:text-fault-ink">
              Delete
            </button>
          )}
          {membersPicked > 0 && (
            <span className="text-xs text-gray-500">
              {membersPicked} member{membersPicked === 1 ? "" : "s"} left as {membersPicked === 1 ? "is" : "they are"}
            </span>
          )}
        </SelectionBar>
      )}

      <DataTable
        columns={COLUMNS.filter((c) => !c.toggleable || shown.includes(c.key))}
        rows={filtered}
        rowKey={(p) => p.id}
        onRowClick={(p, e) => (e.metaKey || e.ctrlKey ? window.open(`/crew/${p.id}`, "_blank") : navigate(`/crew/${p.id}`))}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groupBy.map((k) => GROUPS.find((g) => g.key === k)!).filter(Boolean)}
        widths={widths}
        onWidthsChange={setWidths}
        selected={canManage ? selected : undefined}
        onSelectedChange={setSelected}
        empty={
          !isLoading &&
          filtered.length === 0 && <p className="px-4 py-6 text-gray-500 text-sm text-center">{people.length === 0 ? "Nobody on the crew list yet." : "Nobody matches."}</p>
        }
      />
    </div>
  );
}

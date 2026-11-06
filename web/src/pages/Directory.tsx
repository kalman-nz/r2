import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecordModel } from "pocketbase";
import { pb } from "../lib/pocketbase";
import type { JobStatus, ViewConfig } from "../lib/api";
import { formatDateTimeYear, formatRange, oneLineAddress, parseDate, shortDay, stackedAddress } from "../lib/format";
import { errorText } from "../lib/errors";
import { useRole } from "../lib/roles";
import AddressInput from "../components/AddressInput";
import ColumnsMenu from "../components/ColumnsMenu";
import DataTable, { type TableColumn } from "../components/DataTable";
import DateCell from "../components/DateCell";
import { DetailCard, DetailRow, Fact, FactTiles } from "../components/DetailCard";
import FiltersMenu, { FilterCheck, GroupFields, SortList } from "../components/FiltersMenu";
import Field from "../components/Field";
import PageViews from "../components/PageViews";
import SelectionBar from "../components/SelectionBar";
import { JobStatusBadge } from "../components/StatusBadge";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { updateEach } from "../lib/bulk";
import { orgFilter, withOrg } from "../lib/currentOrg";
import { useFollowOrg } from "../lib/org";
import { readGroups, readSorts, readWidths, sortRows, sortSettings, type GroupOption, type Sort } from "../lib/table";
import { asBool, asStrings } from "../lib/views";
import Breadcrumbs from "../components/Breadcrumbs";
import CustomFieldsCard from "../components/CustomFieldsCard";
import SpacesCard from "../components/SpacesCard";
import { useVenueSpaces } from "../lib/catalog";
import { customKeysIn, customSortValue, customText, customValueOf, useCustomFields, type CustomTarget } from "../lib/customFields";

// Contacts (clients) and locations (venues) are plain records with a list,
// a page each, and the projects that use them, so one config-driven pair of
// pages serves both. They work like Inventory: a full-width list with saved
// views, and a record page whose cards edit in place.

type Draft = Record<string, string>;

interface FieldSpec {
  key: string;
  label: string;
  // address: lookup as you type (components/AddressInput.tsx).
  type?: "text" | "email" | "tel" | "textarea" | "address";
  wide?: boolean;
  placeholder?: string;
}

// A card on the record page: its fields, and which column it goes in.
interface SectionSpec {
  key: string;
  title: string;
  fields: string[];
}

// A list column besides the name, by record field. shown: on to start with.
interface ColumnSpec {
  key: string;
  label: string;
  width: number;
  shown?: boolean;
  format?: (value: string) => string;
}

interface DirectoryConfig {
  collection: "contacts" | "venues";
  // Its custom fields (Settings → Projects → Custom fields).
  customTarget: CustomTarget;
  // Its page for saved views.
  page: "contacts" | "locations";
  title: string;
  singular: string;
  path: string;
  // The project field pointing at this collection, and the other one
  // (shown on its projects: a client's locations, a location's clients).
  jobField: "client" | "venue";
  otherField: "client" | "venue";
  fields: FieldSpec[];
  sections: SectionSpec[];
  columns: ColumnSpec[];
  searchKeys: string[];
}

const CONTACTS: DirectoryConfig = {
  collection: "contacts",
  customTarget: "contact",
  page: "contacts",
  title: "Contacts",
  singular: "contact",
  path: "/contacts",
  jobField: "client",
  otherField: "venue",
  fields: [
    { key: "name", label: "Name", wide: true, placeholder: "Company or person" },
    { key: "contactPerson", label: "Contact person" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "billingAddress", label: "Billing address", type: "address", wide: true },
    { key: "notes", label: "Internal notes", type: "textarea", wide: true },
  ],
  sections: [
    { key: "details", title: "Details", fields: ["name", "contactPerson"] },
    { key: "contact", title: "Contact", fields: ["email", "phone", "billingAddress"] },
    { key: "notes", title: "Notes", fields: ["notes"] },
  ],
  columns: [
    { key: "contactPerson", label: "Contact", width: 170 },
    { key: "email", label: "Email", width: 220 },
    { key: "phone", label: "Phone", width: 140 },
    { key: "billingAddress", label: "Billing address", width: 240, shown: false, format: oneLineAddress },
  ],
  searchKeys: ["name", "contactPerson", "email", "phone", "billingAddress"],
};

const VENUES: DirectoryConfig = {
  collection: "venues",
  customTarget: "venue",
  page: "locations",
  title: "Locations",
  singular: "location",
  path: "/locations",
  jobField: "venue",
  otherField: "client",
  fields: [
    { key: "name", label: "Name", wide: true },
    { key: "address", label: "Address", type: "address", wide: true },
    { key: "contactName", label: "On-site contact" },
    { key: "phone", label: "Phone", type: "tel" },
    { key: "notes", label: "Internal notes", type: "textarea", wide: true },
  ],
  sections: [
    { key: "details", title: "Details", fields: ["name", "address"] },
    { key: "onsite", title: "On site", fields: ["contactName", "phone"] },
    { key: "notes", title: "Notes", fields: ["notes"] },
  ],
  columns: [
    { key: "address", label: "Address", width: 280, format: oneLineAddress },
    { key: "contactName", label: "Contact", width: 170 },
    { key: "phone", label: "Phone", width: 140, shown: false },
    { key: "notes", label: "Notes", width: 220, shown: false, format: (v) => v.split("\n")[0] },
  ],
  searchKeys: ["name", "address", "contactName", "phone"],
};

// Projects as the lists and pages here need them.
interface JobRef {
  id: string;
  number: number;
  name: string;
  status: JobStatus;
  jobStatus: string;
  client: string;
  venue: string;
  spaces?: string[];
  startAt: string;
  endAt: string;
  expand?: { client?: { name: string }; venue?: { name: string }; spaces?: { name: string }[] };
}

const DONE: JobStatus[] = ["returned", "cancelled"];
const time = (value: string) => parseDate(value)?.getTime() ?? 0;

// Still to come or on now: not finished or cancelled, and not over.
const upcoming = (j: JobRef, now: number) => !DONE.includes(j.status) && time(j.endAt || j.startAt) >= now;

// What a record's projects come to: how many, the next one, the last one.
function projectFacts(jobs: JobRef[], now: number) {
  const coming = jobs.filter((j) => upcoming(j, now)).sort((a, b) => time(a.startAt) - time(b.startAt));
  const past = jobs.filter((j) => !coming.includes(j)).sort((a, b) => time(b.startAt) - time(a.startAt));
  const last = past.find((j) => j.status !== "cancelled");
  return { count: jobs.length, coming, past, next: coming[0], last };
}

interface Row extends RecordModel {
  // A location's spaces, in order.
  spaceNames: string;
  projects: number;
  next?: JobRef;
  last?: JobRef;
}

// When the next project is: "On now" once it's started.
const started = (j: JobRef) => time(j.startAt) <= Date.now();
const nextDay = (j: JobRef) => (started(j) ? "On now" : shortDay(parseDate(j.startAt) ?? new Date()));

const muted = (value: string) => (value ? <span className="text-gray-600">{value}</span> : <span className="text-gray-300">—</span>);
const jobTitle = (j?: JobRef) => (j ? `#${j.number} ${j.name}` : "");

// Every project's client and location, for the lists' project columns.
function useJobRefs() {
  return useQuery({
    queryKey: ["jobs", "refs"],
    queryFn: () =>
      pb.collection("jobs").getFullList<JobRef>({ filter: orgFilter(), fields: "id,number,name,status,jobStatus,client,venue,startAt,endAt", sort: "startAt" }),
  });
}

function DirectoryList({ config }: { config: DirectoryConfig }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const plural = config.title.toLowerCase();
  const { fields: customFields } = useCustomFields(config.customTarget);

  const columns = useMemo<(TableColumn<Row> & { toggleable: boolean; shown: boolean })[]>(
    () => [
      {
        key: "name",
        label: "Name",
        toggleable: false,
        shown: true,
        width: 240,
        minWidth: 140,
        flex: true,
        sortValue: (r) => String(r.name ?? "").toLowerCase(),
        title: (r) => String(r.name ?? ""),
        render: (r) => (
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium text-gray-900 truncate">{String(r.name || "(no name)")}</span>
            {r.archived && <span className="shrink-0 text-[11px] text-gray-400">Archived</span>}
          </span>
        ),
      },
      ...config.columns.map((c) => {
        const text = (r: Row) => {
          const raw = String(r[c.key] ?? "");
          return c.format ? c.format(raw) : raw.split("\n")[0];
        };
        return {
          key: c.key,
          label: c.label,
          toggleable: true,
          shown: c.shown !== false,
          width: c.width,
          minWidth: 80,
          sortValue: (r: Row) => text(r).toLowerCase() || "￿",
          title: text,
          render: (r: Row) => muted(text(r)),
        };
      }),
      ...(config.collection === "venues"
        ? [
            {
              key: "spaces",
              label: "Spaces",
              toggleable: true,
              shown: true,
              width: 220,
              minWidth: 100,
              sortValue: (r: Row) => r.spaceNames.toLowerCase() || "￿",
              title: (r: Row) => r.spaceNames,
              render: (r: Row) => muted(r.spaceNames),
            },
          ]
        : []),
      {
        key: "projects",
        label: "Projects",
        align: "right" as const,
        toggleable: true,
        shown: true,
        width: 96,
        sortValue: (r) => r.projects,
        render: (r) => (r.projects ? <span className="text-gray-700 tabular-nums">{r.projects}</span> : muted("")),
      },
      {
        key: "next",
        label: "Next project",
        toggleable: true,
        shown: true,
        width: 140,
        minWidth: 110,
        sortValue: (r) => (r.next ? time(r.next.startAt) : Number.MAX_SAFE_INTEGER),
        title: (r) => (r.next ? `${jobTitle(r.next)}, ${formatDateTimeYear(r.next.startAt)}` : ""),
        render: (r) => (!r.next ? muted("") : started(r.next) ? <span className="text-gray-700">On now</span> : <DateCell value={r.next.startAt} dateOnly />),
      },
      {
        key: "last",
        label: "Last project",
        toggleable: true,
        shown: false,
        width: 140,
        minWidth: 110,
        sortValue: (r) => (r.last ? -time(r.last.startAt) : Number.MAX_SAFE_INTEGER),
        title: (r) => (r.last ? `${jobTitle(r.last)}, ${formatDateTimeYear(r.last.startAt)}` : ""),
        render: (r) => (r.last ? <DateCell value={r.last.startAt} dateOnly /> : muted("")),
      },
      // Custom fields, off to start with.
      ...customFields.map((f) => ({
        key: `custom:${f.key}`,
        label: f.label,
        toggleable: true,
        shown: false,
        width: 150,
        minWidth: 90,
        sortValue: (r: Row) => customSortValue(f, customValueOf(r, f)),
        title: (r: Row) => customText(f, customValueOf(r, f)),
        render: (r: Row) => muted(customText(f, customValueOf(r, f))),
      })),
    ],
    [config, customFields],
  );
  const columnKeys = columns.map((c) => c.key);
  const sortable = columns.filter((c) => c.sortValue);

  const groups = useMemo<GroupOption<Row>[]>(
    () => [
      {
        key: "activity",
        label: "Projects",
        value: (r: Row) =>
          r.next
            ? { id: "coming", label: "Project coming up", order: 0 }
            : r.projects > 0
              ? { id: "past", label: "Nothing coming up", order: 1 }
              : { id: "none", label: "No projects", order: 2 },
      },
      ...customFields
        .filter((f) => f.type === "select" || f.type === "boolean")
        .map((f) => ({
          key: `custom:${f.key}`,
          label: f.label,
          value: (r: Row) => {
            const label = customText(f, customValueOf(r, f));
            const order = f.type === "select" ? (f.options ?? []).indexOf(label) : label === "Yes" ? 0 : 1;
            return label ? { id: label, label, order: order === -1 ? 999 : order } : { id: "", label: `No ${f.label.toLowerCase()}`, order: 1000 };
          },
        })),
    ],
    [customFields],
  );
  const groupKeys = groups.map((g) => g.key);

  const defaults = useMemo<ViewConfig>(
    () => ({
      archived: false,
      columns: columns.filter((c) => c.toggleable && c.shown).map((c) => c.key),
      widths: {},
      groupBy: [],
      ...sortSettings([{ key: "name", dir: "asc" }]),
    }),
    [columns],
  );
  const [shown, setShown] = useState<string[]>(defaults.columns as string[]);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sorts, setSorts] = useState<Sort[]>([{ key: "name", dir: "asc" }]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const settings: ViewConfig = { archived: showArchived, columns: shown, widths, groupBy, ...sortSettings(sorts) };
  function applySettings(s: ViewConfig) {
    setShowArchived(asBool(s.archived));
    const custom = customKeysIn(s);
    setShown(asStrings(s.columns, [...columnKeys, ...custom]));
    setWidths(readWidths(s));
    setGroupBy(readGroups(s, [...groupKeys, ...custom]));
    setSorts(readSorts(s, [...sortable.map((c) => c.key), ...custom], { key: "name", dir: "asc" }));
    setSelected(new Set());
  }

  const { data: records = [], isLoading, error } = useQuery({
    queryKey: [config.collection],
    queryFn: () => pb.collection(config.collection).getFullList<RecordModel>({ filter: orgFilter(), sort: "name" }),
  });
  const { data: jobs = [] } = useJobRefs();
  const { data: spaces = [] } = useVenueSpaces();

  const rows = useMemo<Row[]>(() => {
    const byRecord = new Map<string, JobRef[]>();
    for (const j of jobs) {
      const id = j[config.jobField];
      if (id) byRecord.set(id, [...(byRecord.get(id) ?? []), j]);
    }
    const now = Date.now();
    return records.map((r) => {
      const facts = projectFacts(byRecord.get(r.id) ?? [], now);
      const spaceNames = config.collection === "venues" ? spaces.filter((s) => s.venue === r.id).map((s) => s.name).join(", ") : "";
      return { ...r, spaceNames, projects: facts.count, next: facts.next, last: facts.last };
    });
  }, [records, jobs, spaces, config.jobField, config.collection]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (!showArchived && r.archived) return false;
      return (
        !term ||
        config.searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(term)) ||
        r.spaceNames.toLowerCase().includes(term) ||
        customFields.some((f) => customText(f, customValueOf(r, f)).toLowerCase().includes(term))
      );
    });
    return sortRows(out, columns, sorts);
  }, [rows, search, showArchived, config.searchKeys, columns, sorts, customFields]);

  const selectedRows = filtered.filter((r) => selected.has(r.id));
  const searching = search.trim() !== "";
  const activeFilters = showArchived ? 1 : 0;

  // Archiving or restoring the selection. Those already that way are left alone.
  async function archiveSelected(archived: boolean) {
    const targets = selectedRows.filter((r) => !!r.archived !== archived);
    const what = `${targets.length} ${targets.length === 1 ? config.singular : plural}`;
    if (archived) {
      const ok = await confirm({
        title: `Archive ${what}`,
        message: `Archive ${what}? They're hidden from lists and can't be picked for new projects. Projects they're already on keep them, and you can restore them any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    setBusy(true);
    const failed = await updateEach(config.collection, targets, () => ({ archived }));
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: [config.collection] });
    if (failed.length === 0) {
      showToast("success", `${archived ? "Archived" : "Restored"} ${what}`);
      setSelected(new Set());
    } else {
      showToast("error", `${failed.length} of ${targets.length} couldn't be ${archived ? "archived" : "restored"}: ${errorText(failed[0].error)}`);
    }
  }

  // The server refuses any that are on a project; those stay selected, to archive instead.
  async function deleteSelected() {
    const targets = selectedRows;
    const what = `${targets.length} ${targets.length === 1 ? config.singular : plural}`;
    const ok = await confirm({
      title: `Delete ${what}`,
      message: `Delete ${what}? This can't be undone. Any that are on a project are skipped: archive those instead.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    const kept = new Set<string>();
    for (const r of targets) {
      try {
        await pb.collection(config.collection).delete(r.id);
      } catch {
        kept.add(r.id);
      }
    }
    setBusy(false);
    await queryClient.invalidateQueries({ queryKey: [config.collection] });
    setSelected(kept);
    if (kept.size === 0) showToast("success", `Deleted ${what}`);
    else showToast("error", `Deleted ${targets.length - kept.size}. ${kept.size} couldn't be deleted (they're on projects) and are still selected, so you can archive them.`);
  }

  const canBulk = can(`${config.collection}.edit`) || can(`${config.collection}.delete`);

  return (
    <div className="w-full h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-3 flex-wrap shrink-0">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-gray-900">{config.title}</h1>
          <p className="text-xs text-gray-500">
            {isLoading
              ? "Loading…"
              : `${filtered.length.toLocaleString()} ${searching ? "found" : filtered.length === 1 ? config.singular : plural}`}
          </p>
        </div>
        {can(`${config.collection}.create`) && (
          <Link to={`${config.path}/new`} className="btn-primary">
            New {config.singular}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <PageViews page={config.page} settings={settings} defaults={defaults} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${plural}…`} className="input flex-1 min-w-40 max-w-72" />
        <div className="ml-auto flex items-center gap-1.5">
          <FiltersMenu
            active={activeFilters}
            onReset={() => setShowArchived(false)}
          >
            <FilterCheck checked={showArchived} onChange={setShowArchived}>
              Show archived {plural}
            </FilterCheck>
            <SortList columns={sortable} sorts={sorts} onChange={setSorts} />
            <GroupFields options={groups} groupBy={groupBy} onChange={setGroupBy} />
          </FiltersMenu>
          <ColumnsMenu columns={columns.filter((c) => c.toggleable)} visible={shown} onChange={setShown} />
        </div>
      </div>

      {error && <p className="text-red-600 text-sm shrink-0">Couldn&apos;t load {plural}: {errorText(error)}</p>}

      {selectedRows.length > 0 && (
        <SelectionBar count={selectedRows.length} onClear={() => setSelected(new Set())}>
          {can(`${config.collection}.edit`) &&
            (selectedRows.some((r) => !r.archived) ? (
              <button onClick={() => archiveSelected(true)} disabled={busy} className="btn-secondary">
                Archive
              </button>
            ) : (
              <button onClick={() => archiveSelected(false)} disabled={busy} className="btn-secondary">
                Restore
              </button>
            ))}
          {can(`${config.collection}.delete`) && (
            <button onClick={deleteSelected} disabled={busy} className="btn-secondary hover:text-fault-ink">
              Delete
            </button>
          )}
        </SelectionBar>
      )}

      <DataTable
        columns={columns.filter((c) => !c.toggleable || shown.includes(c.key))}
        rows={filtered}
        rowKey={(r) => r.id}
        onRowClick={(r, e) => (e.metaKey || e.ctrlKey ? window.open(`${config.path}/${r.id}`, "_blank") : navigate(`${config.path}/${r.id}`))}
        sorts={sorts}
        onSortsChange={setSorts}
        groups={groupBy.map((k) => groups.find((g) => g.key === k)!).filter(Boolean)}
        widths={widths}
        onWidthsChange={setWidths}
        selected={canBulk ? selected : undefined}
        onSelectedChange={setSelected}
        empty={
          !isLoading &&
          filtered.length === 0 && (
            <p className="px-4 py-6 text-gray-500 text-sm text-center">{records.length === 0 ? `No ${plural} yet.` : `No ${plural} match.`}</p>
          )
        }
      />
    </div>
  );
}

// A field's value as read on its card. A location's address links to a map.
function shownValue(f: FieldSpec, value: string, config: DirectoryConfig): ReactNode {
  if (!value) return null;
  if (f.type === "address")
    return (
      <span className="flex flex-col items-start gap-0.5">
        <span className="whitespace-pre-line">{stackedAddress(value)}</span>
        {config.collection === "venues" && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(oneLineAddress(value))}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover"
          >
            Map ↗
          </a>
        )}
      </span>
    );
  if (f.type === "textarea") return <span className="whitespace-pre-line">{value}</span>;
  if (f.type === "email") return <a href={`mailto:${value}`} className="hover:underline">{value}</a>;
  if (f.type === "tel") return <a href={`tel:${value.replace(/[^\d+]/g, "")}`} className="hover:underline">{value}</a>;
  return value;
}

// A field's input, on a card or the new record's form.
function FieldInput({ field, value, onChange, autoFocus }: { field: FieldSpec; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  if (field.type === "address") return <AddressInput value={value} onChange={onChange} />;
  if (field.type === "textarea") return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="input py-1.5 w-full" />;
  return (
    <input
      type={field.type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      autoFocus={autoFocus}
      className="input py-1.5 w-full"
    />
  );
}

const draftOf = (config: DirectoryConfig, record: RecordModel | undefined): Draft =>
  Object.fromEntries(config.fields.map((f) => [f.key, String(record?.[f.key] ?? "")]));

function DirectoryDetail({ config }: { config: DirectoryConfig }) {
  const { id = "" } = useParams();
  return id === "new" ? <NewRecord config={config} /> : <ExistingRecord config={config} id={id} />;
}

function NewRecord({ config }: { config: DirectoryConfig }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftOf(config, undefined));
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    try {
      const saved = await pb.collection(config.collection).create(withOrg({ ...draft, name: draft.name.trim() }));
      await queryClient.invalidateQueries({ queryKey: [config.collection] });
      navigate(`${config.path}/${saved.id}`, { replace: true });
    } catch (err) {
      showToast("error", `Couldn't create the ${config.singular}: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: config.title, to: config.path }, { label: `New ${config.singular}` }]} />
      <h1 className="text-xl font-semibold text-gray-900">New {config.singular}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="card p-4 flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {config.fields.map((f, i) => (
            <Field key={f.key} label={f.label} className={f.wide ? "sm:col-span-2" : ""}>
              <FieldInput field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} autoFocus={i === 0} />
            </Field>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <button type="submit" disabled={saving || !draft.name.trim()} className="btn-primary py-2">
            {saving ? "Creating…" : `Create ${config.singular}`}
          </button>
          <Link to={config.path} className="btn-secondary py-2">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

type Tab = "general" | "projects";
const TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "projects", label: "Projects" },
];

function ExistingRecord({ config, id }: { config: DirectoryConfig; id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [tab, openTab] = useTab(TABS);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const canEdit = can(`${config.collection}.edit`);
  const { fields: customFields } = useCustomFields(config.customTarget);

  const { data: record, isLoading, error } = useQuery({
    queryKey: [config.collection, id],
    queryFn: () => pb.collection(config.collection).getOne<RecordModel>(id),
  });
  useFollowOrg(record?.org);
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs", config.jobField, id],
    queryFn: () =>
      pb.collection("jobs").getFullList<JobRef>({
        filter: pb.filter(`${config.jobField} = {:id}`, { id }),
        expand: config.collection === "venues" ? `${config.otherField},spaces` : config.otherField,
        fields: `id,number,name,status,jobStatus,client,venue,spaces,startAt,endAt,expand.${config.otherField}.name,expand.spaces.name`,
        sort: "-startAt",
      }),
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !record) return <p className="text-red-600 text-sm">Couldn&apos;t load this {config.singular}: {error ? errorText(error) : "not found"}</p>;

  const name = String(record.name || "(no name)");
  const facts = projectFacts(jobs, Date.now());
  const fieldOf = (key: string) => config.fields.find((f) => f.key === key)!;

  async function update(body: Record<string, unknown>, done: string) {
    setSaving(true);
    try {
      const saved = await pb.collection(config.collection).update<RecordModel>(id, body);
      queryClient.setQueryData([config.collection, id], saved);
      await queryClient.invalidateQueries({ queryKey: [config.collection] });
      setEditing(null);
      showToast("success", done);
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  function startEditing(section: string) {
    setDraft(draftOf(config, record));
    setEditing(section);
  }

  async function setArchived(archived: boolean) {
    if (archived) {
      const ok = await confirm({
        title: `Archive ${config.singular}`,
        message: `Archive ${name}? It's hidden from lists and can't be picked for new projects. Projects it's already on keep it, and you can restore it any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    await update({ archived }, archived ? "Archived" : "Restored");
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${config.singular}`,
      message: `Delete ${name}? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection(config.collection).delete(id);
      await queryClient.invalidateQueries({ queryKey: [config.collection] });
      showToast("success", `Deleted ${name}`);
      navigate(config.path, { replace: true });
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  const card = (s: SectionSpec) => (
    <DetailCard
      key={s.key}
      title={s.title}
      editing={editing === s.key}
      canEdit={canEdit && editing === null}
      saving={saving}
      saveDisabled={s.fields.includes("name") && !draft.name?.trim()}
      onEdit={() => startEditing(s.key)}
      onCancel={() => setEditing(null)}
      onSave={() => update(Object.fromEntries(s.fields.map((k) => [k, k === "name" ? draft.name.trim() : draft[k]])), "Saved")}
    >
      {s.fields.map((key) => {
        const f = fieldOf(key);
        return (
          <DetailRow key={key} label={f.label} value={shownValue(f, String(record[key] ?? ""), config)}>
            <FieldInput field={f} value={draft[key] ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))} />
          </DetailRow>
        );
      })}
    </DetailCard>
  );
  const [first, ...rest] = config.sections;
  const notes = rest.find((s) => s.key === "notes");

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: config.title, to: config.path }, { label: name }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-gray-900">{name}</h1>
          {config.collection === "contacts" && record.contactPerson && <p className="text-sm text-gray-500 mt-0.5">{String(record.contactPerson)}</p>}
          {config.collection === "venues" && record.address && <p className="text-sm text-gray-500 mt-0.5">{oneLineAddress(String(record.address))}</p>}
        </div>
        {can("jobs.create") && !record.archived && (
          <Link to={`/projects/new?${config.jobField}=${id}`} className="btn-secondary">
            New project
          </Link>
        )}
      </div>

      {record.archived && (
        <div className="card bg-gray-50 px-4 py-2.5 text-sm text-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <span>Archived: hidden from lists and can&apos;t be picked for new projects.</span>
          {canEdit && (
            <button onClick={() => setArchived(false)} disabled={saving} className="btn-secondary py-1">
              Restore
            </button>
          )}
        </div>
      )}

      <TabBar label={`${config.singular} sections`} tabs={TABS.map((t) => ({ ...t, count: t.key === "projects" ? jobs.length : undefined }))} current={tab} onOpen={openTab} />

      {tab === "general" ? (
        <div className="flex flex-col gap-4">
          <FactTiles>
            {[
              <Fact
                key="count"
                label="Projects"
                value={
                  facts.count === 0 ? (
                    "None yet"
                  ) : (
                    <>
                      {facts.count}
                      {facts.coming.length > 0 && <span className="text-sm font-normal text-gray-500"> · {facts.coming.length} coming up</span>}
                    </>
                  )
                }
              />,
              <Fact key="next" label="Next project" value={facts.next ? nextDay(facts.next) : "Nothing booked"} title={facts.next ? jobTitle(facts.next) : undefined} />,
              <Fact
                key="last"
                label="Last project"
                value={facts.last ? shortDay(parseDate(facts.last.startAt) ?? new Date()) : "—"}
                title={facts.last ? jobTitle(facts.last) : undefined}
              />,
            ]}
          </FactTiles>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
            <div className="flex flex-col gap-4 min-w-0">
              {card(first)}
              {rest.filter((s) => s !== notes).map(card)}
              <CustomFieldsCard
                fields={customFields}
                values={record.custom as Record<string, unknown> | null}
                canEdit={canEdit}
                onSave={async (custom) => {
                  const saved = await pb.collection(config.collection).update<RecordModel>(id, { custom });
                  queryClient.setQueryData([config.collection, id], saved);
                  await queryClient.invalidateQueries({ queryKey: [config.collection] });
                }}
              />
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              {config.collection === "venues" && <SpacesCard venueId={id} canEdit={canEdit} />}
              {notes && card(notes)}
              <ProjectsCard title="Coming up" jobs={facts.coming.slice(0, 5)} config={config} empty="Nothing booked." more={facts.coming.length > 5 ? () => openTab("projects") : undefined} />
            </div>
          </div>
          {(canEdit || can(`${config.collection}.delete`)) && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              {canEdit && !record.archived && (
                <button onClick={() => setArchived(true)} disabled={saving} className="btn-secondary">
                  Archive
                </button>
              )}
              {can(`${config.collection}.delete`) && (
                <span title={jobs.length > 0 ? `On ${jobs.length} project${jobs.length === 1 ? "" : "s"}, so it can't be deleted. Archive it instead` : undefined}>
                  <button onClick={remove} disabled={jobs.length > 0} className="btn-secondary hover:text-fault-ink disabled:opacity-40 disabled:pointer-events-none">
                    Delete
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ProjectsCard title="Coming up" jobs={facts.coming} config={config} empty="Nothing booked." />
          <ProjectsCard title="Past" jobs={facts.past} config={config} empty="No past projects." />
        </div>
      )}
    </div>
  );
}

// A record's projects, like an item's history: each with its dates, the
// other side (a client's location, a location's client) and its status.
function ProjectsCard({ title, jobs, config, empty, more }: { title: string; jobs: JobRef[]; config: DirectoryConfig; empty: string; more?: () => void }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow text-gray-500">
          {title}
          {jobs.length > 0 && <span className="ml-1.5 font-mono text-gray-400">{jobs.length}</span>}
        </h2>
        {more && (
          <button onClick={more} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
            All projects →
          </button>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 -mx-4">
          {jobs.map((j) => {
            const other = j.expand?.[config.otherField]?.name ?? "";
            // At a location: which of its spaces.
            const spaces = config.collection === "venues" ? (j.expand?.spaces ?? []).map((sp) => sp.name).join(", ") : "";
            return (
              <Link key={j.id} to={`/projects/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-50">
                <span className="flex flex-col min-w-0">
                  <span className="text-gray-900 truncate">
                    <span className="text-gray-400 tabular-nums">#{j.number}</span> {j.name}
                  </span>
                  <span className="text-xs text-gray-500 truncate">{[formatRange(j.startAt, j.endAt), other, spaces].filter(Boolean).join(" · ")}</span>
                </span>
                <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ContactsList() {
  return <DirectoryList config={CONTACTS} />;
}

export function ContactDetail() {
  return <DirectoryDetail config={CONTACTS} />;
}

export function VenuesList() {
  return <DirectoryList config={VENUES} />;
}

export function VenueDetail() {
  return <DirectoryDetail config={VENUES} />;
}

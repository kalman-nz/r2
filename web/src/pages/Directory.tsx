import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RecordModel } from "pocketbase";
import { pb } from "../lib/pocketbase";
import type { Job, ViewConfig } from "../lib/api";
import { formatDate } from "../lib/format";
import { errorText } from "../lib/errors";
import { useRole } from "../lib/roles";
import ColumnsMenu from "../components/ColumnsMenu";
import Field from "../components/Field";
import PageViews from "../components/PageViews";
import { JobStatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { orgFilter, withOrg } from "../lib/currentOrg";
import { useFollowOrg } from "../lib/org";
import { asBool, asString, asStrings } from "../lib/views";

// Contacts and venues are plain records with a list, an edit form and the
// jobs that use them, so one config-driven pair of pages serves both.

interface FieldSpec {
  key: string;
  label: string;
  type?: "text" | "email" | "textarea" | "select";
  options?: { value: string; label: string }[];
  hint?: string;
  wide?: boolean;
  placeholder?: string;
}

// A list column; the first (the name) always shows, the rest can be picked
// (shown: on to start with), and saved views keep the choice.
interface ColumnSpec {
  key: string;
  label: string;
  className?: string;
  shown?: boolean;
  format?: (value: unknown) => string;
}

interface DirectoryConfig {
  collection: "contacts" | "venues";
  // Its page for saved views.
  page: "contacts" | "locations";
  title: string;
  singular: string;
  path: string;
  // The job field pointing at this collection.
  jobField: "client" | "venue";
  fields: FieldSpec[];
  columns: ColumnSpec[];
  searchKeys: string[];
  // A "Type" filter, for contacts: companies or people.
  kinds?: { value: string; label: string }[];
}

const CONTACTS: DirectoryConfig = {
  collection: "contacts",
  page: "contacts",
  title: "Contacts",
  singular: "contact",
  path: "/contacts",
  jobField: "client",
  fields: [
    { key: "name", label: "Name", wide: true, placeholder: "Company or person" },
    {
      key: "kind",
      label: "Type",
      type: "select",
      options: [
        { value: "", label: "—" },
        { value: "company", label: "Company" },
        { value: "person", label: "Person" },
      ],
    },
    { key: "contactPerson", label: "Contact person" },
    { key: "email", label: "Email", type: "email", hint: "Where quotes go" },
    { key: "phone", label: "Phone" },
    { key: "billingAddress", label: "Billing address", type: "textarea", wide: true, hint: "Printed on quotes" },
    { key: "notes", label: "Notes", type: "textarea", wide: true },
  ],
  columns: [
    { key: "name", label: "Name" },
    { key: "kind", label: "Type", className: "hidden md:table-cell", shown: false, format: (v) => (v === "company" ? "Company" : v === "person" ? "Person" : "") },
    { key: "contactPerson", label: "Contact", className: "hidden md:table-cell" },
    { key: "email", label: "Email", className: "hidden sm:table-cell" },
    { key: "phone", label: "Phone", className: "hidden lg:table-cell" },
    { key: "billingAddress", label: "Billing address", className: "hidden lg:table-cell", shown: false },
  ],
  searchKeys: ["name", "contactPerson", "email", "phone"],
  kinds: [
    { value: "company", label: "Companies" },
    { value: "person", label: "People" },
  ],
};

const VENUES: DirectoryConfig = {
  collection: "venues",
  page: "locations",
  title: "Locations",
  singular: "location",
  path: "/locations",
  jobField: "venue",
  fields: [
    { key: "name", label: "Name", wide: true },
    { key: "address", label: "Address", type: "textarea", wide: true },
    { key: "contactName", label: "On-site contact" },
    { key: "phone", label: "Phone" },
    { key: "notes", label: "Notes", type: "textarea", wide: true, hint: "Access, loading dock, power, parking" },
  ],
  columns: [
    { key: "name", label: "Name" },
    { key: "address", label: "Address", className: "hidden sm:table-cell" },
    { key: "contactName", label: "Contact", className: "hidden md:table-cell" },
    { key: "phone", label: "Phone", className: "hidden lg:table-cell", shown: false },
    { key: "notes", label: "Notes", className: "hidden lg:table-cell", shown: false },
  ],
  searchKeys: ["name", "address", "contactName"],
};

function DirectoryList({ config }: { config: DirectoryConfig }) {
  const navigate = useNavigate();
  const { can } = useRole();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [kind, setKind] = useState("");
  const pickable = useMemo(() => config.columns.slice(1), [config]);
  // The page as it comes, and what a saved view keeps: filters and columns.
  const defaults = useMemo<ViewConfig>(
    () => ({ archived: false, ...(config.kinds ? { kind: "" } : {}), columns: pickable.filter((c) => c.shown !== false).map((c) => c.key) }),
    [config, pickable],
  );
  const [shown, setShown] = useState<string[]>(defaults.columns as string[]);
  const settings: ViewConfig = { archived: showArchived, ...(config.kinds ? { kind } : {}), columns: shown };
  function applySettings(s: ViewConfig) {
    setShowArchived(asBool(s.archived));
    const k = asString(s.kind);
    setKind(config.kinds?.some((x) => x.value === k) ? k : "");
    setShown(asStrings(s.columns, pickable.map((c) => c.key)));
  }
  const columns = [config.columns[0], ...pickable.filter((c) => shown.includes(c.key))];
  const { data: records = [], isLoading, error } = useQuery({
    queryKey: [config.collection],
    queryFn: () => pb.collection(config.collection).getFullList<RecordModel>({ filter: orgFilter(), sort: "name" }),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((r) => {
      if (!showArchived && r.archived) return false;
      if (kind && r.kind !== kind) return false;
      return !term || config.searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(term));
    });
  }, [records, search, showArchived, kind, config.searchKeys]);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">{config.title}</h1>
          <p className="text-xs text-gray-500">{filtered.length.toLocaleString()} shown</p>
        </div>
        {can(`${config.collection}.create`) && (
          <Link to={`${config.path}/new`} className="btn-primary">
            New {config.singular}
          </Link>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <PageViews page={config.page} settings={settings} defaults={defaults} onApply={applySettings} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="input w-72" />
        {config.kinds && (
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="input w-auto" aria-label="Type">
            <option value="">All types</option>
            {config.kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-gray-600 px-1.5">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <div className="ml-auto">
          <ColumnsMenu columns={pickable} visible={shown} onChange={setShown} />
        </div>
      </div>
      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {error && <p className="text-red-600 text-sm">Couldn't load: {errorText(error)}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              {columns.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-medium ${c.className ?? ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => navigate(`${config.path}/${r.id}`)} className="hover:bg-gray-50 cursor-pointer">
                {columns.map((c, i) => (
                  <td key={c.key} className={`px-3 py-2 ${i === 0 ? "font-medium text-gray-900" : "text-gray-600"} ${c.className ?? ""}`}>
                    {String((c.format ? c.format(r[c.key]) : r[c.key]) || (i === 0 ? "(no name)" : "—")).split("\n")[0]}
                    {i === 0 && r.archived && <span className="ml-2 text-xs text-gray-400 font-normal">Archived</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm text-center">
            {records.length === 0 ? `No ${config.title.toLowerCase()} yet.` : "Nothing matches."}
          </p>
        )}
      </div>
    </div>
  );
}

function DirectoryDetail({ config }: { config: DirectoryConfig }) {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [saving, setSaving] = useState(false);

  const { data: record, isLoading } = useQuery({
    queryKey: [config.collection, id],
    queryFn: () => pb.collection(config.collection).getOne<RecordModel>(id),
    enabled: !isNew,
  });
  useFollowOrg(record?.org);
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs", config.jobField, id],
    queryFn: () =>
      pb.collection("jobs").getFullList<Job>({ filter: pb.filter(`${config.jobField} = {:id}`, { id }), sort: "-prepAt" }),
    enabled: !isNew,
  });

  const initial = useMemo(() => {
    const values: Record<string, string | boolean> = {};
    for (const f of config.fields) values[f.key] = String(record?.[f.key] ?? "");
    values.archived = record?.archived === true;
    return values;
  }, [record, config.fields]);
  useEffect(() => setDraft(initial), [initial]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const readOnly = !can(isNew ? `${config.collection}.create` : `${config.collection}.edit`);

  async function save() {
    setSaving(true);
    try {
      const saved = isNew
        ? await pb.collection(config.collection).create(withOrg(draft))
        : await pb.collection(config.collection).update(id, draft);
      await queryClient.invalidateQueries({ queryKey: [config.collection] });
      showToast("success", isNew ? `${config.singular[0].toUpperCase()}${config.singular.slice(1)} created` : "Saved");
      if (isNew) navigate(`${config.path}/${saved.id}`, { replace: true });
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${config.singular}`,
      message: `Delete "${String(draft.name)}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection(config.collection).delete(id);
      await queryClient.invalidateQueries({ queryKey: [config.collection] });
      navigate(config.path, { replace: true });
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  if (!isNew && isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Link to={config.path} className="text-sm text-gray-500 hover:text-gray-900 w-fit">
        ← {config.title}
      </Link>
      <h1 className="text-xl font-semibold text-gray-900">{isNew ? `New ${config.singular}` : String(initial.name || "(no name)")}</h1>

      <section className="card p-4 flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          {config.fields.map((f) => {
            const value = String(draft[f.key] ?? "");
            const onChange = (v: string) => setDraft((d) => ({ ...d, [f.key]: v }));
            return (
              <Field key={f.key} label={f.label} hint={f.hint} className={f.wide ? "sm:col-span-2" : ""}>
                {f.type === "textarea" ? (
                  <textarea value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly} rows={3} className="input py-2" />
                ) : f.type === "select" ? (
                  <select value={value} onChange={(e) => onChange(e.target.value)} disabled={readOnly} className="input py-2">
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type ?? "text"}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={readOnly}
                    placeholder={f.placeholder}
                    className="input py-2"
                  />
                )}
              </Field>
            );
          })}
          {!isNew && !readOnly && (
            <label className="flex items-center gap-2 text-sm text-gray-600 sm:col-span-2">
              <input type="checkbox" checked={draft.archived === true} onChange={(e) => setDraft((d) => ({ ...d, archived: e.target.checked }))} />
              Archived — hidden from lists and dropdowns, kept on past projects
            </label>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
            <button onClick={save} disabled={saving || !dirty || !String(draft.name ?? "").trim()} className="btn-primary py-2">
              {saving ? "Saving…" : isNew ? `Create ${config.singular}` : "Save changes"}
            </button>
            {!isNew && jobs.length === 0 && can(`${config.collection}.delete`) && (
              <button onClick={remove} className="text-sm text-red-600 hover:text-red-700">
                Delete
              </button>
            )}
          </div>
        )}
      </section>

      {!isNew && (
        <section className="card overflow-hidden">
          <h2 className="text-sm font-semibold text-gray-500 px-4 pt-3 pb-2">Projects ({jobs.length})</h2>
          <div className="divide-y divide-gray-100">
            {jobs.map((j) => (
              <Link key={j.id} to={`/projects/${j.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-50">
                <span className="truncate">
                  <span className="text-gray-400 tabular-nums">#{j.number}</span> {j.name}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-gray-500">{formatDate(j.prepAt)}</span>
                  <JobStatusBadge status={j.status} jobStatus={j.jobStatus} />
                </span>
              </Link>
            ))}
            {jobs.length === 0 && <p className="px-4 py-6 text-sm text-gray-500 text-center">No projects yet.</p>}
          </div>
        </section>
      )}
    </div>
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

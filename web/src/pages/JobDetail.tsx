import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type JobPricing, type JobStatus, type JobSummary } from "../lib/api";
import { formatDate, formatDateTime, formatPeriod, nzd, oneLineAddress, placeName } from "../lib/format";
import { errorText } from "../lib/errors";
import { useCan, useFeature, useRole } from "../lib/roles";
import JobFields from "../components/job/JobFields";
import { DISCOUNT, draftFromJob, draftToPayload, jobFieldsProblem, newJobDraft, type JobDraft } from "../lib/jobDraft";
import JobLines from "../components/job/JobLines";
import JobSchedule from "../components/job/JobSchedule";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { JOB_STAGES, PERIOD_KINDS } from "../lib/statuses";
import { JobStatusBadge, OverdueBadge, QuoteStatusBadge, RepairStatusBadge } from "../components/StatusBadge";
import { overdueReason } from "../lib/overdue";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { withOrg } from "../lib/currentOrg";
import { useFollowOrg } from "../lib/org";
import { useRepairs } from "../lib/maintenance";
import { useContacts } from "../lib/catalog";
import LocationPicker from "../components/LocationPicker";
import { useJobCrew, useJobCrewNeeds } from "../lib/crew";
import { useJobStatuses } from "../lib/workflow";
import { COUNT, numberProblem } from "../lib/numbers";
import CrewCard from "../components/job/CrewCard";
import JobCrew from "../components/job/JobCrew";
import TrackingCard from "../components/job/TrackingCard";
import DocumentsMenu from "../components/job/DocumentsMenu";
import CopyProjectModal from "../components/job/CopyProjectModal";
import { useDropdown } from "../lib/dropdown";
import SyncCard from "../components/job/SyncCard";
import Breadcrumbs from "../components/Breadcrumbs";
import StatusPicker from "../components/StatusPicker";
import QuickCreateSelect from "../components/QuickCreateSelect";
import NumberInput from "../components/NumberInput";
import { Problem } from "../components/Field";
import { DetailCard, DetailRow, Fact, FactTiles } from "../components/DetailCard";
import CustomFieldsCard from "../components/CustomFieldsCard";
import { useCustomFields } from "../lib/customFields";
import ArrowLink from "../components/ArrowLink";

export default function JobDetail() {
  const { id = "" } = useParams();
  return id === "new" ? <NewJob /> : <ExistingJob id={id} />;
}

function NewJob() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  // From a contact's or location's page, with it filled in.
  const [params] = useSearchParams();
  const [draft, setDraft] = useState<JobDraft>(() => ({ ...newJobDraft(), client: params.get("client") ?? "", venue: params.get("venue") ?? "" }));
  const [saving, setSaving] = useState(false);

  async function create() {
    setSaving(true);
    try {
      const job = await pb.collection("jobs").create(withOrg(draftToPayload(draft)));
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/projects/${job.id}`, { replace: true });
    } catch (err) {
      showToast("error", `Couldn't create the project: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Projects", to: "/projects" }, { label: "New project" }]} />
      <h1 className="text-xl font-semibold text-gray-900">New project</h1>
      <section className="card p-4 flex flex-col gap-4">
        <JobFields draft={draft} onChange={setDraft} readOnly={false} withDates />
        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <button onClick={create} disabled={saving || !draft.name.trim() || !!jobFieldsProblem(draft)} className="btn-primary py-2">
            {saving ? "Creating…" : "Create project"}
          </button>
          <Link to="/projects" className="btn-secondary py-2">
            Cancel
          </Link>
        </div>
      </section>
    </div>
  );
}

const BASIS_TEXT: Record<JobPricing["basis"], string> = {
  override: "set on the project",
  billing: "from the billing periods",
  hire: "for the whole booking",
};

function TotalsCard({ pricing, lines }: { pricing: JobPricing; lines: JobSummary["lines"] }) {
  // Hours and weeks only matter when a line is priced by them.
  const uses = (mode: string) => lines.some((l) => l.priceMode === mode && l.unitPrice);
  const t = pricing.totals;
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-semibold text-gray-900" : "text-gray-600"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <section className="card p-4 flex flex-col gap-1.5 text-sm">
      <h2 className="eyebrow text-gray-500 mb-1">Totals</h2>
      <p className="text-xs text-gray-500 mb-1">
        {pricing.days} day{pricing.days === 1 ? "" : "s"}, {BASIS_TEXT[pricing.basis]}: day rates × {pricing.factor}
        {uses("per_hour") && `; hourly × ${pricing.hours} h`}
        {uses("per_week") && `; weekly × ${pricing.weeks} week${pricing.weeks === 1 ? "" : "s"}`}
      </p>
      {row("Equipment & services", nzd(t.gross))}
      {t.lineDiscount !== 0 && row("Line discounts", `−${nzd(t.lineDiscount)}`)}
      {t.jobDiscount !== 0 && row(`Project discount (${pricing.discountPct}%)`, `−${nzd(t.jobDiscount)}`)}
      <div className="border-t border-gray-100 my-1" />
      {row("Total ex GST", nzd(t.exGst), true)}
      {row(`GST ${pricing.gstRate}%`, nzd(t.gst))}
      {row("Total incl GST", nzd(t.total), true)}
    </section>
  );
}

type Tab = "general" | "schedule" | "equipment" | "crew";
const TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "schedule", label: "Schedule" },
  { key: "equipment", label: "Equipment" },
];
// With Crew rostering on (Settings → Features).
const WITH_CREW: TabDef<Tab>[] = [...TABS, { key: "crew", label: "Crew" }];

// The schedule at a glance on the General tab.
function ScheduleOverview({ summary, onOpen }: { summary: JobSummary; onOpen: () => void }) {
  const periods = [...summary.periods].sort((a, b) => a.start.localeCompare(b.start));
  const tag = (kind: string) => (kind === "usage" ? "Usage" : kind === "billing" ? "Billing" : "");
  const bar = (kind: string) => PERIOD_KINDS.find((k) => k.value === kind)?.bar ?? "bg-steel";
  return (
    <section className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow text-gray-500">Schedule</h2>
        <ArrowLink onClick={onOpen}>Open schedule</ArrowLink>
      </div>
      <ul className="flex flex-col gap-1.5">
        {periods.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 text-sm">
            <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${bar(p.kind)}`} />
            <span className="w-48 shrink-0 font-medium text-gray-900 truncate">
              {p.subproject && <span className="text-gray-500 font-normal">{summary.subprojects?.find((sp) => sp.id === p.subproject)?.name} · </span>}
              {p.name}
              {tag(p.kind) && <span className="ml-1.5 eyebrow text-gray-500">{tag(p.kind)}</span>}
            </span>
            <span className="text-gray-600 truncate">{formatPeriod(p.start, p.end)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// The parts of a project's details that each card saves.
type Section = "project" | "pricing" | "notes";
const FIELDS: Record<Section, (keyof JobDraft)[]> = {
  project: ["name", "client", "venue", "spaces", "reference"],
  pricing: ["discountPct", "chargeDays", "quoteNotes"],
  notes: ["notes"],
};

const holds = (stage: JobStatus) => stage === "provisional" || stage === "confirmed" || stage === "out";
const done = (stage: JobStatus) => stage === "returned" || stage === "cancelled";

function ExistingJob({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const feature = useFeature();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { statuses, byId } = useJobStatuses();
  const [quoting, setQuoting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [copying, setCopying] = useState(false);
  const tabs = feature("crew") ? WITH_CREW : TABS;
  const [tab, openTab] = useTab(tabs);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["job-summary", id],
    queryFn: () => api.getJobSummary(id),
  });
  useFollowOrg(summary?.job.org);
  const setSummary = (s: JobSummary) => queryClient.setQueryData(["job-summary", id], s);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !summary) {
    return <p className="text-red-600 text-sm">Couldn&apos;t load this project: {error ? errorText(error) : "not found"}</p>;
  }
  const { job, pricing, quotes = [], packing } = summary;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["job-summary", id] }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
    ]);

  // Moving between statuses. One that releases the kit (done or
  // cancelled), or books it again, asks first.
  async function setStatus(next: string) {
    const to = byId.get(next);
    if (!to || next === job.jobStatus) return;
    const from = job.status;
    let question: { title: string; message: string; confirmLabel: string; danger?: boolean } | null = null;
    if (done(to.stage) && !done(from)) {
      question = {
        title: to.name,
        message: `Move #${job.number} to ${to.name}? ${holds(from) ? "Its equipment is released for other bookings." : "It's finished with."}`,
        confirmLabel: `Move to ${to.name}`,
        danger: to.stage === "cancelled",
      };
    } else if (done(from) && !done(to.stage)) {
      question = {
        title: to.name,
        message: `Move #${job.number} back to ${to.name}? ${holds(to.stage) ? "Its equipment is booked again." : ""}`.trim(),
        confirmLabel: `Move to ${to.name}`,
      };
    }
    if (question && !(await confirm(question))) return;
    setMoving(true);
    try {
      await pb.collection("jobs").update(job.id, { jobStatus: next });
      await refresh();
      showToast("success", `Moved to ${to.name}`);
    } catch (err) {
      showToast("error", `Couldn't change the status: ${errorText(err)}`);
    } finally {
      setMoving(false);
    }
  }

  async function issueQuote() {
    const ok = await confirm({
      title: "Issue quote",
      message: `Freeze the project as it stands into quote v${quotes.length + 1}? Later changes to the project won't alter it: issue another to update the client.`,
      confirmLabel: "Issue quote",
    });
    if (!ok) return;
    setQuoting(true);
    try {
      const result = await api.issueQuote(job.id);
      setSummary(result.summary);
      navigate(`/print/quotes/${result.quoteId}`);
    } catch (err) {
      showToast("error", `Couldn't issue the quote: ${errorText(err)}`);
    } finally {
      setQuoting(false);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete project",
      message: `Delete #${job.number} ${job.name}, with its equipment, schedule and crew? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("jobs").delete(job.id);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      showToast("success", `Deleted #${job.number}`);
      navigate("/projects", { replace: true });
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  const shortLines = summary.lines.filter((l) => (l.availability?.short ?? 0) > 0).length;
  const deletable = quotes.length === 0 && packing.scanCount === 0;
  const canEdit = can("jobs.edit");
  const notBack = packing.items.reduce((sum, i) => sum + Math.max(0, i.out), 0);
  const client = job.clientInfo;
  const venue = job.venueInfo;

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Projects", to: "/projects" }, { label: `#${job.number} ${job.name}` }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl text-gray-400 font-mono">#{job.number}</span>
            <h1 className="text-xl font-semibold text-gray-900">{job.name}</h1>
            {!canEdit && <JobStatusBadge status={job.status} jobStatus={job.jobStatus} />}
            <OverdueBadge reason={overdueReason(job, notBack)} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {client && (
              <Link to={`/contacts/${client.id}`} className="hover:text-gray-900 hover:underline">
                {client.name}
              </Link>
            )}
            {client && venue && " · "}
            {venue && (
              <Link to={`/locations/${venue.id}`} className="hover:text-gray-900 hover:underline">
                {placeName(venue.name, venue.spaces.map((s) => s.name))}
              </Link>
            )}
            {(client || venue) && " · "}
            {formatDateTime(job.startAt)} → {formatDateTime(job.endAt)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {can("jobs.create") && <MoreMenu onCopy={() => setCopying(true)} />}
          <DocumentsMenu jobId={job.id} />
          {feature("scanning") && (can("scan.out") || can("scan.in")) && (
            <Link to={`/projects/${job.id}/scan`} className="btn-secondary">
              Open in warehouse
            </Link>
          )}
          {can("quotes.issue") && (
            <button onClick={issueQuote} disabled={quoting || summary.lines.length === 0} className="btn-primary">
              {quoting ? "Issuing…" : "Issue quote"}
            </button>
          )}
        </div>
      </div>

      {copying && <CopyProjectModal summary={summary} onClose={() => setCopying(false)} />}

      {canEdit && statuses.length > 0 && (
        <div>
          <StatusPicker
            statuses={statuses}
            value={job.jobStatus}
            onChange={setStatus}
            disabled={moving}
            // A line where they stop holding kit.
            divides={(prev, next) => done(prev.stage) !== done(next.stage)}
            title={(s) => JOB_STAGES.find((x) => x.value === s.stage)?.hint ?? ""}
          />
        </div>
      )}

      {shortLines > 0 && (
        <div className="card border-fault/40 bg-red-50/60 px-4 py-2.5 text-sm text-red-700 flex items-center justify-between gap-3 flex-wrap">
          <span>
            {shortLines} line{shortLines === 1 ? " is" : "s are"} short for these dates.
          </span>
          {tab !== "equipment" && (
            <button onClick={() => openTab("equipment")} className="text-xs font-medium underline">
              See the equipment
            </button>
          )}
        </div>
      )}

      <TabBar
        label="Project sections"
        current={tab}
        onOpen={openTab}
        tabs={tabs.map((t) => ({ ...t, count: t.key === "schedule" ? summary.periods.length : t.key === "equipment" ? summary.lines.filter((l) => !l.parentLine).length : undefined }))}
      />

      {tab === "general" ? (
        // What people check first across the top, then two stacked columns,
        // the way an item's page is. Each card edits in place.
        <div className="flex flex-col gap-4">
          <KeyFacts summary={summary} shortLines={shortLines} />
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
            <div className="flex flex-col gap-4 min-w-0">
              <JobDetailsCards summary={summary} canEdit={canEdit} onSaved={refresh}>
                {(cards) => (
                  <>
                    {cards.project}
                    <JobCustomFields summary={summary} canEdit={canEdit} onSaved={refresh} />
                    <ScheduleOverview summary={summary} onOpen={() => openTab("schedule")} />
                    {feature("crew") && <CrewCard summary={summary} canEdit={canEdit} />}
                    {cards.notes}
                    {cards.pricing}
                  </>
                )}
              </JobDetailsCards>
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              {pricing && <TotalsCard pricing={pricing} lines={summary.lines} />}
              {summary.quotes && (
                <section className="card p-4 flex flex-col gap-2 text-sm">
                  <h2 className="eyebrow text-gray-500">Quotes</h2>
                  {quotes.length === 0 && <p className="text-gray-500">None yet.</p>}
                  {quotes.map((q) => (
                    <Link key={q.id} to={`/print/quotes/${q.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-gray-50">
                      <span className="flex flex-col">
                        <span className="font-medium text-gray-900">
                          Q{job.number}-{q.version}
                        </span>
                        <span className="text-xs text-gray-500">{formatDate(q.issuedAt)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums text-gray-700">{nzd(q.total)}</span>
                        <QuoteStatusBadge status={q.status} />
                      </span>
                    </Link>
                  ))}
                </section>
              )}
              {feature("scanning") && <TrackingCard summary={summary} canScan={can("scan.out") || can("scan.in")} />}
              {feature("repairs") && <DamageCard jobId={job.id} />}
              <SyncCard jobId={job.id} />
            </div>
          </div>
          {can("jobs.delete") && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              <span title={deletable ? undefined : "It's been quoted or scanned, so it can't be deleted. Cancel it instead"}>
                <button onClick={remove} disabled={!deletable} className="btn-secondary hover:text-fault-ink disabled:opacity-40 disabled:pointer-events-none">
                  Delete
                </button>
              </span>
            </div>
          )}
        </div>
      ) : (
        // Full width: the side cards live on General.
        <div className="flex flex-col gap-4 min-w-0">
          {tab === "equipment" && <JobLines summary={summary} canEdit={can("jobs.lines")} onSummary={setSummary} />}
          {tab === "schedule" && <JobSchedule summary={summary} canEdit={canEdit} />}
          {tab === "crew" && feature("crew") && <JobCrew summary={summary} canEdit={canEdit} />}
        </div>
      )}
    </div>
  );
}

// The project's less-used actions, out of the way.
function MoreMenu({ onCopy }: { onCopy: () => void }) {
  const { open, setOpen, ref } = useDropdown();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-secondary px-2.5" aria-label="More" aria-haspopup="true" aria-expanded={open}>
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 card shadow-lg py-1 z-40 text-sm">
          <button
            onClick={() => {
              setOpen(false);
              onCopy();
            }}
            className="w-full text-left px-3 py-2 hover:bg-gray-50"
          >
            Copy project…
          </button>
        </div>
      )}
    </div>
  );
}

// The few things people open a project to check, before anything else.
function KeyFacts({ summary, shortLines }: { summary: JobSummary; shortLines: number }) {
  const feature = useFeature();
  const rostering = feature("crew");
  const { data: needs = [] } = useJobCrewNeeds(summary.job.id, rostering);
  const { data: crew = [] } = useJobCrew(summary.job.id);
  const lines = summary.lines.filter((l) => !l.parentLine).length;
  const slots = needs.reduce((n, x) => n + x.quantity, 0);
  const filled = needs.reduce((n, x) => n + Math.min(x.quantity, crew.filter((c) => c.need === x.id).length), 0);
  const people = new Set(crew.map((c) => c.person)).size;
  const latest = summary.quotes?.[summary.quotes.length - 1];
  return (
    <FactTiles>
      {[
        <Fact
          key="equipment"
          label="Equipment"
          value={lines === 0 ? "Nothing yet" : shortLines > 0 ? `${shortLines} of ${lines} short` : `${lines} line${lines === 1 ? "" : "s"}`}
          tone={shortLines > 0 ? "text-fault-ink" : "text-gray-900"}
        />,
        rostering && <Fact
          key="crew"
          label="Crew"
          value={
            rostering && slots > 0
              ? `${filled} of ${slots} filled`
              : people > 0
                ? `${people} ${people === 1 ? "person" : "people"}`
                : rostering
                  ? "None needed"
                  : "Nobody yet"
          }
          tone={rostering && filled < slots ? "text-amber-700" : "text-gray-900"}
        />,
        summary.pricing && <Fact key="total" label="Total ex GST" value={nzd(summary.pricing.totals.exGst)} />,
        summary.quotes && (
          <Fact
            key="quote"
            label="Quote"
            value={latest ? `Q${summary.job.number}-${latest.version} · ${latest.status === "void" ? "Void" : latest.status.charAt(0).toUpperCase() + latest.status.slice(1)}` : "Not quoted"}
          />
        ),
      ]}
    </FactTiles>
  );
}

// A project's details, one card per section, read and edited in place
// (components/DetailCard.tsx). The project page places the cards.
function JobDetailsCards({
  summary,
  canEdit,
  onSaved,
  children,
}: {
  summary: JobSummary;
  canEdit: boolean;
  onSaved: () => Promise<unknown>;
  children: (cards: Record<Section, ReactNode>) => ReactNode;
}) {
  const { job } = summary;
  const can = useCan();
  const feature = useFeature();
  const { showToast } = useToast();
  const { data: contacts = [] } = useContacts();
  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<JobDraft>(() => draftFromJob(job));
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function start(section: Section) {
    setDraft(draftFromJob(job));
    setEditing(section);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      for (const key of FIELDS[editing]) body[key] = key === "name" ? draft.name.trim() : draft[key];
      await pb.collection("jobs").update(job.id, body);
      await onSaved();
      setEditing(null);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const problem = { discountPct: numberProblem(draft.discountPct, DISCOUNT), chargeDays: numberProblem(draft.chargeDays, COUNT) };
  const card = (section: Section) => ({
    editing: editing === section,
    canEdit: canEdit && editing === null,
    saving,
    onEdit: () => start(section),
    onCancel: () => setEditing(null),
    onSave: save,
    saveDisabled: (section === "project" && !draft.name.trim()) || (section === "pricing" && !!(problem.discountPct || problem.chargeDays)),
  });
  const client = job.clientInfo;
  const venue = job.venueInfo;

  return children({
    project: (
      <DetailCard title="Project" {...card("project")}>
        <DetailRow label="Name" value={job.name}>
          <input value={draft.name} onChange={(e) => set("name", e.target.value)} className="input py-1.5 w-full" autoFocus />
        </DetailRow>
        <DetailRow
          label="Client"
          value={
            client ? (
              <Link to={`/contacts/${client.id}`} className="hover:underline">
                {client.name}
              </Link>
            ) : null
          }
          empty="No client"
        >
          <QuickCreateSelect
            collection="contacts"
            value={draft.client}
            onChange={(id) => set("client", id)}
            options={contacts.map((c) => ({ id: c.id, name: c.name, archived: c.archived, detail: [c.contactPerson, c.email].filter(Boolean).join(" · ") }))}
            canCreate={can("contacts.create")}
            placeholder="No client"
          />
        </DetailRow>
        <DetailRow
          label="Location"
          value={
            venue ? (
              <span className="flex flex-col">
                <Link to={`/locations/${venue.id}`} className="hover:underline w-fit">
                  {venue.name}
                </Link>
                {venue.spaces.length > 0 && <span>{venue.spaces.map((s) => s.name).join(", ")}</span>}
                {venue.address && <span className="text-xs text-gray-500">{oneLineAddress(venue.address)}</span>}
              </span>
            ) : null
          }
          empty="No location"
        >
          <LocationPicker value={{ venue: draft.venue, spaces: draft.spaces }} onChange={(p) => setDraft((d) => ({ ...d, venue: p.venue, spaces: p.spaces }))} />
        </DetailRow>
        <DetailRow label="Client reference" value={job.reference}>
          <input value={draft.reference} onChange={(e) => set("reference", e.target.value)} className="input py-1.5 w-full" />
        </DetailRow>
      </DetailCard>
    ),
    pricing: !feature("pricing") ? null : (
      <DetailCard title="Quote" {...card("pricing")}>
        <DetailRow label="Project discount" value={job.discountPct ? `${job.discountPct}%` : null} empty="None">
          <div className="flex items-center gap-1.5">
            <NumberInput value={draft.discountPct} min={0} max={100} onChange={(n) => set("discountPct", n)} className="input py-1.5 w-24" />
            <span className="text-gray-500">%</span>
          </div>
          <Problem>{problem.discountPct}</Problem>
        </DetailRow>
        <DetailRow label="Charge for days" value={job.chargeDays ? `${job.chargeDays} day${job.chargeDays === 1 ? "" : "s"}` : null} empty="From the schedule">
          <NumberInput value={draft.chargeDays} min={0} integer onChange={(n) => set("chargeDays", n)} className="input py-1.5 w-24" />
          <Problem>{problem.chargeDays}</Problem>
        </DetailRow>
        <DetailRow label="Notes on the quote" value={job.quoteNotes ? <span className="whitespace-pre-line">{job.quoteNotes}</span> : null}>
          <textarea value={draft.quoteNotes} onChange={(e) => set("quoteNotes", e.target.value)} rows={3} className="input py-1.5 w-full" />
        </DetailRow>
      </DetailCard>
    ),
    notes: (
      <DetailCard title="Notes" {...card("notes")}>
        <DetailRow label="Internal notes" value={job.notes ? <span className="whitespace-pre-line">{job.notes}</span> : null}>
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="input py-1.5 w-full" />
        </DetailRow>
      </DetailCard>
    ),
  });
}

// The project's custom fields (Settings → Projects → Custom fields).
function JobCustomFields({ summary, canEdit, onSaved }: { summary: JobSummary; canEdit: boolean; onSaved: () => Promise<unknown> }) {
  const { fields } = useCustomFields("job");
  return (
    <CustomFieldsCard
      fields={fields}
      values={summary.job.custom}
      canEdit={canEdit}
      onSave={async (custom) => {
        await pb.collection("jobs").update(summary.job.id, { custom });
        await onSaved();
      }}
    />
  );
}

// Kit that came back damaged from this project (repairs opened against it),
// so it can be followed up with the client. Only there when there's some.
function DamageCard({ jobId }: { jobId: string }) {
  const { data: repairs = [] } = useRepairs(`job = "${jobId}"`);
  if (repairs.length === 0) return null;
  const cost = repairs.reduce((sum, r) => sum + (r.cost || 0), 0);
  return (
    <section className="card p-4 flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow text-gray-500">Came back damaged</h2>
        {cost > 0 && <span className="text-xs text-gray-500">{nzd(cost)} in repairs</span>}
      </div>
      {repairs.map((r) => (
        <Link key={r.id} to={`/maintenance/repairs/${r.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="block font-medium text-gray-900 truncate">{r.expand?.item?.name ?? "(deleted item)"}</span>
            <span className="block text-xs text-gray-500 truncate">
              R{r.number} · {r.fault}
            </span>
          </span>
          <RepairStatusBadge status={r.status} />
        </Link>
      ))}
    </section>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type JobPricing, type JobSummary } from "../lib/api";
import { formatDate, formatDateTime, formatPeriod, nzd } from "../lib/format";
import { errorText } from "../lib/errors";
import { useFeature, useRole } from "../lib/roles";
import JobFields from "../components/job/JobFields";
import { draftFromJob, draftToPayload, draftToUpdate, jobFieldsProblem, newJobDraft, type JobDraft } from "../lib/jobDraft";
import JobLines from "../components/job/JobLines";
import JobSchedule from "../components/job/JobSchedule";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { PERIOD_KINDS } from "../lib/statuses";
import { JobStatusBadge, OverdueBadge, QuoteStatusBadge, RepairStatusBadge } from "../components/StatusBadge";
import { overdueReason } from "../lib/overdue";
import { useToast } from "../components/ToastProvider";
import { useConfirm } from "../components/ConfirmProvider";
import { withOrg } from "../lib/currentOrg";
import { useFollowOrg } from "../lib/org";
import { useRepairs } from "../lib/maintenance";
import CrewCard from "../components/job/CrewCard";
import JobCrew from "../components/job/JobCrew";
import TrackingCard from "../components/job/TrackingCard";
import DocumentsMenu from "../components/job/DocumentsMenu";
import SyncCard from "../components/job/SyncCard";
import Breadcrumbs from "../components/Breadcrumbs";

export default function JobDetail() {
  const { id = "" } = useParams();
  return id === "new" ? <NewJob /> : <ExistingJob id={id} />;
}

function NewJob() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<JobDraft>(newJobDraft);
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
        <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
          <button onClick={create} disabled={saving || !draft.name.trim() || !!jobFieldsProblem(draft)} className="btn-primary py-2">
            {saving ? "Creating…" : "Create project"}
          </button>
          <span className="text-xs text-gray-500">Then build the schedule and add equipment on the project&apos;s tabs.</span>
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
      <h2 className="text-sm font-semibold text-gray-500 mb-1">Totals</h2>
      <p className="text-xs text-gray-500 mb-1">
        Charged as {pricing.days} day{pricing.days === 1 ? "" : "s"}, {BASIS_TEXT[pricing.basis]}: day rates × {pricing.factor}
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
        <h2 className="text-sm font-semibold text-gray-500">Schedule</h2>
        <button onClick={onOpen} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover">
          Open schedule →
        </button>
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

function ExistingJob({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const feature = useFeature();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const tabs = feature("crew") ? WITH_CREW : TABS;
  const [tab, openTab] = useTab(tabs);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["job-summary", id],
    queryFn: () => api.getJobSummary(id),
  });
  useFollowOrg(summary?.job.org);
  const setSummary = (s: JobSummary) => queryClient.setQueryData(["job-summary", id], s);

  // Reset the form whenever the saved job changes (not on every line edit,
  // which refreshes the summary without touching the job itself).
  const jobUpdated = summary?.job.updated;
  useEffect(() => {
    if (summary) setDraft(draftFromJob(summary.job));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the job's own updated stamp on purpose
  }, [jobUpdated]);

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !summary) {
    return <p className="text-red-600 text-sm">Couldn't load this project: {error ? errorText(error) : "not found"}</p>;
  }
  const { job, pricing, quotes = [], packing } = summary;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(draftFromJob(job));

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await pb.collection("jobs").update(job.id, draftToUpdate(draft));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["job-summary", id] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["availability"] }),
      ]);
      setEditing(false);
      showToast("success", "Saved");
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function issueQuote() {
    const ok = await confirm({
      title: "Issue quote",
      message: `Freeze the project as it stands into quote v${quotes.length + 1}? Later changes to the project won't alter it — issue another to update the client.`,
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
      message: `Delete project #${job.number} "${job.name}" and its lines? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("jobs").delete(job.id);
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate("/projects", { replace: true });
    } catch (err) {
      showToast("error", `Couldn't delete: ${errorText(err)}`);
    }
  }

  const shortLines = summary.lines.filter((l) => (l.availability?.short ?? 0) > 0).length;
  const deletable = quotes.length === 0 && packing.scanCount === 0;

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Projects", to: "/projects" }, { label: `#${job.number} ${job.name}` }]} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl text-gray-400 tabular-nums">#{job.number}</span>
            <h1 className="text-xl font-semibold text-gray-900">{job.name}</h1>
            <JobStatusBadge status={job.status} jobStatus={job.jobStatus} />
            <OverdueBadge reason={overdueReason(job, packing.items.reduce((sum, i) => sum + Math.max(0, i.out), 0))} />
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {[job.clientInfo?.name, job.venueInfo?.name].filter(Boolean).join(" · ") || "No client or location yet"}
          </p>
          <p className="text-sm text-gray-500">
            {formatDateTime(job.startAt)} → {formatDateTime(job.endAt)}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
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

      {shortLines > 0 && (
        <div className="card border-fault/40 bg-red-50/60 px-4 py-2.5 text-sm text-red-700 flex items-center justify-between gap-3 flex-wrap">
          <span>
            {shortLines} line{shortLines === 1 ? " is" : "s are"} short for these dates. A subhire or different dates will fix it.
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
        tabs={tabs.map((t) => ({ ...t, count: t.key === "schedule" ? summary.periods.length : t.key === "equipment" ? summary.lines.length : undefined }))}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_19rem] gap-4 items-start">
        <div className="flex flex-col gap-4 min-w-0">
          {tab === "equipment" && <JobLines summary={summary} canEdit={can("jobs.lines")} onSummary={setSummary} />}

          {tab === "schedule" && <JobSchedule summary={summary} canEdit={can("jobs.edit")} />}

          {tab === "crew" && <JobCrew summary={summary} canEdit={can("jobs.edit")} />}

          {tab === "general" && (
            <>
              <section className="card p-4 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-gray-500">Details</h2>
                  {can("jobs.edit") && !editing && (
                    <button onClick={() => setEditing(true)} className="btn-secondary py-1">
                      Edit
                    </button>
                  )}
                </div>
                {draft && <JobFields draft={draft} onChange={setDraft} readOnly={!can("jobs.edit") || !editing} />}
                {can("jobs.edit") && editing && (
                  <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <button onClick={save} disabled={saving || !dirty || !draft?.name.trim() || (!!draft && !!jobFieldsProblem(draft))} className="btn-primary py-2">
                        {saving ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        onClick={() => {
                          setDraft(draftFromJob(job));
                          setEditing(false);
                        }}
                        className="btn-secondary py-2"
                      >
                        Cancel
                      </button>
                    </div>
                    {!can("jobs.delete") ? null : deletable ? (
                      <button onClick={remove} className="text-sm text-red-600 hover:text-red-700">
                        Delete project
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Quoted or scanned projects can't be deleted — cancel instead</span>
                    )}
                  </div>
                )}
              </section>
              <ScheduleOverview summary={summary} onOpen={() => openTab("schedule")} />
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {pricing && <TotalsCard pricing={pricing} lines={summary.lines} />}

          <SyncCard jobId={job.id} />

          {summary.quotes && (
            <section className="card p-4 flex flex-col gap-2 text-sm">
              <h2 className="text-sm font-semibold text-gray-500">Quotes</h2>
              {quotes.length === 0 && <p className="text-gray-500 text-xs">None issued yet.</p>}
              {quotes.map((q) => (
                <Link
                  key={q.id}
                  to={`/print/quotes/${q.id}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-gray-50"
                >
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

          <CrewCard summary={summary} canEdit={can("jobs.edit")} />

          {feature("repairs") && <DamageCard jobId={job.id} />}

          {feature("scanning") && <TrackingCard summary={summary} canScan={can("scan.out") || can("scan.in")} />}
        </div>
      </div>
    </div>
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
        <h2 className="text-sm font-semibold text-gray-500">Came back damaged</h2>
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

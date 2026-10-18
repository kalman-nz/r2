import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../../lib/pocketbase";
import type { JobPeriod, JobSummary, PeriodKind, Subproject } from "../../lib/api";
import { formatDateTime, formatDuration, formatPeriod, fromLocalInput, parseDate, toLocalInput } from "../../lib/format";
import { errorText } from "../../lib/errors";
import { withOrg } from "../../lib/currentOrg";
import { PERIOD_KINDS } from "../../lib/statuses";
import Field from "../Field";
import { useToast } from "../ToastProvider";
import { useConfirm } from "../ConfirmProvider";
import { InlineText } from "../InlineInput";
import NewSubprojectModal from "./NewSubprojectModal";
import ScheduleCalendar from "./ScheduleCalendar";
import Segmented from "../Segmented";
import Modal from "../Modal";

const HOUR = 3600000;
const VIEW_KEY = "schedule.view";
type View = "list" | "calendar";

// List or calendar, remembered per browser.
function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "calendar" ? "calendar" : "list";
  } catch {
    return "list";
  }
}
const ms = (value: string) => parseDate(value)?.getTime() ?? NaN;
const kindInfo = (kind: PeriodKind) => PERIOD_KINDS.find((k) => k.value === kind) ?? PERIOD_KINDS[PERIOD_KINDS.length - 1];
// Usage and billing first, then the rest; each in time order.
const RANK: Record<PeriodKind, number> = { usage: 0, billing: 1, other: 2 };

interface Draft {
  kind: PeriodKind;
  name: string;
  start: string; // datetime-local
  end: string;
  notes: string;
}

function draftOf(p: JobPeriod): Draft {
  return { kind: p.kind, name: p.name, start: toLocalInput(p.start), end: toLocalInput(p.end), notes: p.notes };
}

// A project's schedule. Usage periods book the kit, billing periods are
// what's charged (each counted on its own), and the rest are named times
// for the plan. The project's dates are worked out from these on the server
// (pb_hooks/lib/periods.js), so saving one refreshes the whole summary:
// availability and pricing can both move. Every project keeps at least one
// usage and one billing period. Subprojects (their own equipment, booked and
// charged over their own times) each have a schedule of the same kind,
// shown after the main project's.
export default function JobSchedule({ summary, canEdit }: { summary: JobSummary; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { job, periods, pricing, subprojects = [] } = summary;
  const [editingId, setEditingId] = useState<string | null>(null);
  // A new period and the section it goes in ("" for the main project).
  const [adding, setAdding] = useState<{ section: string; draft: Draft } | null>(null);
  const [addingSubproject, setAddingSubproject] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setViewState] = useState<View>(loadView);
  // From the calendar: a period being made (and which section it's for) or opened.
  const [calendarAdd, setCalendarAdd] = useState<{ section: string; draft: Draft } | null>(null);
  const [calendarEdit, setCalendarEdit] = useState<JobPeriod | null>(null);

  function setView(next: View) {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // not remembered, that's all
    }
  }

  const sorted = useMemo(
    () => [...periods].sort((a, b) => RANK[a.kind] - RANK[b.kind] || ms(a.start) - ms(b.start) || ms(a.end) - ms(b.end)),
    [periods],
  );
  const main = sorted.filter((p) => !p.subproject);
  const required = main.filter((p) => p.kind !== "other");
  const others = main.filter((p) => p.kind === "other");
  // The only usage (or billing) period of the project or a subproject can't
  // be removed or turned into something else; the server refuses it too.
  // Usage and billing periods a section already has (besides `except`): a
  // project and each subproject have exactly one of each.
  const takenIn = (section: string, except?: string) =>
    periods.filter((q) => (q.subproject || "") === section && q.id !== except && q.kind !== "other").map((q) => q.kind);
  const onlyOfKind = (p: JobPeriod) =>
    p.kind !== "other" && periods.filter((q) => q.kind === p.kind && (q.subproject || "") === (p.subproject || "")).length === 1;
  // Timeline labels say whose a subproject's periods are.
  const subName = (id: string) => subprojects.find((sp) => sp.id === id)?.name ?? "";
  const timeline = [...main, ...subprojects.flatMap((sp) => sorted.filter((p) => p.subproject === sp.id))].map((p) =>
    p.subproject ? { ...p, name: `${subName(p.subproject)} · ${p.name}` } : p,
  );

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["job-summary", job.id] }),
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["availability"] }),
    ]);
  }

  async function save(id: string | null, d: Draft, section = "") {
    const body = { kind: d.kind, name: d.name.trim(), start: fromLocalInput(d.start), end: fromLocalInput(d.end), notes: d.notes.trim() };
    setBusy(true);
    try {
      if (id) await pb.collection("job_periods").update(id, body);
      else await pb.collection("job_periods").create(withOrg({ ...body, job: job.id, subproject: section }));
      await refresh();
      return true;
    } catch (err) {
      showToast("error", `Couldn't save the period: ${errorText(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: JobPeriod) {
    const ok = await confirm({
      title: "Remove period",
      message: `Remove "${p.name}" (${formatPeriod(p.start, p.end)})?`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await pb.collection("job_periods").delete(p.id);
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't remove it: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // A new billing period starts out over the booking; anything else is a
  // couple of hours from the start of the project (or subproject). Quicker
  // to nudge than to type.
  function startAdding(kind: PeriodKind, section = "") {
    const owner = subprojects.find((sp) => sp.id === section) ?? { prepAt: job.prepAt, returnAt: job.returnAt };
    const from = section ? ms(owner.prepAt) : ms(job.startAt || job.prepAt);
    const [start, end] = kind === "other" ? [from, from + 2 * HOUR] : [ms(owner.prepAt), ms(owner.returnAt)];
    const iso = (t: number) => new Date(t).toISOString();
    setEditingId(null);
    setAdding({ section, draft: { kind, name: "", start: toLocalInput(iso(start)), end: toLocalInput(iso(end)), notes: "" } });
  }

  async function renameSubproject(sp: Subproject, name: string) {
    if (!name) return;
    try {
      await pb.collection("subprojects").update(sp.id, { name });
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't rename it: ${errorText(err)}`);
    }
  }

  async function removeSubproject(sp: Subproject) {
    const ok = await confirm({
      title: "Remove subproject",
      message: `Remove "${sp.name}" and its schedule? Its equipment has to be moved or removed first.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    try {
      await pb.collection("subprojects").delete(sp.id);
      await refresh();
    } catch (err) {
      showToast("error", `Couldn't remove it: ${errorText(err)}`);
    }
  }

  const addForm = (section: string) =>
    adding &&
    adding.section === section && (
      <PeriodForm
        draft={adding.draft}
        taken={takenIn(section)}
        onChange={(draft) => setAdding({ section, draft })}
        busy={busy}
        submitLabel="Add period"
        onCancel={() => setAdding(null)}
        onSubmit={async () => {
          if (await save(null, adding.draft, section)) setAdding(null);
        }}
      />
    );

  const rows = (list: JobPeriod[]) =>
    list.map((p) =>
      editingId === p.id ? (
        <EditRow
          key={p.id}
          period={p}
          busy={busy}
          kindLocked={onlyOfKind(p)}
          taken={takenIn(p.subproject || "", p.id)}
          onCancel={() => setEditingId(null)}
          onSave={async (d) => (await save(p.id, d)) && setEditingId(null)}
        />
      ) : (
        <PeriodRow
          key={p.id}
          period={p}
          canEdit={canEdit && !busy}
          locked={onlyOfKind(p)}
          onEdit={() => {
            setAdding(null);
            setEditingId(p.id);
          }}
          onRemove={() => remove(p)}
        />
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-900">Schedule</h2>
            <Segmented
              label="Schedule view"
              compact
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "List" },
                { value: "calendar", label: "Calendar" },
              ]}
            />
          </div>
          {canEdit && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setAddingSubproject(true)} disabled={busy} className="btn-secondary">
                Add subproject
              </button>
              <button onClick={() => startAdding("other")} disabled={busy || adding !== null} className="btn-primary">
                Add period
              </button>
            </div>
          )}
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Stat label={subprojects.length > 0 ? "Whole project" : "Project"} value={`${formatDateTime(job.startAt)} → ${formatDateTime(job.endAt)}`} />
          <Stat label="Equipment booked" value={`${formatDateTime(job.prepAt)} → ${formatDateTime(job.returnAt)}`} bar="bg-data" />
          <Stat
            label="Charged"
            value={
              pricing
                ? `${pricing.days} day${pricing.days === 1 ? "" : "s"}${pricing.basis === "override" ? " (set on the project)" : ""}`
                : `${formatDateTime(job.billingStart)} → ${formatDateTime(job.billingEnd)}`
            }
            bar="bg-signal"
          />
        </dl>
        {view === "list" && <Timeline periods={timeline} />}
      </section>

      {adding && adding.section === "" && <section className="card">{addForm("")}</section>}

      {view === "calendar" && (
        <section className="card p-4">
          <ScheduleCalendar
            periods={periods}
            sections={[{ id: "", name: "Main project" }, ...subprojects.map((sp) => ({ id: sp.id, name: sp.name }))]}
            sectionName={subName}
            firstDay={ms(job.startAt || job.prepAt)}
            canEdit={canEdit}
            onCreate={(start, end) => {
              const iso = (t: number) => new Date(t).toISOString();
              setCalendarAdd({ section: "", draft: { kind: "other", name: "", start: toLocalInput(iso(start)), end: toLocalInput(iso(end)), notes: "" } });
            }}
            onOpen={(p) => setCalendarEdit(p)}
            onChange={(p, start, end) =>
              save(p.id, { ...draftOf(p), start: toLocalInput(new Date(start).toISOString()), end: toLocalInput(new Date(end).toISOString()) })
            }
          />
        </section>
      )}

      {calendarAdd && (
        <Modal title="Add a period" onClose={() => setCalendarAdd(null)} wide>
          {subprojects.length > 0 && (
            <Field label="Part of">
              <select
                value={calendarAdd.section}
                onChange={(e) => setCalendarAdd({ ...calendarAdd, section: e.target.value })}
                className="input py-2"
              >
                <option value="">Main project</option>
                {subprojects.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="-mx-5">
            <PeriodForm
              draft={calendarAdd.draft}
              taken={takenIn(calendarAdd.section)}
              onChange={(draft) => setCalendarAdd({ ...calendarAdd, draft })}
              busy={busy}
              submitLabel="Add period"
              onCancel={() => setCalendarAdd(null)}
              onSubmit={async () => {
                if (await save(null, calendarAdd.draft, calendarAdd.section)) setCalendarAdd(null);
              }}
            />
          </div>
        </Modal>
      )}

      {calendarEdit && (
        <Modal
          title={calendarEdit.subproject ? `${subName(calendarEdit.subproject)} · ${calendarEdit.name}` : calendarEdit.name}
          onClose={() => setCalendarEdit(null)}
          wide
        >
          {canEdit ? (
            <>
              <div className="-mx-5">
                <EditRow
                  period={calendarEdit}
                  busy={busy}
                  kindLocked={onlyOfKind(calendarEdit)}
                  taken={takenIn(calendarEdit.subproject || "", calendarEdit.id)}
                  onCancel={() => setCalendarEdit(null)}
                  onSave={async (d) => (await save(calendarEdit.id, d)) && setCalendarEdit(null)}
                />
              </div>
              {!onlyOfKind(calendarEdit) && (
                <button
                  onClick={async () => {
                    await remove(calendarEdit);
                    setCalendarEdit(null);
                  }}
                  disabled={busy}
                  className="text-xs text-gray-500 hover:text-fault-ink w-fit"
                >
                  Remove this period
                </button>
              )}
            </>
          ) : (
            <div className="text-sm flex flex-col gap-1">
              <span className="text-gray-900">{formatPeriod(calendarEdit.start, calendarEdit.end)}</span>
              {calendarEdit.notes && <span className="text-gray-500 whitespace-pre-line">{calendarEdit.notes}</span>}
            </div>
          )}
        </Modal>
      )}

      {view === "list" && (
        <>
          <section className="card">
            <h3 className="px-4 pt-3 pb-2 eyebrow text-gray-500">Usage &amp; billing</h3>
            <div className="divide-y divide-gray-100 border-t border-gray-100">{rows(required)}</div>
          </section>

          <section className="card">
            <h3 className="px-4 pt-3 pb-2 eyebrow text-gray-500">Other times</h3>
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {rows(others)}
              {others.length === 0 && (
                <p className="px-4 py-5 text-sm text-gray-500">Pack in, crew calls, rehearsals, anything else worth planning. These don't book or charge anything.</p>
              )}
            </div>
          </section>

          {subprojects.map((sp) => (
            <section key={sp.id} className="card">
              <div className="flex items-start justify-between gap-3 flex-wrap px-4 pt-3 pb-2">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="eyebrow text-gray-500">Subproject</span>
                  {canEdit ? (
                    <InlineText
                      value={sp.name}
                      onCommit={(name) => renameSubproject(sp, name)}
                      className="font-semibold text-gray-900 w-64 border-transparent hover:border-gray-300 bg-transparent"
                    />
                  ) : (
                    <span className="font-semibold text-gray-900">{sp.name}</span>
                  )}
                  <span className="text-xs text-gray-500">
                    Booked {formatPeriod(sp.prepAt, sp.returnAt)}
                    {sp.days !== undefined && ` · charged ${sp.days} day${sp.days === 1 ? "" : "s"}`}
                  </span>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => removeSubproject(sp)} disabled={busy} className="text-xs text-gray-500 hover:text-fault-ink px-1.5 py-1">
                      Remove
                    </button>
                    <button onClick={() => startAdding("other", sp.id)} disabled={busy || adding !== null} className="btn-primary">
                      Add period
                    </button>
                  </div>
                )}
              </div>
              {addForm(sp.id)}
              <div className="divide-y divide-gray-100 border-t border-gray-100">{rows(sorted.filter((p) => p.subproject === sp.id))}</div>
            </section>
          ))}
        </>
      )}

      {addingSubproject && <NewSubprojectModal summary={summary} onSaved={() => refresh()} onClose={() => setAddingSubproject(false)} />}
    </div>
  );
}

function Stat({ label, value, bar }: { label: string; value: string; bar?: string }) {
  return (
    <div className="flex gap-2.5 rounded-md bg-gray-50 border border-gray-100 px-3 py-2">
      {bar && <span className={`w-1 rounded-full shrink-0 ${bar}`} />}
      <div className="flex flex-col min-w-0">
        <dt className="eyebrow text-gray-500">{label}</dt>
        <dd className="text-sm text-gray-900">{value}</dd>
      </div>
    </div>
  );
}

// "Sat 17", or "Fri 16 Oct" for the first label.
function dayLabel(t: number, withMonth = false) {
  const d = new Date(t);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const month = withMonth ? ` ${d.toLocaleDateString(undefined, { month: "short" })}` : "";
  return `${weekday} ${d.getDate()}${month}`;
}

// A bar per period across the whole schedule, with a tick at each local
// midnight.
function Timeline({ periods }: { periods: JobPeriod[] }) {
  const spans = periods.map((p) => ({ p, start: ms(p.start), end: ms(p.end) })).filter((s) => s.start < s.end);
  if (spans.length === 0) return null;
  const from = Math.min(...spans.map((s) => s.start));
  const to = Math.max(...spans.map((s) => s.end));
  const total = to - from;
  const pct = (t: number) => ((t - from) / total) * 100;

  const days: number[] = [];
  const d = new Date(from);
  d.setHours(24, 0, 0, 0);
  for (; d.getTime() < to; d.setDate(d.getDate() + 1)) days.push(d.getTime());
  const every = Math.max(1, Math.ceil(days.length / 10));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <span className="w-34 shrink-0" />
        <div className="relative flex-1 h-4 eyebrow text-gray-500">
          <span className="absolute left-0">{dayLabel(from, true)}</span>
          {days.map((t, i) =>
            i % every === 0 && pct(t) < 90 && pct(t) > 14 ? (
              <span key={t} className="absolute -translate-x-1/2" style={{ left: `${pct(t)}%` }}>
                {dayLabel(t)}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        {spans.map(({ p, start, end }) => (
          <div key={p.id} className="flex items-center gap-2">
            <span className="w-34 shrink-0 text-xs text-gray-600 truncate" title={p.name}>
              {p.name}
            </span>
            <div className="relative flex-1 h-5 rounded-sm bg-gray-50">
              {days.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 border-l border-gray-200" style={{ left: `${pct(t)}%` }} />
              ))}
              <div
                className={`absolute top-0.5 bottom-0.5 rounded-sm ${kindInfo(p.kind).bar} min-w-1`}
                style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }}
                title={`${p.name}: ${formatPeriod(p.start, p.end)}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: PeriodKind }) {
  if (kind === "other") return null;
  const style = kind === "usage" ? "bg-data-soft text-data-ink" : "bg-signal-soft text-signal-ink";
  return <span className={`eyebrow px-1.5 py-0.5 rounded ${style}`}>{kindInfo(kind).label}</span>;
}

function PeriodRow({
  period: p,
  canEdit,
  locked,
  onEdit,
  onRemove,
}: {
  period: JobPeriod;
  canEdit: boolean;
  locked: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className={`mt-1 w-1 self-stretch rounded-full shrink-0 ${kindInfo(p.kind).bar}`} />
      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[14rem_minmax(0,1fr)_auto] gap-x-4 gap-y-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-gray-900 truncate">{p.name}</span>
          <KindBadge kind={p.kind} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm text-gray-700">{formatPeriod(p.start, p.end)}</span>
          {p.notes && <span className="text-xs text-gray-500 whitespace-pre-line">{p.notes}</span>}
        </div>
        <span className="text-xs text-gray-500 tabular-nums md:text-right md:pt-0.5">{formatDuration(ms(p.end) - ms(p.start))}</span>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="text-xs font-medium text-signal-ink hover:text-signal-ink-hover px-1.5 py-1">
            Edit
          </button>
          <button
            onClick={onRemove}
            disabled={locked}
            title={locked ? `A project needs at least one ${kindInfo(p.kind).label.toLowerCase()} period. Add another first` : undefined}
            className="text-xs text-gray-500 hover:text-fault-ink px-1.5 py-1 disabled:opacity-40 disabled:pointer-events-none"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function EditRow({
  period,
  busy,
  kindLocked,
  taken,
  onSave,
  onCancel,
}: {
  period: JobPeriod;
  busy: boolean;
  kindLocked: boolean;
  taken: PeriodKind[];
  onSave: (d: Draft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(period));
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(period));
  return (
    <PeriodForm
      draft={draft}
      onChange={setDraft}
      busy={busy}
      kindLocked={kindLocked}
      taken={taken}
      submitLabel="Save"
      submitDisabled={!dirty}
      onCancel={onCancel}
      onSubmit={() => onSave(draft)}
    />
  );
}

function PeriodForm({
  draft,
  onChange,
  busy,
  kindLocked = false,
  taken = [],
  submitLabel,
  submitDisabled = false,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  busy: boolean;
  kindLocked?: boolean;
  // Kinds this section already has its one of: they can't be picked.
  taken?: PeriodKind[];
  submitLabel: string;
  submitDisabled?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const start = ms(fromLocalInput(draft.start));
  const end = ms(fromLocalInput(draft.end));
  const backwards = Number.isFinite(start) && Number.isFinite(end) && !(start < end);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="px-4 py-3 bg-gray-50/70 flex flex-col gap-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2">
        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            required
            autoFocus
            maxLength={200}
            placeholder={draft.kind === "other" ? "e.g. Pack in, Crew call, Rehearsal" : draft.kind === "billing" ? "e.g. Show day 1" : "e.g. Equipment booked"}
            className="input py-2"
          />
        </Field>
        <Field
          label="Does"
          hint={
            kindLocked
              ? "Every project and subproject has one of these. Change its times instead"
              : draft.kind === "other" && taken.length > 0
                ? "There's already a usage and billing period: change their times instead"
                : kindInfo(draft.kind).hint
          }
        >
          <select value={draft.kind} onChange={(e) => set("kind", e.target.value as PeriodKind)} disabled={kindLocked} className="input py-2">
            {PERIOD_KINDS.map((k) => (
              <option key={k.value} value={k.value} disabled={k.value !== draft.kind && taken.includes(k.value)}>
                {k.label}
                {k.value !== draft.kind && taken.includes(k.value) ? " (already set)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <input type="datetime-local" value={draft.start} onChange={(e) => set("start", e.target.value)} required className="input py-2" />
        </Field>
        <Field label="End" hint={backwards ? <span className="text-fault-ink">Has to be after the start</span> : formatDuration(end - start)}>
          <input type="datetime-local" value={draft.end} onChange={(e) => set("end", e.target.value)} required className="input py-2" />
        </Field>
      </div>
      <Field label="Notes">
        <input
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="input py-2"
          placeholder="Access, contacts, who's needed"
          maxLength={2000}
        />
      </Field>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={busy || submitDisabled || backwards || !draft.name.trim()} className="btn-primary">
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  );
}

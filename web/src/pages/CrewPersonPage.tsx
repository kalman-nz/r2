import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import { api, type CrewMember, type CrewNeed, type CrewPerson, type CrewRole, type Job, type JobPeriod } from "../lib/api";
import { withOrg } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { formatPeriod, parseDate, shortDay } from "../lib/format";
import { useOrg, useFollowOrg } from "../lib/org";
import { useRole } from "../lib/roles";
import { levelsOf, skillNames, useCrewRoles } from "../lib/crew";
import Breadcrumbs from "../components/Breadcrumbs";
import { DetailCard, DetailRow, Fact, FactTiles } from "../components/DetailCard";
import Field from "../components/Field";
import { JobStatusBadge } from "../components/StatusBadge";
import { TabBar, useTab, type TabDef } from "../components/Tabs";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";
import ArrowLink from "../components/ArrowLink";

// Someone on the crew list, laid out like a contact's page: what's next for
// them across the top, their details in cards that edit in place, and every
// slot they've filled. Members' names (and emails) are their account's;
// freelancers' are typed in here. crew.manage edits.

interface Draft {
  name: string;
  phone: string;
  email: string;
  skills: string[];
  // Their level at each role that has levels, by role id.
  skillLevels: Record<string, string>;
  notes: string;
}

const draftOf = (p?: CrewPerson): Draft => ({
  name: p?.name ?? "",
  phone: p?.phone ?? "",
  email: p?.email ?? "",
  skills: p?.skills ?? [],
  skillLevels: { ...(p?.skillLevels ?? {}) },
  notes: p?.notes ?? "",
});

// A crew-need slot they fill, with when and what.
type Slot = CrewMember & { expand?: { job?: Job; need?: CrewNeed & { expand?: { role?: CrewRole; period?: JobPeriod } } } };

const time = (value: string | undefined) => parseDate(value)?.getTime() ?? 0;
const startOf = (s: Slot) => s.expand?.need?.start || "";
const endOf = (s: Slot) => s.expand?.need?.end || startOf(s);

export default function CrewPersonPage() {
  const { id = "" } = useParams();
  return id === "new" ? <NewFreelancer /> : <ExistingPerson id={id} />;
}

// Which crew roles they do, as tick boxes, and their level at each one
// that has levels.
function SkillPicker({
  value,
  levels,
  onChange,
  roles,
}: {
  value: string[];
  levels: Record<string, string>;
  onChange: (skills: string[], levels: Record<string, string>) => void;
  roles: CrewRole[];
}) {
  if (roles.length === 0) return <span className="text-xs text-gray-500 pt-1">No crew roles yet.</span>;
  const toggle = (id: string) => {
    if (!value.includes(id)) return onChange([...value, id], levels);
    const { [id]: _gone, ...rest } = levels;
    onChange(
      value.filter((s) => s !== id),
      rest,
    );
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5 pt-1">
      {roles.map((r) => {
        const on = value.includes(r.id);
        const options = levelsOf(r);
        const current = levels[r.id] ?? "";
        return (
          <span key={r.id} className="flex items-center gap-2 text-sm text-gray-700 min-w-0">
            <label className="flex items-center gap-2 min-w-0">
              <input type="checkbox" checked={on} onChange={() => toggle(r.id)} />
              <span className="truncate">{r.name}</span>
            </label>
            {on && options.length > 0 && (
              <select
                value={current}
                onChange={(e) => onChange(value, { ...levels, [r.id]: e.target.value })}
                className="input py-0.5 px-1.5 w-auto text-xs"
                aria-label={`${r.name} level`}
              >
                <option value="">No level</option>
                {[...options, ...(current && !options.includes(current) ? [current] : [])].map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </span>
        );
      })}
    </div>
  );
}

function NewFreelancer() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { roles } = useCrewRoles();
  const [draft, setDraft] = useState<Draft>(() => draftOf());
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  async function create() {
    setSaving(true);
    try {
      const saved = await pb.collection("crew_people").create<CrewPerson>(withOrg({ ...draft, name: draft.name.trim() }));
      await queryClient.invalidateQueries({ queryKey: ["crew-people"] });
      navigate(`/crew/${saved.id}`, { replace: true });
    } catch (err) {
      showToast("error", `Couldn't add them: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Crew", to: "/crew" }, { label: "New freelancer" }]} />
      <h1 className="text-xl font-semibold text-gray-900">New freelancer</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="card p-4 flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Name" className="sm:col-span-2">
            <input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className="input py-2" autoFocus />
          </Field>
          <Field label="Phone">
            <input value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} className="input py-2" />
          </Field>
          <Field label="Email">
            <input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} className="input py-2" />
          </Field>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-gray-500">Skills</span>
          <SkillPicker value={draft.skills} levels={draft.skillLevels} onChange={(skills, skillLevels) => setDraft((d) => ({ ...d, skills, skillLevels }))} roles={roles} />
        </div>
        <Field label="Internal notes">
          <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={2000} className="input py-2" />
        </Field>
        <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
          <button type="submit" disabled={saving || !draft.name.trim()} className="btn-primary py-2">
            {saving ? "Adding…" : "Add freelancer"}
          </button>
          <Link to="/crew" className="btn-secondary py-2">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

type Tab = "general" | "bookings";
const TABS: TabDef<Tab>[] = [
  { key: "general", label: "General" },
  { key: "bookings", label: "Bookings" },
];
type Section = "details" | "contact" | "skills" | "notes";
const FIELDS: Record<Section, (keyof Draft)[]> = {
  details: ["name"],
  contact: ["phone", "email"],
  skills: ["skills", "skillLevels"],
  notes: ["notes"],
};

function ExistingPerson({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useRole();
  const { org } = useOrg();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { roles, byId: roleById } = useCrewRoles();
  const [tab, openTab] = useTab(TABS);
  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf());
  const [saving, setSaving] = useState(false);
  const canEdit = can("crew.manage");

  const { data: person, isLoading, error } = useQuery({
    queryKey: ["crew-people", id],
    queryFn: () => pb.collection("crew_people").getOne<CrewPerson>(id),
  });
  useFollowOrg(person?.org);
  const { data: slots = [] } = useQuery({
    queryKey: ["job-crew", "person", id],
    queryFn: () =>
      pb.collection("job_crew").getFullList<Slot>({
        filter: pb.filter("person = {:id}", { id }),
        expand: "job,need,need.role,need.period",
      }),
  });
  // A member's email is their account's, for those who can see the team's.
  const { data: members = [] } = useQuery({
    queryKey: ["members", org?.id],
    queryFn: () => api.listMembers(org!.id),
    enabled: !!org && !!person?.user,
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Loading…</p>;
  if (error || !person) return <p className="text-red-600 text-sm">Couldn&apos;t load them: {error ? errorText(error) : "not found"}</p>;

  const member = !!person.user;
  const email = member ? members.find((m) => m.userId === person.user)?.email || person.email : person.email;
  const now = Date.now();
  const live = slots.filter((s) => s.expand?.job?.status !== "cancelled");
  const coming = live.filter((s) => time(endOf(s)) >= now).sort((a, b) => time(startOf(a)) - time(startOf(b)));
  const past = slots.filter((s) => !coming.includes(s)).sort((a, b) => time(startOf(b)) - time(startOf(a)));
  const next = coming[0];
  const month = coming.filter((s) => time(startOf(s)) <= now + 30 * 24 * 60 * 60 * 1000).length;
  const projects = new Set(live.map((s) => s.job)).size;
  const skills = skillNames(person, roleById).join(", ");

  async function update(body: Record<string, unknown>, done: string) {
    setSaving(true);
    try {
      const saved = await pb.collection("crew_people").update<CrewPerson>(id, body);
      queryClient.setQueryData(["crew-people", id], saved);
      await queryClient.invalidateQueries({ queryKey: ["crew-people"] });
      setEditing(null);
      showToast("success", done);
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(archived: boolean) {
    if (archived) {
      const ok = await confirm({
        title: "Archive freelancer",
        message: `Archive ${person!.name}? They stay on the projects they've worked, but aren't offered for new ones. You can restore them any time.`,
        confirmLabel: "Archive",
      });
      if (!ok) return;
    }
    await update({ archived }, archived ? "Archived" : "Restored");
  }

  async function remove() {
    const ok = await confirm({ title: "Delete freelancer", message: `Delete ${person!.name}? This can't be undone.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await pb.collection("crew_people").delete(id);
      await queryClient.invalidateQueries({ queryKey: ["crew-people"] });
      showToast("success", `Deleted ${person!.name}`);
      navigate("/crew", { replace: true });
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  const card = (section: Section, title: string, children: ReactNode) => (
    <DetailCard
      title={title}
      editing={editing === section}
      canEdit={canEdit && editing === null}
      saving={saving}
      saveDisabled={section === "details" && !draft.name.trim()}
      onEdit={() => {
        setDraft(draftOf(person));
        setEditing(section);
      }}
      onCancel={() => setEditing(null)}
      onSave={() => update(Object.fromEntries(FIELDS[section].map((k) => [k, k === "name" ? draft.name.trim() : draft[k]])), "Saved")}
    >
      {children}
    </DetailCard>
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-4">
      <Breadcrumbs crumbs={[{ label: "Crew", to: "/crew" }, { label: person.name }]} />

      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-gray-900">{person.name}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{[member ? "Member" : "Freelancer", skills].filter(Boolean).join(" · ")}</p>
      </div>

      {person.archived &&
        (member ? (
          <div className="card bg-gray-50 px-4 py-2.5 text-sm text-gray-700">Left the organisation: not offered for new projects.</div>
        ) : (
          <div className="card bg-gray-50 px-4 py-2.5 text-sm text-gray-700 flex items-center justify-between gap-3 flex-wrap">
            <span>Archived: not offered for new projects.</span>
            {canEdit && (
              <button onClick={() => setArchived(false)} disabled={saving} className="btn-secondary py-1">
                Restore
              </button>
            )}
          </div>
        ))}

      <TabBar label="Crew member sections" tabs={TABS.map((t) => ({ ...t, count: t.key === "bookings" ? slots.length : undefined }))} current={tab} onOpen={openTab} />

      {tab === "general" ? (
        <div className="flex flex-col gap-4">
          <FactTiles>
            {[
              <Fact
                key="next"
                label="Next booked"
                value={!next ? "Nothing booked" : time(startOf(next)) <= now ? "On now" : shortDay(parseDate(startOf(next)) ?? new Date())}
                title={next ? slotTitle(next) : undefined}
              />,
              <Fact key="month" label="Next 30 days" value={month === 0 ? "Free" : `${month} slot${month === 1 ? "" : "s"}`} />,
              <Fact key="projects" label="Projects" value={projects === 0 ? "None yet" : String(projects)} />,
            ]}
          </FactTiles>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
            <div className="flex flex-col gap-4 min-w-0">
              {card(
                "details",
                "Details",
                <>
                  {member ? (
                    <DetailRow label="Name" value={person.name} />
                  ) : (
                    <DetailRow label="Name" value={person.name}>
                      <input value={draft.name} onChange={(e) => set("name", e.target.value)} maxLength={120} className="input py-1.5 w-full" autoFocus />
                    </DetailRow>
                  )}
                  <DetailRow label="Type" value={member ? "Member" : "Freelancer"} />
                </>,
              )}
              {card(
                "contact",
                "Contact",
                <>
                  <DetailRow label="Phone" value={person.phone ? <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className="hover:underline">{person.phone}</a> : null}>
                    <input value={draft.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} className="input py-1.5 w-full" />
                  </DetailRow>
                  {member ? (
                    <DetailRow label="Email" value={email ? <a href={`mailto:${email}`} className="hover:underline">{email}</a> : null} />
                  ) : (
                    <DetailRow label="Email" value={email ? <a href={`mailto:${email}`} className="hover:underline">{email}</a> : null}>
                      <input type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} className="input py-1.5 w-full" />
                    </DetailRow>
                  )}
                </>,
              )}
              {card(
                "skills",
                "Skills",
                <DetailRow label="Crew roles" value={skills} empty="None">
                  <SkillPicker value={draft.skills} levels={draft.skillLevels} onChange={(s, skillLevels) => setDraft((d) => ({ ...d, skills: s, skillLevels }))} roles={roles} />
                </DetailRow>,
              )}
            </div>
            <div className="flex flex-col gap-4 min-w-0">
              {card(
                "notes",
                "Notes",
                <DetailRow label="Internal notes" value={person.notes ? <span className="whitespace-pre-line">{person.notes}</span> : null}>
                  <textarea value={draft.notes} onChange={(e) => set("notes", e.target.value)} rows={3} maxLength={2000} className="input py-1.5 w-full" />
                </DetailRow>,
              )}
              <SlotsCard title="Coming up" slots={coming.slice(0, 5)} empty="Nothing booked." more={coming.length > 5 ? () => openTab("bookings") : undefined} />
            </div>
          </div>
          {canEdit && !member && (
            <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
              {!person.archived && (
                <button onClick={() => setArchived(true)} disabled={saving} className="btn-secondary">
                  Archive
                </button>
              )}
              <span title={slots.length > 0 ? "They've been on projects, so they can't be deleted. Archive them instead" : undefined}>
                <button onClick={remove} disabled={slots.length > 0} className="btn-secondary hover:text-fault-ink disabled:opacity-40 disabled:pointer-events-none">
                  Delete
                </button>
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <SlotsCard title="Coming up" slots={coming} empty="Nothing booked." />
          <SlotsCard title="Past" slots={past} empty="No past bookings." />
        </div>
      )}
    </div>
  );
}

// "#1042 Spring Gala · Pack in"
function slotTitle(s: Slot): string {
  const job = s.expand?.job;
  return [job ? `#${job.number} ${job.name}` : "A project", s.expand?.need?.expand?.period?.name].filter(Boolean).join(" · ");
}

// Their slots, each with its project, when, and what they're doing.
function SlotsCard({ title, slots, empty, more }: { title: string; slots: Slot[]; empty: string; more?: () => void }) {
  return (
    <section className="card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow text-gray-500">
          {title}
          {slots.length > 0 && <span className="ml-1.5 font-mono text-gray-400">{slots.length}</span>}
        </h2>
        {more && (
          <ArrowLink onClick={more}>All bookings</ArrowLink>
        )}
      </div>
      {slots.length === 0 ? (
        <p className="text-sm text-gray-500">{empty}</p>
      ) : (
        <div className="flex flex-col divide-y divide-gray-100 -mx-4">
          {slots.map((s) => {
            const job = s.expand?.job;
            const need = s.expand?.need;
            const doing = [need?.expand?.role?.name, need?.expand?.period?.name].filter(Boolean).join(" · ");
            return (
              <Link key={s.id} to={`/projects/${s.job}?tab=crew`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-gray-50">
                <span className="flex flex-col min-w-0">
                  <span className="text-gray-900 truncate">
                    {job ? (
                      <>
                        <span className="text-gray-400 tabular-nums">#{job.number}</span> {job.name}
                      </>
                    ) : (
                      "(deleted project)"
                    )}
                  </span>
                  <span className="text-xs text-gray-500 truncate">{[formatPeriod(startOf(s), endOf(s)), doing].filter(Boolean).join(" · ")}</span>
                </span>
                {job && <JobStatusBadge status={job.status} jobStatus={job.jobStatus} />}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

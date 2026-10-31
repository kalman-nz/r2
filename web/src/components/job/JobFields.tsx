import { DISCOUNT, type JobDraft } from "../../lib/jobDraft";
import { oneLineAddress } from "../../lib/format";
import { useContacts, useVenues } from "../../lib/catalog";
import Field from "../Field";
import QuickCreateSelect from "../QuickCreateSelect";
import { JOB_STAGES } from "../../lib/statuses";
import { useJobStatuses } from "../../lib/workflow";
import NumberInput from "../NumberInput";
import { COUNT, numberProblem } from "../../lib/numbers";
import { useCan } from "../../lib/roles";
import { JobStatusBadge } from "../StatusBadge";

export default function JobFields({
  draft,
  onChange,
  readOnly,
  withDates = false,
}: {
  draft: JobDraft;
  onChange: (draft: JobDraft) => void;
  readOnly: boolean;
  // Only when creating: after that the dates come from the Schedule tab.
  withDates?: boolean;
}) {
  const can = useCan();
  const { statuses, byId, defaultId } = useJobStatuses();
  // A new project shows where it'll start; the server fills the default in.
  const statusId = draft.jobStatus || (draft.status ? (statuses.find((s) => s.stage === draft.status)?.id ?? "") : defaultId);
  const stage = byId.get(statusId)?.stage ?? draft.status;
  const { data: contacts = [] } = useContacts();
  const { data: venues = [] } = useVenues();
  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) => onChange({ ...draft, [key]: value });
  // Out of edit mode the choices read as plain values, not disabled dropdowns.
  const plain = (value: string | undefined, empty: string) => (
    <span className={`py-2 text-sm ${value ? "text-gray-900" : "text-gray-400"}`}>{value || empty}</span>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
      <Field label="Project name" className="sm:col-span-2">
        <input
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          disabled={readOnly}
          placeholder="e.g. Spring Gala Dinner"
          className="input py-2"
        />
      </Field>
      <Field label="Client">
        {readOnly ? (
          plain(contacts.find((c) => c.id === draft.client)?.name, "No client")
        ) : (
          <QuickCreateSelect
            collection="contacts"
            value={draft.client}
            onChange={(id) => set("client", id)}
            options={contacts.map((c) => ({ id: c.id, name: c.name, archived: c.archived, detail: [c.contactPerson, c.email].filter(Boolean).join(" · ") }))}
            canCreate={can("contacts.create")}
            placeholder="No client"
          />
        )}
      </Field>
      <Field label="Location">
        {readOnly ? (
          plain(venues.find((v) => v.id === draft.venue)?.name, "No location")
        ) : (
          <QuickCreateSelect
            collection="venues"
            value={draft.venue}
            onChange={(id) => set("venue", id)}
            options={venues.map((v) => ({ id: v.id, name: v.name, archived: v.archived, detail: oneLineAddress(v.address) }))}
            canCreate={can("venues.create")}
            placeholder="No location"
          />
        )}
      </Field>
      <Field label="Status" hint={JOB_STAGES.find((s) => s.value === stage)?.hint}>
        {readOnly ? (
          <span className="py-2">
            <JobStatusBadge status={draft.status} jobStatus={draft.jobStatus} />
          </span>
        ) : (
          <select
            value={statusId}
            onChange={(e) => onChange({ ...draft, jobStatus: e.target.value, status: byId.get(e.target.value)?.stage ?? draft.status })}
            className="input py-2"
          >
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Client reference">
        {readOnly ? (
          plain(draft.reference, "None")
        ) : (
          <input value={draft.reference} onChange={(e) => set("reference", e.target.value)} className="input py-2" />
        )}
      </Field>
      {withDates && (
        <>
          <Field label="Equipment booked from">
            <input type="datetime-local" value={draft.prepAt} onChange={(e) => set("prepAt", e.target.value)} className="input py-2" />
          </Field>
          <Field label="Equipment booked until">
            <input type="datetime-local" value={draft.returnAt} onChange={(e) => set("returnAt", e.target.value)} className="input py-2" />
          </Field>
          <Field label="Billed from">
            <input type="datetime-local" value={draft.billingStart} onChange={(e) => set("billingStart", e.target.value)} className="input py-2" />
          </Field>
          <Field label="Billed until">
            <input type="datetime-local" value={draft.billingEnd} onChange={(e) => set("billingEnd", e.target.value)} className="input py-2" />
          </Field>
        </>
      )}
      {!readOnly && (
        <>
          <Field label="Project discount (%)" error={numberProblem(draft.discountPct, DISCOUNT)}>
            <NumberInput value={draft.discountPct} min={0} max={100} onChange={(n) => set("discountPct", n)} className="input py-2" />
          </Field>
          <Field label="Charge for days" error={numberProblem(draft.chargeDays, COUNT)}>
            <NumberInput value={draft.chargeDays} min={0} integer onChange={(n) => set("chargeDays", n)} className="input py-2" />
          </Field>
          <Field label="Notes on the quote" className="sm:col-span-2">
            <textarea
              value={draft.quoteNotes}
              onChange={(e) => set("quoteNotes", e.target.value)}
              rows={2}
              className="input py-2"
              placeholder="Shown to the client"
            />
          </Field>
        </>
      )}
      <Field label="Internal notes" className="sm:col-span-2">
        <textarea
          value={draft.notes}
          onChange={(e) => set("notes", e.target.value)}
          disabled={readOnly}
          rows={2}
          className="input py-2"
          placeholder="Crew, access, parking — not shown to the client"
        />
      </Field>
    </div>
  );
}

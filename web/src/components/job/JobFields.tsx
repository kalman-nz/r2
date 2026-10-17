import type { JobStatus } from "../../lib/api";
import type { JobDraft } from "../../lib/jobDraft";
import { useContacts, useVenues } from "../../lib/catalog";
import Field from "../Field";
import QuickCreateSelect from "../QuickCreateSelect";
import { JOB_STATUSES } from "../../lib/statuses";
import NumberInput from "../NumberInput";
import { useCan } from "../../lib/roles";

export default function JobFields({
  draft,
  onChange,
  readOnly,
}: {
  draft: JobDraft;
  onChange: (draft: JobDraft) => void;
  readOnly: boolean;
}) {
  const can = useCan();
  const { data: contacts = [] } = useContacts();
  const { data: venues = [] } = useVenues();
  const set = <K extends keyof JobDraft>(key: K, value: JobDraft[K]) => onChange({ ...draft, [key]: value });

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
        <QuickCreateSelect
          collection="contacts"
          value={draft.client}
          onChange={(id) => set("client", id)}
          options={contacts}
          disabled={readOnly}
          canCreate={can("contacts.create")}
          placeholder="No client"
        />
      </Field>
      <Field label="Location">
        <QuickCreateSelect
          collection="venues"
          value={draft.venue}
          onChange={(id) => set("venue", id)}
          options={venues}
          disabled={readOnly}
          canCreate={can("venues.create")}
          placeholder="No location"
        />
      </Field>
      <Field label="Status" hint={JOB_STATUSES.find((s) => s.value === draft.status)?.hint}>
        <select
          value={draft.status}
          onChange={(e) => set("status", e.target.value as JobStatus)}
          disabled={readOnly}
          className="input py-2"
        >
          {JOB_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Client reference" hint="Their PO number, if they have one">
        <input value={draft.reference} onChange={(e) => set("reference", e.target.value)} disabled={readOnly} className="input py-2" />
      </Field>
      <Field label="Prep" hint="Kit is held from here">
        <input type="datetime-local" value={draft.prepAt} onChange={(e) => set("prepAt", e.target.value)} disabled={readOnly} className="input py-2" />
      </Field>
      <Field label="Return" hint="Kit is held until it's back, plus turnaround">
        <input
          type="datetime-local"
          value={draft.returnAt}
          onChange={(e) => set("returnAt", e.target.value)}
          disabled={readOnly}
          className="input py-2"
        />
      </Field>
      <Field label="Show start" hint="Leave the show dates empty for a dry hire">
        <input
          type="datetime-local"
          value={draft.showStart}
          onChange={(e) => set("showStart", e.target.value)}
          disabled={readOnly}
          className="input py-2"
        />
      </Field>
      <Field label="Show end">
        <input type="datetime-local" value={draft.showEnd} onChange={(e) => set("showEnd", e.target.value)} disabled={readOnly} className="input py-2" />
      </Field>
      {!readOnly && (
        <>
          <Field label="Project discount (%)" hint="Applied after any line discounts">
            <NumberInput value={draft.discountPct} min={0} max={100} onChange={(n) => set("discountPct", n)} className="input py-2" />
          </Field>
          <Field label="Charge for days" hint="0 = work it out from the show dates (or prep → return)">
            <NumberInput value={draft.chargeDays} min={0} onChange={(n) => set("chargeDays", Math.round(n))} className="input py-2" />
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

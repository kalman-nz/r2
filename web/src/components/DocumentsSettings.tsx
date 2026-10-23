import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pb } from "../lib/pocketbase";
import type { DocumentField, DocumentFieldType, DocumentTemplate } from "../lib/api";
import { withOrg } from "../lib/currentOrg";
import { errorText } from "../lib/errors";
import { EQUIPMENT_MODES, FIELD_TYPES, newFieldId, useDocumentTemplates } from "../lib/documents";
import Field from "./Field";
import Switch from "./Switch";
import { useConfirm } from "./ConfirmProvider";
import { useToast } from "./ToastProvider";

type Draft = Pick<DocumentTemplate, "name" | "description" | "equipment" | "schedule" | "notes" | "fields">;

const BLANK: Draft = { name: "", description: "", equipment: "none", schedule: false, notes: false, fields: [{ id: newFieldId(), type: "heading", label: "Details" }] };
const draftOf = (t: DocumentTemplate): Draft => ({
  name: t.name,
  description: t.description,
  equipment: t.equipment || "none",
  schedule: t.schedule,
  notes: t.notes,
  fields: Array.isArray(t.fields) ? t.fields : [],
});

// Settings → Documents: the organisation's own project documents, printed
// from a project's Documents menu alongside the packing list. Each is the
// project's details, optionally its schedule, equipment and notes, then
// whatever parts the form needs: headings, instructions, answers, tick
// boxes, dates and signatures.
export default function DocumentsSettings() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const { data: templates = [], isLoading } = useDocumentTemplates();
  // The one being edited: an id, "new", or none.
  const [editing, setEditing] = useState<string>("");
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);
  const current = templates.find((t) => t.id === editing) ?? null;

  // Open the first one to start with.
  useEffect(() => {
    if (!editing && templates.length > 0) {
      setEditing(templates[0].id);
      setDraft(draftOf(templates[0]));
    }
  }, [editing, templates]);

  const changed = editing === "new" || (current !== null && JSON.stringify(draftOf(current)) !== JSON.stringify(draft));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["document-templates"] });

  async function open(id: string) {
    if (changed && !(await confirm({ title: "Discard changes", message: "Discard your changes to this document?", confirmLabel: "Discard", danger: true }))) return;
    if (id === "new") {
      setDraft({ ...BLANK, fields: [{ id: newFieldId(), type: "heading", label: "Details" }] });
    } else {
      const t = templates.find((x) => x.id === id);
      if (t) setDraft(draftOf(t));
    }
    setEditing(id);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing === "new") {
        const sortOrder = Math.max(0, ...templates.map((t) => t.sortOrder)) + 10;
        const created = await pb.collection("document_templates").create<DocumentTemplate>(withOrg({ ...draft, sortOrder }));
        await refresh();
        setEditing(created.id);
        setDraft(draftOf(created));
      } else {
        const saved = await pb.collection("document_templates").update<DocumentTemplate>(editing, draft);
        await refresh();
        setDraft(draftOf(saved));
      }
      showToast("success", `Saved ${draft.name}`);
    } catch (err) {
      showToast("error", `Couldn't save: ${errorText(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!current) return;
    const ok = await confirm({ title: "Delete document", message: `Delete ${current.name}? It's no longer offered on projects.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await pb.collection("document_templates").delete(current.id);
      await refresh();
      setEditing("");
      showToast("success", `Deleted ${current.name}`);
    } catch (err) {
      showToast("error", errorText(err));
    }
  }

  function copy() {
    if (!current) return;
    setDraft({ ...draftOf(current), name: `${current.name} (copy)`, fields: current.fields.map((f) => ({ ...f, id: newFieldId() })) });
    setEditing("new");
  }

  const setField = (i: number, f: DocumentField) => setDraft((d) => ({ ...d, fields: d.fields.map((x, j) => (j === i ? f : x)) }));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const fields = [...d.fields];
      const [f] = fields.splice(i, 1);
      fields.splice(Math.max(0, Math.min(fields.length, i + by)), 0, f);
      return { ...d, fields };
    });
  const addField = (type: DocumentFieldType) =>
    setDraft((d) => ({ ...d, fields: [...d.fields, { id: newFieldId(), type, label: type === "heading" ? "New section" : "" }] }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Documents</h2>
        <p className="text-sm text-gray-500">
          Forms to print from a project's Documents menu, alongside the packing list: a technical handover, a deprep checklist, or anything you use. Each
          starts with the project's details.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <div className="w-full md:w-56 shrink-0 card p-1.5 flex flex-col gap-0.5">
          {isLoading && <p className="px-2 py-1.5 text-sm text-gray-500">Loading…</p>}
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => open(t.id)}
              className={`text-left px-2.5 py-1.5 rounded-md text-sm ${editing === t.id ? "bg-gray-900/[0.06] font-medium text-gray-900" : "text-gray-700 hover:bg-gray-100"}`}
            >
              {t.name}
            </button>
          ))}
          {editing === "new" && <span className="px-2.5 py-1.5 rounded-md text-sm bg-gray-900/[0.06] font-medium text-gray-900">{draft.name || "New document"}</span>}
          <button onClick={() => open("new")} className="text-left px-2.5 py-1.5 rounded-md text-sm text-signal-ink hover:bg-gray-100">
            + New document
          </button>
        </div>

        {(editing === "new" || current) && (
          <div className="flex-1 min-w-0 w-full card p-4 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input py-2" placeholder="Technical handover" />
              </Field>
              <Field label="Description" hint="Shown in the Documents menu">
                <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="input py-2" />
              </Field>
              <Field label="Equipment" hint={EQUIPMENT_MODES.find((m) => m.value === draft.equipment)?.hint}>
                <select value={draft.equipment} onChange={(e) => setDraft({ ...draft, equipment: e.target.value as Draft["equipment"] })} className="input py-2">
                  {EQUIPMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex flex-col gap-2 justify-center">
                <Switch label="Show the schedule" checked={draft.schedule} onChange={(schedule) => setDraft({ ...draft, schedule })} />
                <Switch label="Show the project's notes" checked={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-gray-500">Parts, in order</span>
              {draft.fields.length === 0 && <p className="text-sm text-gray-400">No parts yet: add some below.</p>}
              {draft.fields.map((f, i) => (
                <div key={f.id} className={`flex items-start gap-1.5 ${f.type === "heading" ? "pt-2" : ""}`}>
                  <select
                    value={f.type}
                    onChange={(e) => setField(i, { ...f, type: e.target.value as DocumentFieldType })}
                    className="input w-36 shrink-0 py-1.5"
                    aria-label="Kind of part"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {f.type === "note" ? (
                    <textarea
                      value={f.label}
                      onChange={(e) => setField(i, { ...f, label: e.target.value })}
                      rows={2}
                      className="input flex-1 min-w-0 py-1.5"
                      placeholder="Text to print"
                    />
                  ) : (
                    <input
                      value={f.label}
                      onChange={(e) => setField(i, { ...f, label: e.target.value })}
                      className={`input flex-1 min-w-0 py-1.5 ${f.type === "heading" ? "font-semibold" : ""}`}
                      placeholder={FIELD_TYPES.find((t) => t.value === f.type)?.hint}
                    />
                  )}
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="btn-secondary px-2 py-1.5 disabled:opacity-30" aria-label="Move up">
                    ↑
                  </button>
                  <button
                    onClick={() => move(i, 1)}
                    disabled={i === draft.fields.length - 1}
                    className="btn-secondary px-2 py-1.5 disabled:opacity-30"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))}
                    className="btn-secondary px-2 py-1.5 hover:text-fault-ink"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <span className="text-xs text-gray-500">Add</span>
                {FIELD_TYPES.map((t) => (
                  <button key={t.value} onClick={() => addField(t.value)} className="btn-secondary py-1 text-xs" title={t.hint}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
              <button onClick={save} disabled={saving || !changed || !draft.name.trim()} className="btn-primary">
                {saving ? "Saving…" : editing === "new" ? "Create document" : "Save"}
              </button>
              {editing === "new" ? (
                <button onClick={() => open(templates[0]?.id ?? "")} className="btn-secondary">
                  Cancel
                </button>
              ) : (
                <>
                  <button onClick={copy} className="btn-secondary">
                    Copy
                  </button>
                  <button onClick={remove} className="btn-secondary hover:text-fault-ink ml-auto">
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { LabelTemplateData } from "../lib/labelSpec";
import { useConfirm } from "../components/ConfirmProvider";
import { useToast } from "../components/ToastProvider";

// A template as it comes back from GET /api/labels, minus the DB-assigned
// fields that shouldn't be carried over when re-importing (id would collide,
// createdAt/updatedAt aren't meaningful for a freshly created row).
type ExportedTemplate = Omit<LabelTemplateData, "id">;

function isExportedTemplate(value: unknown): value is ExportedTemplate {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.name === "string" && typeof t.widthMm === "number" && typeof t.heightMm === "number" && Array.isArray(t.elements);
}

export default function LabelsList() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const confirm = useConfirm();
  const { showToast } = useToast();

  async function remove(id: string, name: string) {
    const ok = await confirm({
      title: "Delete label template",
      message: `Delete "${name}"? This can't be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteLabel(id);
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
      showToast("success", `Deleted "${name}"`);
    } catch (err) {
      showToast("error", `Couldn't delete "${name}": ${(err as Error).message}`);
    }
  }

  function downloadTemplates(toExport: (LabelTemplateData & { id: string })[], filename: string) {
    const payload: ExportedTemplate[] = toExport.map(({ name, widthMm, heightMm, elements }) => ({
      name,
      widthMm,
      heightMm,
      elements,
    }));
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAll() {
    if (!templates || templates.length === 0) return;
    downloadTemplates(templates, `label-templates-${new Date().toISOString().slice(0, 10)}.json`);
  }

  function exportOne(template: LabelTemplateData & { id: string }) {
    const slug = template.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "label";
    downloadTemplates([template], `${slug}.json`);
  }

  async function importFromFile(file: File) {
    setImporting(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const valid = candidates.filter(isExportedTemplate);
      if (valid.length === 0) {
        showToast("error", "No valid label templates found in that file.");
        return;
      }
      let failed = 0;
      for (const template of valid) {
        try {
          await api.createLabel(template);
        } catch {
          failed++;
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["labels"] });
      const skipped = candidates.length - valid.length;
      const imported = valid.length - failed;
      const summary =
        `Imported ${imported} template${imported === 1 ? "" : "s"}.` +
        (failed ? ` ${failed} failed.` : "") +
        (skipped ? ` ${skipped} skipped (not a valid template).` : "");
      showToast(failed || skipped ? "error" : "success", summary);
    } catch {
      showToast("error", "Couldn't read that file — make sure it's a label templates JSON export.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-2">
          <button onClick={exportAll} disabled={!templates || templates.length === 0} className="btn-secondary">
            Export all
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={importing} className="btn-secondary">
            {importing ? "Importing…" : "Import"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFromFile(file);
            }}
          />
          <Link to="/labels/new" className="btn-primary">
            New template
          </Link>
        </div>
      </div>

      {isLoading && <p className="text-gray-500 text-sm">Loading…</p>}

      <div className="card divide-y divide-gray-100 overflow-hidden">
        {templates?.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-gray-50">
            <Link to={`/labels/${t.id}`} className="flex flex-col">
              <span className="font-medium text-gray-900">{t.name}</span>
              <span className="text-gray-500 text-xs">
                {t.widthMm}×{t.heightMm}mm · {t.elements.length} element{t.elements.length === 1 ? "" : "s"}
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <button onClick={() => exportOne(t)} className="text-gray-400 hover:text-gray-900 text-xs">
                Export
              </button>
              <button onClick={() => remove(t.id, t.name)} className="text-gray-400 hover:text-red-600 text-xs">
                Delete
              </button>
            </div>
          </div>
        ))}
        {!isLoading && templates?.length === 0 && (
          <p className="px-4 py-6 text-gray-500 text-sm">No templates yet — create one to start printing labels.</p>
        )}
      </div>
    </div>
  );
}

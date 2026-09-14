import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { LabelTemplateData } from "../lib/labelSpec";
import { useToast } from "./ToastProvider";
import NumberInput from "./NumberInput";
import LabelPreviewModal from "./LabelPreviewModal";

type Template = LabelTemplateData & { id: string; isDefault: boolean };

// Generic over what's being bulk-printed — a batch of individual serial
// numbers (EquipmentDetail) or a batch of equipment *types* (Assets list) —
// the caller supplies how to render and send each one.
export default function BatchPrintBar<T>({
  items,
  getDisplayName,
  renderImage,
  sendPrint,
  onDone,
}: {
  items: T[];
  getDisplayName: (item: T) => string;
  renderImage: (item: T, template: Template) => Promise<string>;
  sendPrint: (imageDataUrl: string, template: Template, item: T) => Promise<{ ok: boolean; message: string }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copies, setCopies] = useState(1);
  const [preview, setPreview] = useState<{ template: Template; image: string | null } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const { showToast } = useToast();

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels, enabled: open });
  const sortedTemplates = useMemo<Template[]>(() => {
    const list = (templates ?? []).map((t) => ({ ...t, isDefault: t.id === settings?.defaultTemplateId }));
    list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return list;
  }, [templates, settings?.defaultTemplateId]);

  async function openPreview(templateId: string) {
    const template = sortedTemplates.find((t) => t.id === templateId);
    if (!template || items.length === 0) return;
    setOpen(false);
    setPreview({ template, image: null });
    const image = await renderImage(items[0], template);
    setPreview({ template, image });
  }

  async function confirmPrint() {
    if (!preview) return;
    const template = preview.template;
    setPreview(null);
    const failed: string[] = [];
    const total = items.length * copies;
    setProgress({ done: 0, total, failed });

    // Sequential, not parallel — the printer processes one job at a time and
    // flooding it with concurrent requests risks jobs arriving out of order
    // or overwhelming the network backend.
    let done = 0;
    for (const item of items) {
      // First item's copies reuse the already-rendered preview image; every
      // other item still needs its own render (different label content).
      const isFirst = item === items[0];
      for (let copy = 0; copy < copies; copy++) {
        try {
          const image = isFirst && copy === 0 && preview.image ? preview.image : await renderImage(item, template);
          const result = await sendPrint(image, template, item);
          if (!result.ok) failed.push(getDisplayName(item));
        } catch {
          failed.push(getDisplayName(item));
        }
        done++;
        setProgress({ done, total, failed: [...failed] });
      }
    }

    if (failed.length === 0) {
      showToast("success", `Printed ${total} label${total === 1 ? "" : "s"}`);
      setTimeout(() => {
        setProgress(null);
        onDone();
      }, 1500);
    } else {
      showToast("error", `${failed.length}/${total} labels failed to print: ${failed.join(", ")}`);
    }
  }

  if (progress) {
    return (
      <div className="flex items-center gap-3 card px-4 py-2 text-sm text-gray-700">
        <span>
          Printing {progress.done}/{progress.total}…
        </span>
        {progress.failed.length > 0 && <span className="text-red-600">Failed: {progress.failed.join(", ")}</span>}
        {progress.done === progress.total && progress.failed.length > 0 && (
          <button onClick={() => setProgress(null)} className="text-gray-500 hover:text-gray-900 ml-auto">
            Dismiss
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-3 card px-4 py-2 text-sm">
      <span className="font-medium text-gray-900">{items.length} selected</span>

      <label className="flex items-center gap-2 text-gray-500">
        Copies each
        <NumberInput min={1} value={copies} onChange={setCopies} className="w-14 input py-1" />
      </label>

      <button onClick={() => setOpen((v) => !v)} className="btn-primary">
        Print {items.length * copies} label{items.length * copies === 1 ? "" : "s"}
      </button>
      <button onClick={onDone} className="text-gray-500 hover:text-gray-900 ml-auto">
        Clear selection
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-56 card shadow-lg z-20 overflow-hidden">
          {templates === undefined && <p className="px-3 py-3 text-sm text-gray-500">Loading templates…</p>}
          {templates?.length === 0 && (
            <p className="px-3 py-3 text-sm text-gray-500">
              No label templates yet.{" "}
              <Link to="/labels/new" className="text-blue-600 underline">
                Create one
              </Link>
              .
            </p>
          )}
          {sortedTemplates.map((t) => (
            <button
              key={t.id}
              onClick={() => openPreview(t.id)}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              {t.name}
              {t.isDefault && <span className="text-[#167cfb]"> · default</span>}
              <span className="text-gray-500"> · {t.widthMm}×{t.heightMm}mm</span>
            </button>
          ))}
        </div>
      )}

      {preview && (
        <LabelPreviewModal
          title={preview.template.name}
          subtitle={`Preview of "${getDisplayName(items[0])}" · ${items.length} item${items.length === 1 ? "" : "s"} × ${copies} ${copies === 1 ? "copy" : "copies"}`}
          imageDataUrl={preview.image}
          copies={copies}
          onCopiesChange={setCopies}
          onConfirm={confirmPrint}
          onCancel={() => setPreview(null)}
          printing={false}
        />
      )}
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { LabelTemplateData } from "../lib/labelSpec";
import { useToast } from "./ToastProvider";
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
  const [copies, setCopies] = useState(1);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: string[] } | null>(null);
  const { showToast } = useToast();

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const sortedTemplates = useMemo<Template[]>(() => {
    const list = (templates ?? []).map((t) => ({ ...t, isDefault: t.id === settings?.defaultTemplateId }));
    list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return list;
  }, [templates, settings?.defaultTemplateId]);

  async function renderTemplate(template: Template) {
    if (items.length === 0) return;
    setImage(null);
    setImage(await renderImage(items[0], template));
  }

  function openPreview() {
    if (sortedTemplates.length === 0) {
      showToast("error", "No label templates yet — create one in Settings > Label templates.");
      return;
    }
    const template = sortedTemplates[0];
    setTemplateId(template.id);
    renderTemplate(template);
  }

  function changeTemplate(id: string) {
    const template = sortedTemplates.find((t) => t.id === id);
    if (!template) return;
    setTemplateId(id);
    renderTemplate(template);
  }

  async function confirmPrint() {
    const template = sortedTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const previewImage = image;
    setTemplateId(null);
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
          const renderedImage = isFirst && copy === 0 && previewImage ? previewImage : await renderImage(item, template);
          const result = await sendPrint(renderedImage, template, item);
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

  const selected = sortedTemplates.find((t) => t.id === templateId);

  return (
    <div className="flex items-center gap-3 card px-4 py-2 text-sm">
      <span className="font-medium text-gray-900">{items.length} selected</span>

      <button onClick={openPreview} disabled={templates === undefined} className="btn-primary">
        Print
      </button>
      <button onClick={onDone} className="text-gray-500 hover:text-gray-900 ml-auto">
        Clear selection
      </button>

      {selected && (
        <LabelPreviewModal
          templates={sortedTemplates}
          selectedTemplateId={selected.id}
          onTemplateChange={changeTemplate}
          subtitle={`Preview of "${getDisplayName(items[0])}" · ${items.length} item${items.length === 1 ? "" : "s"} × ${copies} ${copies === 1 ? "copy" : "copies"}`}
          imageDataUrl={image}
          copies={copies}
          onCopiesChange={setCopies}
          onConfirm={confirmPrint}
          onCancel={() => setTemplateId(null)}
          printing={false}
        />
      )}
    </div>
  );
}

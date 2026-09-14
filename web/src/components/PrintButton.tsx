import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { renderContextImage, sendRenderedLabel } from "../lib/print";
import type { LabelDataContext, LabelTemplateData } from "../lib/labelSpec";
import { useToast } from "./ToastProvider";
import LabelPreviewModal from "./LabelPreviewModal";

type Template = LabelTemplateData & { id: string; isDefault: boolean };

export default function PrintButton({
  context,
  rentmanSerialNumberId,
  label = "Print label",
}: {
  context: LabelDataContext;
  rentmanSerialNumberId?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ template: Template; image: string | null } | null>(null);
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
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
    if (!template) return;
    setOpen(false);
    setCopies(1);
    setPreview({ template, image: null });
    const image = await renderContextImage(context, template);
    setPreview({ template, image });
  }

  async function confirmPrint() {
    if (!preview?.image) return;
    setPrinting(true);
    try {
      let failed = 0;
      for (let i = 0; i < copies; i++) {
        const result = await sendRenderedLabel(preview.image, preview.template, rentmanSerialNumberId);
        if (!result.ok) failed++;
      }
      if (failed === 0) {
        showToast("success", `Printed ${copies > 1 ? `${copies} labels` : "label"}`);
      } else {
        showToast("error", `${failed}/${copies} copies failed to print`);
      }
      setPreview(null);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary">
        {label}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 card shadow-lg z-20 overflow-hidden">
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
          subtitle={`${preview.template.widthMm}×${preview.template.heightMm}mm`}
          imageDataUrl={preview.image}
          copies={copies}
          onCopiesChange={setCopies}
          onConfirm={confirmPrint}
          onCancel={() => setPreview(null)}
          printing={printing}
        />
      )}
    </div>
  );
}

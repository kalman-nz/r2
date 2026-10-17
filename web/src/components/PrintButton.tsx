import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { downloadLabelsPdf, renderContextImage, sendRenderedLabel } from "../lib/print";
import { errorText } from "../lib/errors";
import type { LabelDataContext, LabelTemplateData } from "../lib/labelSpec";
import { useToast } from "./ToastProvider";
import LabelPreviewModal from "./LabelPreviewModal";
import { useCan } from "../lib/roles";

type Template = LabelTemplateData & { id: string; isDefault: boolean };

// Hidden from roles without labels.print.
export default function PrintButton(props: { context: LabelDataContext; serialId?: string; label?: string }) {
  return useCan()("labels.print") ? <PrintButtonInner {...props} /> : null;
}

function PrintButtonInner({
  context,
  serialId,
  label = "Print label",
}: {
  context: LabelDataContext;
  serialId?: string;
  label?: string;
}) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { showToast } = useToast();

  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: templates } = useQuery({ queryKey: ["labels"], queryFn: api.listLabels });
  const sortedTemplates = useMemo<Template[]>(() => {
    const list = (templates ?? []).map((t) => ({ ...t, isDefault: t.id === settings?.defaultTemplateId }));
    list.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return list;
  }, [templates, settings?.defaultTemplateId]);

  async function renderTemplate(template: Template) {
    setImage(null);
    setImage(await renderContextImage(context, template));
  }

  function openPreview() {
    if (sortedTemplates.length === 0) {
      showToast("error", "No label templates yet — create one in Settings > Label templates.");
      return;
    }
    const template = sortedTemplates[0];
    setCopies(1);
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
    if (!template || !image) return;
    setPrinting(true);
    try {
      let failed = 0;
      for (let i = 0; i < copies; i++) {
        const result = await sendRenderedLabel(image, template, serialId);
        if (!result.ok) failed++;
      }
      if (failed === 0) {
        showToast("success", `Printed ${copies > 1 ? `${copies} labels` : "label"}`);
      } else {
        showToast("error", `${failed}/${copies} copies failed to print`);
      }
      setTemplateId(null);
    } catch (err) {
      showToast("error", `Print failed: ${(err as Error).message}`);
    } finally {
      setPrinting(false);
    }
  }

  async function downloadPdf() {
    const template = sortedTemplates.find((t) => t.id === templateId);
    if (!template || !image) return;
    setDownloading(true);
    try {
      await downloadLabelsPdf([{ imageDataUrl: image, widthMm: template.widthMm, heightMm: template.heightMm, copies }]);
      setTemplateId(null);
    } catch (err) {
      showToast("error", errorText(err));
    } finally {
      setDownloading(false);
    }
  }

  const selected = sortedTemplates.find((t) => t.id === templateId);

  return (
    <>
      <button onClick={openPreview} disabled={templates === undefined} className="btn-secondary">
        {label}
      </button>

      {selected && (
        <LabelPreviewModal
          templates={sortedTemplates}
          selectedTemplateId={selected.id}
          onTemplateChange={changeTemplate}
          imageDataUrl={image}
          copies={copies}
          onCopiesChange={setCopies}
          onConfirm={confirmPrint}
          onCancel={() => setTemplateId(null)}
          printing={printing}
          onDownloadPdf={downloadPdf}
          downloading={downloading}
        />
      )}
    </>
  );
}

import NumberInput from "./NumberInput";
import { isBrotherWidth } from "../lib/labelSpec";

export interface TemplateOption {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isDefault?: boolean;
}

// Shown as soon as "Print" is clicked — picking the template happens right
// here (not in a separate menu beforehand) so switching templates and
// seeing the result is one step, not two. Catches "wrong template" /
// "wrong asset" mistakes before they cost a piece of label tape.
// imageDataUrl is a render of exactly what will print (same canvas the
// print pipeline sends), not an approximation.
export default function LabelPreviewModal({
  templates,
  selectedTemplateId,
  onTemplateChange,
  subtitle,
  imageDataUrl,
  copies,
  onCopiesChange,
  onConfirm,
  onCancel,
  printing,
  onDownloadPdf,
  downloading = false,
}: {
  templates: TemplateOption[];
  selectedTemplateId: string;
  onTemplateChange: (id: string) => void;
  subtitle?: string;
  imageDataUrl: string | null;
  copies: number;
  onCopiesChange: (n: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  printing: boolean;
  // Any printer with a driver (Zebra, Dymo, Brother over USB): one PDF page
  // per label at its real size.
  onDownloadPdf?: () => void;
  downloading?: boolean;
}) {
  const selected = templates.find((t) => t.id === selectedTemplateId);
  const brother = selected ? isBrotherWidth(selected.widthMm) : true;
  return (
    <div onClick={onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm card p-5 shadow-xl flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <select
            value={selectedTemplateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            className="input py-1.5 text-sm font-semibold text-gray-900"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.widthMm}×{t.heightMm}mm){t.isDefault ? " · default" : ""}
              </option>
            ))}
          </select>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>

        <div className="flex items-center justify-center border border-gray-200 rounded-lg p-6 bg-gray-100 min-h-32">
          {imageDataUrl ? (
            <img src={imageDataUrl} alt="Label preview" className="max-w-full bg-white shadow-sm" />
          ) : (
            <span className="text-sm text-gray-400">Rendering…</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            Copies
            <NumberInput min={1} value={copies} onChange={onCopiesChange} className="w-16 input py-1" />
          </label>
          <div className="flex items-center gap-2">
            <button onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
            {onDownloadPdf && (
              <button onClick={onDownloadPdf} disabled={downloading || !imageDataUrl} className="btn-secondary">
                {downloading ? "Making PDF…" : "PDF"}
              </button>
            )}
            <button onClick={onConfirm} disabled={printing || !imageDataUrl || !brother} className="btn-primary">
              {printing ? "Printing…" : `Print ${copies > 1 ? `${copies} copies` : "label"}`}
            </button>
          </div>
        </div>
        {!brother && (
          <p className="text-xs text-amber-700 -mt-2">
            This template isn't a Brother tape width, so it can't go to the label printer. Download the PDF and print it from a
            Zebra or other label printer.
          </p>
        )}
      </div>
    </div>
  );
}

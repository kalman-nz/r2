import NumberInput from "./NumberInput";

// Shown after picking a template and before it actually goes to the
// printer — catches "wrong template" / "wrong asset" mistakes before they
// cost a piece of label tape. imageDataUrl is a render of exactly what will
// print (same canvas the print pipeline sends), not an approximation.
export default function LabelPreviewModal({
  title,
  subtitle,
  imageDataUrl,
  copies,
  onCopiesChange,
  onConfirm,
  onCancel,
  printing,
}: {
  title: string;
  subtitle?: string;
  imageDataUrl: string | null;
  copies: number;
  onCopiesChange: (n: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  printing: boolean;
}) {
  return (
    <div onClick={onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm card p-5 shadow-xl flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
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
            <button onClick={onConfirm} disabled={printing || !imageDataUrl} className="btn-primary">
              {printing ? "Printing…" : `Print ${copies > 1 ? `${copies} copies` : "label"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

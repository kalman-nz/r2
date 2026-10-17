import { useEffect, type ReactNode } from "react";

// Overlay + card, closed by Escape or clicking outside. Same look as the
// confirm dialog and the label preview.
export default function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-3xl" : "max-w-lg"} card p-5 shadow-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none" aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

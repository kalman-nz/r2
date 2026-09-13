import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { generateId } from "../lib/id";

interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

interface ToastContextValue {
  showToast: (type: Toast["type"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const SUCCESS_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((type: Toast["type"], message: string) => {
    setToasts((prev) => [...prev, { id: generateId(), type, message }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// Owns its own enter/exit animation state — a plain map over `toasts` in the
// parent can't animate removal, since the element would already be gone from
// the DOM by the time a transition could run. This mounts hidden, flips
// visible next frame (enter transition), and on dismiss flips back before
// asking the parent to actually remove it (exit transition), via
// onTransitionEnd rather than a second hand-timed setTimeout.
function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (toast.type !== "success") return;
    const timer = setTimeout(() => setLeaving(true), SUCCESS_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.type]);

  return (
    <div
      onTransitionEnd={(e) => {
        if (e.propertyName === "opacity" && leaving) onDone();
      }}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg transition-all duration-200 ease-out ${
        visible && !leaving ? "opacity-100 translate-x-0 translate-y-0" : "opacity-0 translate-x-4"
      } ${
        toast.type === "error"
          ? "bg-red-50 border-red-200 text-red-700"
          : "bg-emerald-50 border-emerald-200 text-emerald-700"
      }`}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.type === "error" && (
        <button onClick={() => setLeaving(true)} className="text-red-500 hover:text-red-700 shrink-0">
          ×
        </button>
      )}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

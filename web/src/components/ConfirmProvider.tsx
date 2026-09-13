import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button — for destructive actions like delete
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

const TRANSITION_MS = 150;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [visible, setVisible] = useState(false);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...options, resolve });
    });
  }, []);

  useEffect(() => {
    if (!state) return;
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const close = useCallback(
    (result: boolean) => {
      setVisible(false);
      setTimeout(() => {
        state?.resolve(result);
        setState(null);
      }, TRANSITION_MS);
    },
    [state],
  );

  useEffect(() => {
    if (!state) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          onClick={() => close(false)}
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 transition-opacity duration-150 ease-out ${
            visible ? "opacity-100" : "opacity-0"
          }`}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-lg border border-gray-200 bg-white p-5 shadow-xl flex flex-col gap-4 transition-all duration-150 ease-out ${
              visible ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
          >
            {state.title && <h2 className="text-sm font-semibold text-gray-900">{state.title}</h2>}
            <p className="text-sm text-gray-600">{state.message}</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => close(false)} className="btn-secondary">
                {state.cancelLabel ?? "Cancel"}
              </button>
              <button onClick={() => close(true)} autoFocus className={state.danger ? "btn-danger" : "btn-primary"}>
                {state.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

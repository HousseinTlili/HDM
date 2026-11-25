import { X } from "lucide-react";
import { useUiStore } from "../../store/uiStore";

export function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const dismissToast = useUiStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
    >
      {toasts.map((toast) => {
        const dotClass =
          toast.kind === "success"
            ? "bg-status-connected"
            : toast.kind === "error"
            ? "bg-primary"
            : "bg-on-surface-variant";
        const borderClass =
          toast.kind === "success"
            ? "border-status-connected/40"
            : toast.kind === "error"
            ? "border-primary/50"
            : "border-outline";

        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface-container border ${borderClass}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
              <span className="font-body text-body-sm text-on-surface break-words">
                {toast.text}
              </span>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="inline-flex items-center justify-center w-5 h-5 rounded-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high shrink-0"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

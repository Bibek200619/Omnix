"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Portal } from "@/components/ui/Portal";

type ToastVariant = "info" | "success" | "warning" | "error";

type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastRecord = Required<Pick<ToastInput, "message" | "variant" | "durationMs">> & {
  id: string;
  title?: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput | string) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function toastId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: ToastInput | string) => {
      const nextToast = typeof toast === "string" ? { message: toast } : toast;
      const id = toastId();
      const durationMs = nextToast.durationMs ?? 3600;
      setToasts((current) => [
        ...current.slice(-3),
        {
          id,
          title: nextToast.title,
          message: nextToast.message,
          variant: nextToast.variant ?? "success",
          durationMs,
        },
      ]);
      if (durationMs > 0) {
        const timer = window.setTimeout(() => dismissToast(id), durationMs);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismissToast],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal>
        <div className="pointer-events-none fixed right-4 top-4 z-[220] flex w-[min(24rem,calc(100vw_-_2rem))] flex-col gap-3">
          {toasts.map((toast) => (
            <Alert key={toast.id} variant={toast.variant} title={toast.title} className="pointer-events-auto relative pr-11 shadow-[var(--omnix-glow-sm)] backdrop-blur-xl">
              {toast.message}
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md text-current/70 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                aria-label="Dismiss notification"
                title="Dismiss notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Alert>
          ))}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}

import type { ToastInput } from "@/lib/toast-context";

type ShowToast = (toast: ToastInput | string) => string;

type UndoToastInput = {
  title: string;
  message: string;
  onUndo: () => void | Promise<void>;
  durationMs?: number;
};

export function showUndoToast(
  showToast: ShowToast,
  { title, message, onUndo, durationMs = 8000 }: UndoToastInput,
) {
  return showToast({
    title,
    message,
    durationMs,
    action: {
      label: "Undo",
      onClick: onUndo,
    },
  });
}

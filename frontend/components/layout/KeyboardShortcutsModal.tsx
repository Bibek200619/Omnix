"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type KeyboardShortcutsModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

const shortcuts = [
  { shortcut: "⌘K", action: "Open command palette" },
  { shortcut: "?", action: "Show keyboard shortcuts" },
  { shortcut: "Escape", action: "Close modal / palette" },
  { shortcut: "↑↓", action: "Navigate command palette" },
  { shortcut: "Enter", action: "Execute command" },
];

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard shortcuts" className="max-w-md">
      <Modal.Header>
        <div className="min-w-0">
          <h2 className="omnix-display text-lg font-semibold text-white">
            Keyboard shortcuts
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 rounded-md border-white/10 text-white/70 hover:bg-white/[0.08] hover:text-white"
          aria-label="Close keyboard shortcuts"
          title="Close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </Modal.Header>
      <Modal.Body className="p-0">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="border-b border-[var(--omnix-border)] bg-white/[0.03] text-[10px] uppercase text-[var(--omnix-text-3)]">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold sm:px-6">
                Shortcut
              </th>
              <th scope="col" className="px-4 py-3 font-semibold sm:px-6">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--omnix-border)]">
            {shortcuts.map((item) => (
              <tr key={item.shortcut} className="text-[var(--omnix-text-2)]">
                <td className="w-32 px-4 py-3 sm:px-6">
                  <kbd className="inline-flex min-h-7 items-center rounded-md border border-white/10 bg-white/[0.06] px-2 text-xs font-semibold text-white shadow-[inset_0_1px_0_var(--omnix-rgba-255-255-255-0-05)]">
                    {item.shortcut}
                  </kbd>
                </td>
                <td className="px-4 py-3 text-white/80 sm:px-6">{item.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Modal.Body>
    </Modal>
  );
}

"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type DestructiveConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
};

type WorkspaceDestructiveConfirmationModalProps = {
  confirmation: DestructiveConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function useWorkspaceDestructiveConfirmation() {
  const [confirmation, setConfirmation] = useState<DestructiveConfirmation | null>(null);

  const confirmDestructiveAction = useCallback(
    (nextConfirmation: Omit<DestructiveConfirmation, "resolve">) =>
      new Promise<boolean>((resolve) => {
        setConfirmation({ ...nextConfirmation, resolve });
      }),
    [],
  );

  const cancelDestructiveConfirmation = useCallback(() => {
    setConfirmation((current) => {
      current?.resolve(false);
      return null;
    });
  }, []);

  const approveDestructiveConfirmation = useCallback(() => {
    setConfirmation((current) => {
      current?.resolve(true);
      return null;
    });
  }, []);

  return {
    confirmation,
    confirmDestructiveAction,
    cancelDestructiveConfirmation,
    approveDestructiveConfirmation,
  };
}

export function WorkspaceDestructiveConfirmationModal({
  confirmation,
  onCancel,
  onConfirm,
}: WorkspaceDestructiveConfirmationModalProps) {
  return (
    <Modal
      isOpen={Boolean(confirmation)}
      onClose={onCancel}
      title={confirmation?.title || "Confirm destructive action"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmation?.confirmLabel || "Confirm"}
          </Button>
        </>
      }
    >
      <Modal.Header>
        <div>
          <p className="text-base font-semibold text-white">{confirmation?.title || "Confirm destructive action"}</p>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">This action needs confirmation before it runs.</p>
        </div>
      </Modal.Header>
      <Modal.Body>
        <p className="text-sm leading-6 text-[var(--omnix-text)]">{confirmation?.description}</p>
      </Modal.Body>
    </Modal>
  );
}

"use client";

import { useEffect, useId } from "react";
import type { HTMLAttributes, MouseEvent, ReactNode } from "react";
import { Portal } from "@/components/ui/Portal";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { cn } from "@/lib/utils";

type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  backdropClassName?: string;
  footerClassName?: string;
};

function ModalRoot({
  isOpen,
  onClose,
  title,
  children,
  footer,
  className,
  backdropClassName,
  footerClassName,
}: ModalProps) {
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, undefined, { isolateBackground: true });
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  return (
    <Portal>
      <div
        className={cn("omnix-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4 backdrop-blur-md", backdropClassName)}
        onMouseDown={handleBackdropMouseDown}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className={cn("omnix-modal-card relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden", className)}
        >
          <span id={titleId} className="sr-only">{title}</span>
          {children}
          {footer ? <ModalFooter className={footerClassName}>{footer}</ModalFooter> : null}
        </div>
      </div>
    </Portal>
  );
}

function ModalHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative z-10 flex shrink-0 items-start justify-between gap-4 border-b border-[var(--omnix-border)] p-4 sm:p-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ModalBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("omnix-scrollbar relative z-10 min-h-0 flex-1 overflow-y-auto p-4 sm:p-6", className)} {...props}>
      {children}
    </div>
  );
}

function ModalFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative z-10 flex shrink-0 items-center justify-end gap-3 border-t border-[var(--omnix-border)] bg-black/20 p-4 pb-safe sm:px-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export const Modal = Object.assign(ModalRoot, {
  Header: ModalHeader,
  Body: ModalBody,
  Footer: ModalFooter,
});

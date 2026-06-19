"use client";

import type { CSSProperties, ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type FloatingPlacement = "bottom-start" | "bottom-end";
type FloatingWidth = number | "anchor";

type FloatingMenuLayerProps<T extends HTMLElement = HTMLElement> = {
  anchorRef: RefObject<T | null>;
  children: ReactNode;
  className?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
  minWidth?: number;
  offset?: number;
  placement?: FloatingPlacement;
  width?: FloatingWidth;
  zIndex?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function FloatingMenuLayer<T extends HTMLElement = HTMLElement>({
  anchorRef,
  children,
  className,
  contentRef,
  minWidth = 0,
  offset = 8,
  placement = "bottom-end",
  width = 256,
  zIndex = 140,
}: FloatingMenuLayerProps<T>) {
  const [mounted, setMounted] = useState(false);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!mounted) return;

    function updatePosition() {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const maxViewportWidth = Math.max(0, viewportWidth - margin * 2);
      const desiredWidth = width === "anchor" ? rect.width : width;
      const menuWidth = Math.min(Math.max(desiredWidth, minWidth), maxViewportWidth);
      const rawLeft = placement === "bottom-start" ? rect.left : rect.right - menuWidth;
      const left = clamp(rawLeft, margin, Math.max(margin, viewportWidth - menuWidth - margin));
      const availableBelow = viewportHeight - rect.bottom - offset - margin;
      const availableAbove = rect.top - offset - margin;
      const shouldOpenAbove = availableBelow < 180 && availableAbove > availableBelow;
      const floatingMaxHeight = Math.max(160, shouldOpenAbove ? availableAbove : availableBelow);
      const nextStyle: CSSProperties = {
        left,
        position: "fixed",
        width: menuWidth,
        zIndex,
        "--omnix-floating-max-h": `${floatingMaxHeight}px`,
      } as CSSProperties;

      if (shouldOpenAbove) {
        nextStyle.bottom = viewportHeight - rect.top + offset;
      } else {
        nextStyle.top = rect.bottom + offset;
      }

      setStyle(nextStyle);
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, mounted, minWidth, offset, placement, width, zIndex]);

  if (!mounted || !style) return null;

  return createPortal(
    <div ref={contentRef} className={cn("pointer-events-auto", className)} style={style}>
      {children}
    </div>,
    document.body,
  );
}

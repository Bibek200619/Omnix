"use client";

import { cloneElement, useId } from "react";
import type { AriaAttributes, ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

type TooltipTriggerProps = AriaAttributes & {
  title?: string;
};

type TooltipProps = {
  content: ReactNode;
  children: ReactElement<TooltipTriggerProps>;
  className?: string;
};

export function Tooltip({ content, children, className }: TooltipProps) {
  const tooltipId = useId();
  const describedBy = [children.props["aria-describedby"], tooltipId].filter(Boolean).join(" ");
  const fallbackTitle = children.props.title ?? (typeof content === "string" ? content : undefined);
  const trigger = cloneElement(children, {
    "aria-describedby": describedBy,
    title: fallbackTitle,
  });

  return (
    <span className={cn("group/tooltip relative inline-flex", className)}>
      {trigger}
      <div
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-[200] mb-2 w-max max-w-[14rem] -translate-x-1/2 rounded-md border border-cyan-300/15 bg-[#08111f]/95 px-2 py-1 text-[11px] font-medium text-cyan-50 opacity-0 shadow-[0_12px_36px_rgba(0,0,0,0.38)] backdrop-blur-md transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {content}
      </div>
    </span>
  );
}

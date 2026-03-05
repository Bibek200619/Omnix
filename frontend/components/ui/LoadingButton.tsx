"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/Button";

type LoadingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  loadingText?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
};

export function LoadingButton({
  isLoading = false,
  loadingText = "Working",
  children,
  ...props
}: LoadingButtonProps) {
  return (
    <Button isLoading={isLoading} {...props}>
      {isLoading ? loadingText : children}
    </Button>
  );
}

import { useId } from "react";
import { cn } from "@/lib/utils";

type OmnixMarkProps = {
  size?: number;
  className?: string;
};

export function OmnixMark({ size = 36, className }: OmnixMarkProps) {
  const prefix = useId().replace(/:/g, "");
  const baseGradient = `${prefix}-base`;
  const silverGradient = `${prefix}-silver`;
  const blueGradient = `${prefix}-blue`;
  const highlightGradient = `${prefix}-highlight`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={cn("drop-shadow-[0_0_14px_var(--omnix-rgba-rgba-44-132-255-0-28)]", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={baseGradient} x1="13" y1="8" x2="52" y2="57" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--omnix-color-f9fcff)" />
          <stop offset="0.38" stopColor="var(--omnix-color-adc5ea)" />
          <stop offset="0.63" stopColor="var(--omnix-color-3068d2)" />
          <stop offset="1" stopColor="var(--omnix-color-29c7ff)" />
        </linearGradient>
        <linearGradient id={silverGradient} x1="13" y1="8" x2="45" y2="37" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--omnix-color-fbfdff)" />
          <stop offset="0.42" stopColor="var(--omnix-color-e4eef9)" />
          <stop offset="0.75" stopColor="var(--omnix-color-a9c3e8)" />
          <stop offset="1" stopColor="var(--omnix-color-547dc8)" />
        </linearGradient>
        <linearGradient id={blueGradient} x1="13" y1="46" x2="53" y2="29" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--omnix-color-33ccff)" />
          <stop offset="0.43" stopColor="var(--omnix-color-197ef0)" />
          <stop offset="1" stopColor="var(--omnix-color-214db9)" />
        </linearGradient>
        <linearGradient id={highlightGradient} x1="17" y1="14" x2="32" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.72" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path
        fill={`url(#${baseGradient})`}
        fillRule="evenodd"
        d="M32 4C16.536 4 4 16.536 4 32s12.536 28 28 28 28-12.536 28-28S47.464 4 32 4Zm0 14.25c7.594 0 13.75 6.156 13.75 13.75S39.594 45.75 32 45.75 18.25 39.594 18.25 32 24.406 18.25 32 18.25Z"
        clipRule="evenodd"
      />
      <path
        d="M8.89 39.77C3.94 27.02 8.5 13.63 20.2 7.16 30.08 1.7 42.45 4.02 50.12 12.6c-7.23-3.44-16.03-2.75-22.63 2.46-7.72 6.08-9.52 16.3-4.34 24.52-5.7 3.17-10.28 3.25-14.26.19Z"
        fill={`url(#${silverGradient})`}
      />
      <path
        d="M55.11 24.23c4.95 12.75.39 26.14-11.31 32.61-9.88 5.46-22.25 3.14-29.92-5.44 7.23 3.44 16.03 2.75 22.63-2.46 7.72-6.08 9.52-16.3 4.34-24.52 5.7-3.17 10.28-3.25 14.26-.19Z"
        fill={`url(#${blueGradient})`}
      />
      <path
        d="M14.16 29.82c.64-8.58 7.45-16.33 16.33-17.6 4.63-.67 9.19.31 13.05 2.56-4.81-1.02-9.98-.01-14.02 3.17-5.04 3.97-7.47 10.09-6.75 16.01-3.45-.48-6.21-1.86-8.61-4.14Z"
        fill={`url(#${highlightGradient})`}
      />
    </svg>
  );
}

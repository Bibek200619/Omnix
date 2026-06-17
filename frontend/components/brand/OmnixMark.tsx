import { cn } from "@/lib/utils";

type OmnixMarkProps = {
  size?: number;
  className?: string;
};

const outer = [
  [18, 3],
  [31, 8],
  [34, 18],
  [27, 30],
  [17, 34],
  [7, 28],
  [2, 17],
  [8, 6],
];

const inner = [
  [20, 9],
  [27, 14],
  [25, 24],
  [18, 28],
  [10, 23],
  [9, 13],
  [14, 8],
];

const edges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 0],
  [0, 8],
  [1, 9],
  [2, 10],
  [3, 11],
  [4, 12],
  [5, 13],
  [6, 14],
  [8, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [12, 13],
  [13, 14],
  [14, 8],
  [0, 10],
  [2, 13],
  [4, 8],
  [6, 11],
];

export function OmnixMark({ size = 36, className }: OmnixMarkProps) {
  const points = [...outer, ...inner];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      className={cn("text-cyan-300 drop-shadow-[0_0_14px_rgba(34,211,238,0.45)]", className)}
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="16" fill="currentColor" opacity="0.06" />
      {edges.map(([from, to], index) => {
        const [x1, y1] = points[from];
        const [x2, y2] = points[to];
        return (
          <line
            key={`${from}-${to}-${index}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="currentColor"
            strokeWidth={from >= 8 && to >= 8 ? 0.7 : 0.9}
            strokeOpacity={from >= 8 && to >= 8 ? 0.42 : 0.8}
            strokeLinecap="round"
          />
        );
      })}
      {points.map(([cx, cy], index) => (
        <circle
          key={`${cx}-${cy}-${index}`}
          cx={cx}
          cy={cy}
          r={index < 8 ? 1.35 : 0.95}
          fill="currentColor"
          opacity={index < 8 ? 0.95 : 0.68}
        />
      ))}
    </svg>
  );
}

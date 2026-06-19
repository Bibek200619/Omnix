"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { useDecorativeMotionEnabled } from "@/lib/use-decorative-motion";

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function AmbientParticles({ count = 25 }: { count?: number }) {
  const motionEnabled = useDecorativeMotionEnabled();
  const activeCount = motionEnabled ? count : Math.min(count, 8);
  type Particle = {
    id: number;
    x: number;
    y: number;
    size: number;
    dur: number;
    delay: number;
    opacity: number;
    color: string;
  };

  const particles = useMemo<Particle[]>(() => {
    const cyan = "var(--omnix-cyan)";
    const blue = "var(--omnix-blue)";
    const white = "var(--omnix-color-ffffff)";

    return Array.from({ length: activeCount }, (_, i) => {
        const colorSeed = seeded(i, 7);
        return {
          id: i,
          x: seeded(i, 1) * 100,
          y: seeded(i, 2) * 100,
          size: seeded(i, 3) * 1.8 + 0.4,
          dur: seeded(i, 4) * 25 + 15,
          delay: seeded(i, 5) * -30,
          opacity: seeded(i, 6) * 0.2 + 0.05,
          color: colorSeed > 0.7 ? cyan : colorSeed > 0.4 ? blue : white,
        };
      });
  }, [activeCount]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
      {particles.map((p) => {
        const style = {
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: p.size,
          height: p.size,
          background: p.color,
          opacity: p.opacity,
          filter: "blur(1px)",
        };

        return motionEnabled ? (
          <motion.div
            key={p.id}
            className="absolute rounded-full"
            style={style}
            animate={{
              y: [-25, 25, -25],
              x: [-12, 12, -12],
              opacity: [p.opacity, p.opacity * 2.5, p.opacity],
            }}
            transition={{
              duration: p.dur,
              delay: p.delay,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        ) : (
          <div key={p.id} className="absolute rounded-full" style={style} />
        );
      })}
    </div>
  );
}

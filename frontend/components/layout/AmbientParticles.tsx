"use client";

import { useMemo, type CSSProperties } from "react";

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

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

type ParticleStyle = CSSProperties & Record<`--${string}`, string | number>;

export function AmbientParticles({ count = 25 }: { count?: number }) {
  const particles = useMemo<Particle[]>(() => {
    const cyan = "var(--omnix-cyan)";
    const blue = "var(--omnix-blue)";
    const white = "var(--omnix-color-ffffff)";

    return Array.from({ length: count }, (_, i) => {
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
  }, [count]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-40">
      {particles.map((p) => {
        const style: ParticleStyle = {
          left: `${p.x}%`,
          top: `${p.y}%`,
          width: p.size,
          height: p.size,
          background: p.color,
          opacity: p.opacity,
          filter: "blur(1px)",
          animationDuration: `${p.dur}s`,
          animationDelay: `${p.delay}s`,
          "--omnix-shell-particle-opacity": p.opacity,
          "--omnix-shell-particle-peak-opacity": p.opacity * 2.5,
        };

        return <div key={p.id} className="omnix-shell-particle absolute rounded-full" style={style} />;
      })}
    </div>
  );
}

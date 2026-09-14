"use client";

import Link from "next/link";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useInView, type Variants } from "framer-motion";
import { OmnixMark as BrandMark } from "@/components/brand/OmnixMark";
import { useDecorativeMotionEnabled } from "@/lib/use-decorative-motion";

// ─── Brand ───────────────────────────────────────────────────────────────────
export const C = {
  cyan:     "var(--omnix-cyan)",
  cyanDark: "var(--omnix-cyan-dim)",
  blue:     "var(--omnix-color-0033ff)",
  blueMid:  "var(--omnix-color-0055ff)",
  navy:     "var(--omnix-bg-2)",
  navyDark: "var(--omnix-color-061020)",
  navyMid:  "var(--omnix-color-0d2440)",
  card:     "var(--omnix-rgba-255-255-255-0-03)",
  cardHov:  "var(--omnix-rgba-255-255-255-0-055)",
  border:   "var(--omnix-rgba-255-255-255-0-07)",
  borderC:  "var(--omnix-rgba-0-255-255-0-2)",
  white:    "var(--omnix-color-ffffff)",
  muted:    "var(--omnix-rgba-255-255-255-0-55)",
  faint:    "var(--omnix-rgba-255-255-255-0-32)",
  ghost:    "var(--omnix-rgba-255-255-255-0-14)",
};

export const FEATURES_HREF = `${String.fromCharCode(35)}features`;

export function tint(color: string, percent: number) {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

export function pct(value: number) {
  return `${value.toFixed(4)}%`;
}

export function px(value: number) {
  return `${value.toFixed(3)}px`;
}

export function alpha(value: number) {
  return value.toFixed(5);
}

// ─── Logo ─────────────────────────────────────────────────────────────────────
export function OmnixMark({ size = 36 }: { size?: number }) {
  return <BrandMark size={size} />;
}

// ─── SVG Icon Components ───────────────────────────────────────────────────────
export function Icon({ d, size=20, stroke=C.cyan, fill="none", sw=1.6 }:
  { d:string; size?:number; stroke?:string; fill?:string; sw?:number }) {
  return (
    <svg width={size} height={size} fill={fill} viewBox="0 0 24 24" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={d}/>
    </svg>
  );
}

export const ICONS = {
  chat:     "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  files:    "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  team:     "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
  search:   "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  lock:     "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z",
  bolt:     "M13 10V3L4 14h7v7l9-11h-7z",
  globe:    "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9",
  chart:    "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  link:     "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1",
  shield:   "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
  check:    "M5 13l4 4L19 7",
  arrow:    "M5 12h14M12 5l7 7-7 7",
  play:     "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  star:     "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
  plus:     "M12 4v16m8-8H4",
  clock:    "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  settings: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  upload:   "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12",
  doc:      "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z",
  send:     "M12 19l9 2-9-18-9 18 9-2zm0 0v-8",
  workspace:"M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
  tag:      "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
};

// ─── Animated Background ───────────────────────────────────────────────────────
function seeded(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export function ParticleField({ count = 34 }: { count?: number }) {
  const motionEnabled = useDecorativeMotionEnabled();
  const particleCount = motionEnabled ? count : Math.min(count, 10);
  type Particle = { id: number; x: number; y: number; size: number; dur: number; delay: number; opacity: number; color: string };
  const particles = useMemo<Particle[]>(
    () => Array.from({ length: particleCount }, (_, i) => {
      const colorSeed = seeded(i, 7);
      return {
        id: i,
        x: seeded(i, 1) * 100,
        y: seeded(i, 2) * 100,
        size: seeded(i, 3) * 2.2 + 0.6,
        dur: seeded(i, 4) * 18 + 12,
        delay: seeded(i, 5) * -20,
        opacity: seeded(i, 6) * 0.35 + 0.08,
        color: colorSeed > 0.65 ? C.cyan : colorSeed > 0.5 ? C.blue : "var(--omnix-color-ffffff)",
      };
    }),
    [particleCount],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p =>
        !motionEnabled ? (
          <div
            key={p.id}
            className="absolute rounded-full"
            style={{ left:pct(p.x), top:pct(p.y), width:px(p.size), height:px(p.size), background:p.color, opacity:alpha(p.opacity) }}
          />
        ) : (
          <motion.div key={p.id}
            className="absolute rounded-full"
            style={{ left:pct(p.x), top:pct(p.y), width:px(p.size), height:px(p.size), background:p.color, opacity:alpha(p.opacity) }}
            animate={{ y:[-18,18,-18], x:[-8,8,-8], opacity:[p.opacity, p.opacity*2.2, p.opacity] }}
            transition={{ duration:p.dur, delay:p.delay, repeat:Infinity, ease:"easeInOut" }}
          />
        )
      )}
    </div>
  );
}

type DriftingOrbProps = { x:string; y:string; size:number; color:string; dur:number; delay?:number };
export function DriftingOrb({ x, y, size, color, dur, delay=0 }: DriftingOrbProps) {
  const motionEnabled = useDecorativeMotionEnabled();
  const style: CSSProperties = { left:x, top:y, width:px(size), height:px(size), borderRadius:"50%",
    background:`radial-gradient(circle,${color} 0%,transparent 70%)`,
    transform:"translate(-50%,-50%)", filter:"blur(2px)" };
  if (!motionEnabled) {
    return <div className="absolute pointer-events-none opacity-70" style={style} />;
  }

  return (
    <motion.div className="absolute pointer-events-none"
      style={style}
      animate={{ x:[-30,30,-30], y:[-20,20,-20], scale:[1,1.15,1] }}
      transition={{ duration:dur, delay, repeat:Infinity, ease:"easeInOut" }}
    />
  );
}

export function AnimatedGrid({ opacity=0.04 }:{opacity?:number}) {
  const motionEnabled = useDecorativeMotionEnabled();
  const gridStyle = {
    backgroundImage:`linear-gradient(var(--omnix-rgba-0-255-255-0-5) 1px,transparent 1px),linear-gradient(90deg,var(--omnix-rgba-0-255-255-0-5) 1px,transparent 1px)`,
    backgroundSize:"64px 64px",
  };

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{opacity}}>
      {!motionEnabled ? (
        <div className="w-full h-full" style={gridStyle} />
      ) : (
        <motion.div className="w-full h-full"
          animate={{ backgroundPosition:["0px 0px","64px 64px"] }}
          transition={{ duration:22, repeat:Infinity, ease:"linear" }}
          style={gridStyle}
        />
      )}
    </div>
  );
}

export function SectionBg({ children }: { children?: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {children}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────
export const easeOutExpo = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden:  { opacity:0, y:28 },
  visible: { opacity:1, y:0, transition:{ duration:0.6, ease:easeOutExpo } },
};
export const stag: Variants = { hidden:{}, visible:{ transition:{ staggerChildren:0.085 } } };

export function Sec({ children, className="" }:{ children:ReactNode; className?:string }) {
  const ref = useRef(null);
  const inView = useInView(ref,{ once:true, margin:"-60px" });
  return (
    <motion.div ref={ref} variants={stag} initial="hidden" animate={inView?"visible":"hidden"} className={className}>
      {children}
    </motion.div>
  );
}

export function Label({ children }:{ children:ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black mb-5"
      style={{background:"var(--omnix-rgba-0-255-255-0-07)",border:`1px solid var(--omnix-rgba-0-255-255-0-22)`,color:C.cyan,letterSpacing:"0.1em"}}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background:C.cyan}}/>
      {children}
    </motion.div>
  );
}

export function H2({ children }:{ children:ReactNode }) {
  return (
    <motion.h2 variants={fadeUp} className="mb-4 text-3xl font-black leading-tight tracking-tight sm:text-5xl" style={{color:C.white}}>
      {children}
    </motion.h2>
  );
}

export function GradText({ children }:{ children:ReactNode }) {
  return (
    <span style={{background:`linear-gradient(135deg,${C.cyan} 0%,var(--omnix-color-00aaff) 55%,${C.blue} 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
      {children}
    </span>
  );
}

export function CyanBtn({ children, large=false, href, onClick }:{ children:ReactNode; large?:boolean; href?: string; onClick?:()=>void }) {
  const [hov,setHov]=useState(false);
  const className = `inline-flex w-full items-center justify-center gap-2 rounded-xl font-black tracking-wide transition-all duration-200 sm:w-auto ${large?"px-7 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base":"px-7 py-3.5 text-sm"}`;
  const style = {background:C.cyan,color:C.navyDark,boxShadow:hov?`0 0 60px var(--omnix-rgba-0-255-255-0-6)`:`0 0 32px var(--omnix-rgba-0-255-255-0-35)`,transform:hov?"translateY(-2px)":"translateY(0)"};
  const events = { onMouseEnter:()=>setHov(true), onMouseLeave:()=>setHov(false) };

  if (href) {
    return (
      <Link href={href} className={className} style={style} {...events}>
        {children}
      </Link>
    );
  }

  return (
    <button onClick={onClick} className={className} style={style} {...events}>
      {children}
    </button>
  );
}

export function GhostBtn({ children, large=false, href }:{ children:ReactNode; large?:boolean; href?: string }) {
  const [hov,setHov]=useState(false);
  const className = `inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 sm:w-auto ${large?"px-7 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base":"px-7 py-3.5 text-sm"}`;
  const style = {background:hov?"var(--omnix-rgba-255-255-255-0-08)":C.card,border:`1px solid ${hov?"var(--omnix-rgba-255-255-255-0-18)":C.border}`,color:hov?C.white:C.muted};
  const events = { onMouseEnter:()=>setHov(true), onMouseLeave:()=>setHov(false) };

  if (href) {
    return (
      <Link href={href} className={className} style={style} {...events}>
        {children}
      </Link>
    );
  }

  return (
    <button className={className} style={style} {...events}>
      {children}
    </button>
  );
}

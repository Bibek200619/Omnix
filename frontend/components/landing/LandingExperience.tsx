"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useInView, AnimatePresence, type Variants } from "framer-motion";

// ─── Brand ───────────────────────────────────────────────────────────────────
const C = {
  cyan:     "#00FFFF",
  cyanDark: "#00CCCC",
  blue:     "#0033FF",
  blueMid:  "#0055FF",
  navy:     "#0A192F",
  navyDark: "#061020",
  navyMid:  "#0d2440",
  card:     "rgba(255,255,255,0.03)",
  cardHov:  "rgba(255,255,255,0.055)",
  border:   "rgba(255,255,255,0.07)",
  borderC:  "rgba(0,255,255,0.2)",
  white:    "#FFFFFF",
  muted:    "rgba(255,255,255,0.55)",
  faint:    "rgba(255,255,255,0.32)",
  ghost:    "rgba(255,255,255,0.14)",
};

// ─── Logo ─────────────────────────────────────────────────────────────────────
function OmnixMark({ size = 36 }: { size?: number }) {
  const s = size, cx = s/2, cy = s/2;
  const R = s*0.42, ri = s*0.22;
  const outer: [number,number][] = [
    [cx, cy-R],[cx+R*0.71,cy-R*0.41],[cx+R*0.87,cy+R*0.2],[cx+R*0.5,cy+R*0.82],
    [cx-R*0.05,cy+R*0.95],[cx-R*0.62,cy+R*0.72],[cx-R*0.9,cy+R*0.08],[cx-R*0.58,cy-R*0.58],
  ];
  const inner: [number,number][] = [
    [cx+ri*0.1,cy-ri*1.1],[cx+ri*1.0,cy-ri*0.3],[cx+ri*0.85,cy+ri*0.7],[cx+ri*0.1,cy+ri*1.1],
    [cx-ri*0.7,cy+ri*0.8],[cx-ri*1.0,cy-ri*0.1],[cx-ri*0.5,cy-ri*0.9],
  ];
  const all = [...outer,...inner];
  const edges:[number,number][] = [
    [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
    [0,8],[1,9],[2,10],[3,11],[4,12],[5,13],[6,14],
    [8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,8],
    [0,10],[2,13],[4,8],[6,11],
  ];
  const nr = s*0.028;
  const uid = `om${s}`;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
      <defs>
        <radialGradient id={`rg-${uid}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={C.cyan} stopOpacity="0.18"/>
          <stop offset="100%" stopColor={C.cyan} stopOpacity="0"/>
        </radialGradient>
        <filter id={`f-${uid}`}><feGaussianBlur stdDeviation="0.7"/></filter>
      </defs>
      <circle cx={cx} cy={cy} r={R*1.1} fill={`url(#rg-${uid})`}/>
      {edges.map(([a,b],i) => {
        const isIn = a>=8&&b>=8;
        return <line key={i} x1={all[a][0]} y1={all[a][1]} x2={all[b][0]} y2={all[b][1]}
          stroke={C.cyan} strokeWidth={isIn?s*0.012:s*0.016} strokeOpacity={isIn?0.42:0.72}/>;
      })}
      {edges.slice(0,8).map(([a,b],i)=>(
        <line key={`gl${i}`} x1={all[a][0]} y1={all[a][1]} x2={all[b][0]} y2={all[b][1]}
          stroke={C.cyan} strokeWidth={s*0.045} strokeOpacity={0.07} filter={`url(#f-${uid})`}/>
      ))}
      {all.map(([nx,ny],i)=>(
        <circle key={i} cx={nx} cy={ny} r={i<8?nr*1.45:nr} fill={C.cyan} opacity={i<8?0.95:0.6}/>
      ))}
      {[0,2,5].map(i=>(
        <circle key={`hl${i}`} cx={all[i][0]} cy={all[i][1]} r={nr*2.2}
          fill={C.cyan} opacity={0.18} filter={`url(#f-${uid})`}/>
      ))}
    </svg>
  );
}

// ─── SVG Icon Components ───────────────────────────────────────────────────────
function Icon({ d, size=20, stroke=C.cyan, fill="none", sw=1.6 }:
  { d:string; size?:number; stroke?:string; fill?:string; sw?:number }) {
  return (
    <svg width={size} height={size} fill={fill} viewBox="0 0 24 24" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={d}/>
    </svg>
  );
}

const ICONS = {
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

function ParticleField() {
  type Particle = { id: number; x: number; y: number; size: number; dur: number; delay: number; opacity: number; color: string };
  const [particles] = useState<Particle[]>(() =>
    Array.from({ length: 55 }, (_, i) => {
      const colorSeed = seeded(i, 7);
      return {
        id: i,
        x: seeded(i, 1) * 100,
        y: seeded(i, 2) * 100,
        size: seeded(i, 3) * 2.2 + 0.6,
        dur: seeded(i, 4) * 18 + 12,
        delay: seeded(i, 5) * -20,
        opacity: seeded(i, 6) * 0.35 + 0.08,
        color: colorSeed > 0.65 ? C.cyan : colorSeed > 0.5 ? C.blue : "#ffffff",
      };
    })
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map(p => (
        <motion.div key={p.id}
          className="absolute rounded-full"
          style={{ left:`${p.x}%`, top:`${p.y}%`, width:p.size, height:p.size, background:p.color, opacity:p.opacity }}
          animate={{ y:[-18,18,-18], x:[-8,8,-8], opacity:[p.opacity, p.opacity*2.2, p.opacity] }}
          transition={{ duration:p.dur, delay:p.delay, repeat:Infinity, ease:"easeInOut" }}
        />
      ))}
    </div>
  );
}

type DriftingOrbProps = { x:string; y:string; size:number; color:string; dur:number; delay?:number };
function DriftingOrb({ x, y, size, color, dur, delay=0 }: DriftingOrbProps) {
  return (
    <motion.div className="absolute pointer-events-none"
      style={{ left:x, top:y, width:size, height:size, borderRadius:"50%",
        background:`radial-gradient(circle,${color} 0%,transparent 70%)`,
        transform:"translate(-50%,-50%)", filter:"blur(2px)" }}
      animate={{ x:[-30,30,-30], y:[-20,20,-20], scale:[1,1.15,1] }}
      transition={{ duration:dur, delay, repeat:Infinity, ease:"easeInOut" }}
    />
  );
}

function AnimatedGrid({ opacity=0.04 }:{opacity?:number}) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{opacity}}>
      <motion.div className="w-full h-full"
        animate={{ backgroundPosition:["0px 0px","64px 64px"] }}
        transition={{ duration:22, repeat:Infinity, ease:"linear" }}
        style={{
          backgroundImage:`linear-gradient(rgba(0,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,255,0.5) 1px,transparent 1px)`,
          backgroundSize:"64px 64px",
        }}
      />
    </div>
  );
}

function SectionBg({ children }: { children?: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {children}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────
const easeOutExpo = [0.22, 1, 0.36, 1] as const;

const fadeUp: Variants = {
  hidden:  { opacity:0, y:28 },
  visible: { opacity:1, y:0, transition:{ duration:0.6, ease:easeOutExpo } },
};
const stag: Variants = { hidden:{}, visible:{ transition:{ staggerChildren:0.085 } } };

function Sec({ children, className="" }:{ children:ReactNode; className?:string }) {
  const ref = useRef(null);
  const inView = useInView(ref,{ once:true, margin:"-60px" });
  return (
    <motion.div ref={ref} variants={stag} initial="hidden" animate={inView?"visible":"hidden"} className={className}>
      {children}
    </motion.div>
  );
}

function Label({ children }:{ children:ReactNode }) {
  return (
    <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black mb-5"
      style={{background:"rgba(0,255,255,0.07)",border:`1px solid rgba(0,255,255,0.22)`,color:C.cyan,letterSpacing:"0.1em"}}>
      <span className="w-1.5 h-1.5 rounded-full" style={{background:C.cyan}}/>
      {children}
    </motion.div>
  );
}

function H2({ children }:{ children:ReactNode }) {
  return (
    <motion.h2 variants={fadeUp} className="mb-4 text-3xl font-black leading-tight tracking-tight sm:text-5xl" style={{color:C.white}}>
      {children}
    </motion.h2>
  );
}

function GradText({ children }:{ children:ReactNode }) {
  return (
    <span style={{background:`linear-gradient(135deg,${C.cyan} 0%,#00aaff 55%,${C.blue} 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
      {children}
    </span>
  );
}

function CyanBtn({ children, large=false, href, onClick }:{ children:ReactNode; large?:boolean; href?: string; onClick?:()=>void }) {
  const [hov,setHov]=useState(false);
  const className = `inline-flex w-full items-center justify-center gap-2 rounded-xl font-black tracking-wide transition-all duration-200 sm:w-auto ${large?"px-7 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base":"px-7 py-3.5 text-sm"}`;
  const style = {background:C.cyan,color:C.navyDark,boxShadow:hov?`0 0 60px rgba(0,255,255,0.6)`:`0 0 32px rgba(0,255,255,0.35)`,transform:hov?"translateY(-2px)":"translateY(0)"};
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

function GhostBtn({ children, large=false, href }:{ children:ReactNode; large?:boolean; href?: string }) {
  const [hov,setHov]=useState(false);
  const className = `inline-flex w-full items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200 sm:w-auto ${large?"px-7 py-3.5 text-sm sm:px-9 sm:py-4 sm:text-base":"px-7 py-3.5 text-sm"}`;
  const style = {background:hov?"rgba(255,255,255,0.08)":C.card,border:`1px solid ${hov?"rgba(255,255,255,0.18)":C.border}`,color:hov?C.white:C.muted};
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

// ─── NAVBAR ───────────────────────────────────────────────────────────────────
function Navbar() {
  const [sc,setSc]=useState(false);
  useEffect(()=>{
    const h=()=>setSc(window.scrollY>50);
    window.addEventListener("scroll",h,{passive:true});
    return ()=>window.removeEventListener("scroll",h);
  },[]);
  return (
    <motion.nav initial={{y:-24,opacity:0}} animate={{y:0,opacity:1}} transition={{duration:0.5}}
      className="sticky top-0 z-50 flex items-center justify-between gap-2 px-4 py-3 transition-all duration-300 sm:px-8 sm:py-4"
      style={{background:sc?"rgba(10,25,47,0.92)":"transparent",backdropFilter:sc?"blur(24px)":"none",borderBottom:sc?`1px solid rgba(0,255,255,0.08)`:"1px solid transparent"}}>
      <div className="flex items-center gap-3">
        <OmnixMark size={32}/>
        <span className="font-black tracking-[0.14em] text-xl" style={{color:C.white}}>OMNIX</span>
      </div>
      <div className="hidden md:flex items-center gap-8">
        {[
          { label:"Features", href:"#features" },
          { label:"How it works", href:"#how-it-works" },
          { label:"Pricing", href:"#pricing" },
          { label:"Docs", href:"#inside-app" },
          { label:"About", href:"#security" },
        ].map(item=>(
          <a key={item.label} href={item.href} className="text-sm font-medium transition-colors duration-200"
            style={{color:C.muted}}
            onMouseEnter={e=>(e.currentTarget.style.color=C.white)}
            onMouseLeave={e=>(e.currentTarget.style.color=C.muted)}>{item.label}</a>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Link href="/login" className="hidden rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:inline-flex" style={{color:C.muted}}
          onMouseEnter={e=>(e.currentTarget.style.color=C.white)}
          onMouseLeave={e=>(e.currentTarget.style.color=C.muted)}>Sign in</Link>
        <Link href="/register" className="rounded-xl px-3.5 py-2.5 text-xs font-black transition-all duration-200 sm:px-5 sm:text-sm"
          style={{background:C.cyan,color:C.navyDark,boxShadow:`0 0 24px rgba(0,255,255,0.35)`}}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(-1px)";(e.currentTarget as HTMLElement).style.boxShadow=`0 0 40px rgba(0,255,255,0.55)`;}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform="translateY(0)";(e.currentTarget as HTMLElement).style.boxShadow=`0 0 24px rgba(0,255,255,0.35)`;}}>
          Get started →
        </Link>
      </div>
    </motion.nav>
  );
}

// ─── HERO ─────────────────────────────────────────────────────────────────────
function FloatTag({ text, icon, style }:{ text:string; icon:string; style:CSSProperties }) {
  return (
    <motion.div
      animate={{y:[0,-8,0]}}
      transition={{duration:3.8,repeat:Infinity,ease:"easeInOut"}}
      className="absolute hidden lg:flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold backdrop-blur-sm pointer-events-none"
      style={{background:"rgba(10,25,47,0.88)",border:`1px solid rgba(0,255,255,0.2)`,color:C.white,whiteSpace:"nowrap",...style}}>
      <span style={{color:C.cyan}}>{icon}</span> {text}
    </motion.div>
  );
}

function HeroChat() {
  const msgs = [
    { role:"user",  text:"Which onboarding steps are blocking enterprise rollout?" },
    { role:"ai",    text:"Three blockers found: SSO config, data residency compliance, and custom role setup.", sources:["runbooks.pdf","enterprise-sla.pdf"] },
    { role:"user",  text:"Summarise the compliance requirements." },
    { role:"ai",    text:null, loading:true },
  ];
  return (
    <motion.div initial={{opacity:0,y:56,scale:0.96}} animate={{opacity:1,y:0,scale:1}}
      transition={{duration:0.9,delay:0.5,ease:easeOutExpo}}
      className="relative mx-auto mt-10 w-full sm:mt-14" style={{maxWidth:900}}>

      <FloatTag text="Runbooks retrieved" icon="↗" style={{top:"12%",left:"-10%"}}/>
      <FloatTag text="SOC 2 verified" icon="✓" style={{top:"38%",right:"-10%"}}/>
      <FloatTag text="1.4s response" icon="→" style={{bottom:"28%",left:"-9%"}}/>
      <FloatTag text="Grounded answer" icon="◆" style={{bottom:"12%",right:"-9%"}}/>

      <div className="absolute inset-0 rounded-2xl" style={{boxShadow:`0 0 80px rgba(0,255,255,0.1),0 50px 130px rgba(0,0,0,0.8)`,borderRadius:20}}/>
      <div className="relative rounded-2xl overflow-hidden"
        style={{border:`1px solid rgba(0,255,255,0.14)`,background:"rgba(6,18,32,0.98)",backdropFilter:"blur(20px)"}}>
        <div className="flex items-center gap-2 px-3 py-3 sm:px-5 sm:py-3.5"
          style={{borderBottom:`1px solid rgba(255,255,255,0.05)`,background:"rgba(255,255,255,0.02)"}}>
          <div className="flex gap-1.5">
            {["#ff5f57","#febc2e","#28c840"].map(c=><div key={c} className="w-3 h-3 rounded-full" style={{background:c}}/>)}
          </div>
          <div className="flex-1 text-center text-xs" style={{color:"rgba(255,255,255,0.25)"}}>OMNIX — Enterprise Workspace</div>
          <div className="hidden items-center gap-1.5 rounded-md px-2.5 py-1 text-xs sm:flex" style={{background:"rgba(34,197,94,0.12)",color:"#4ade80"}}>
            <span className="w-1.5 h-1.5 rounded-full" style={{background:"#22c55e"}}/>Synced
          </div>
        </div>
        <div className="flex" style={{height:400}}>
          <div className="hidden w-52 flex-shrink-0 flex-col sm:flex" style={{borderRight:`1px solid rgba(255,255,255,0.05)`,background:"rgba(255,255,255,0.01)"}}>
            <div className="p-4">
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl mb-4"
                style={{background:"rgba(0,255,255,0.06)",border:`1px solid rgba(0,255,255,0.14)`}}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
                  style={{background:C.cyan,color:C.navyDark}}>D</div>
                <div>
                  <div className="text-xs font-bold" style={{color:C.white}}>demo</div>
                  <div className="text-xs" style={{color:C.faint}}>Founder · 2 members</div>
                </div>
              </div>
              {[
                {icon:ICONS.chat,    label:"Chat",     active:true  },
                {icon:ICONS.files,   label:"Files",    active:false },
                {icon:ICONS.clock,   label:"History",  active:false },
                {icon:ICONS.settings,label:"Settings", active:false },
              ].map(nav=>(
                <div key={nav.label} className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5 cursor-pointer text-sm"
                  style={{background:nav.active?"rgba(0,255,255,0.08)":"transparent",color:nav.active?C.cyan:C.muted,fontWeight:nav.active?"600":"400"}}>
                  <Icon d={nav.icon} size={15} stroke={nav.active?C.cyan:C.muted} sw={1.8}/>
                  {nav.label}
                </div>
              ))}
              <div className="text-xs font-black mt-5 mb-2 px-1" style={{color:C.faint,letterSpacing:"0.1em"}}>RECENT CHATS</div>
              {["Enterprise rollout","SLA compliance","API rate limits"].map((c,i)=>(
                <div key={c} className="px-3 py-1.5 rounded-lg mb-0.5 text-xs"
                  style={{color:i===0?C.white:C.faint,background:i===0?"rgba(255,255,255,0.04)":"transparent"}}>{c}</div>
              ))}
            </div>
          </div>
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-between gap-2 px-3 py-3 sm:px-5" style={{borderBottom:`1px solid rgba(255,255,255,0.04)`}}>
              <div className="truncate text-sm font-bold" style={{color:C.white}}>Enterprise rollout blockers</div>
              <div className="hidden gap-1.5 sm:flex">
                {["Auto","Workspace","Web","Hybrid"].map((m,i)=>(
                  <span key={m} className="px-2.5 py-1 rounded-lg text-xs font-semibold"
                    style={{background:i===0?"rgba(0,255,255,0.14)":C.card,color:i===0?C.cyan:C.faint,border:i===0?`1px solid rgba(0,255,255,0.25)`:`1px solid ${C.border}`}}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-hidden p-3 sm:p-5">
              {msgs.map((msg,i)=>(
                <motion.div key={i}
                  initial={{opacity:0,x:msg.role==="user"?16:-16}}
                  animate={{opacity:1,x:0}}
                  transition={{delay:0.7+i*0.18,duration:0.3}}
                  className={`flex ${msg.role==="user"?"justify-end":"justify-start"}`}>
                  {msg.role==="ai"&&(
                    <div className="max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed"
                      style={{background:"rgba(255,255,255,0.03)",border:`1px solid rgba(255,255,255,0.06)`,color:"rgba(255,255,255,0.82)"}}>
                      {msg.loading?(
                        <div className="flex items-center gap-2" style={{color:C.cyan}}>
                          <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:"linear"}}
                            className="w-3 h-3 rounded-full border border-current border-t-transparent"/>
                          <span className="text-xs">Retrieving from 4 documents…</span>
                        </div>
                      ):(
                        <div>
                          <div className="flex items-center gap-1.5 text-xs mb-1.5" style={{color:C.cyan}}>
                            <OmnixMark size={12}/><span className="font-bold">OMNIX AI</span>
                          </div>
                          <p>{msg.text}</p>
                          {msg.sources&&(
                            <div className="flex gap-1.5 mt-2 flex-wrap">
                              {msg.sources.map(s=>(
                                <span key={s} className="text-xs px-2 py-0.5 rounded-md flex items-center gap-1"
                                  style={{background:"rgba(0,255,255,0.07)",color:C.cyan,border:`1px solid rgba(0,255,255,0.15)`}}>
                                  <Icon d={ICONS.doc} size={10} stroke={C.cyan} sw={2}/>{s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.role==="user"&&(
                    <div className="max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed"
                      style={{background:"rgba(0,255,255,0.1)",border:`1px solid rgba(0,255,255,0.2)`,color:"rgba(255,255,255,0.9)"}}>
                      {msg.text}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
            <div className="px-3 py-3 sm:px-5 sm:py-4" style={{borderTop:`1px solid rgba(255,255,255,0.05)`}}>
              <div className="flex items-center gap-3 rounded-2xl px-3 py-3 sm:px-4"
                style={{background:"rgba(255,255,255,0.04)",border:`1px solid rgba(255,255,255,0.08)`}}>
                <span className="text-sm flex-1" style={{color:"rgba(255,255,255,0.25)"}}>Ask OMNIX anything about your knowledge base…</span>
                <button className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{background:C.cyan,color:C.navyDark}}>
                  <Icon d={ICONS.arrow} size={14} stroke={C.navyDark} sw={2.5}/>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-5 sm:pb-28 sm:pt-8">
      <SectionBg>
        <ParticleField/>
        <DriftingOrb x="50%" y="28%" size={900} color="rgba(0,255,255,0.07)" dur={20}/>
        <DriftingOrb x="80%" y="60%" size={480} color="rgba(0,51,255,0.07)" dur={25} delay={-5}/>
        <DriftingOrb x="14%" y="72%" size={400} color="rgba(0,51,255,0.06)" dur={30} delay={-10}/>
        <AnimatedGrid opacity={0.045}/>
        <div className="absolute inset-0"
          style={{background:"linear-gradient(180deg,rgba(10,25,47,0) 0%,rgba(10,25,47,0) 60%,rgba(6,16,32,1) 100%)"}}/>
      </SectionBg>
      <div className="relative z-10 flex flex-col items-center px-4 pt-10 text-center sm:px-6 sm:pt-14">
        <motion.div initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} transition={{duration:0.45,delay:0.08}}>
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black mb-8"
            style={{background:"rgba(0,255,255,0.07)",border:`1px solid rgba(0,255,255,0.24)`,color:C.cyan,letterSpacing:"0.1em"}}>
            <motion.span animate={{opacity:[1,0.4,1]}} transition={{duration:2,repeat:Infinity}} className="w-1.5 h-1.5 rounded-full" style={{background:C.cyan}}/>
            AI WORKSPACE FOR KNOWLEDGE TEAMS
          </div>
        </motion.div>
        <motion.h1 initial={{opacity:0,y:36}} animate={{opacity:1,y:0}}
          transition={{duration:0.75,delay:0.2,ease:easeOutExpo}}
          className="font-black leading-[1.05] tracking-tight"
          style={{fontSize:"clamp(2.5rem,6.8vw,5.5rem)",color:C.white,maxWidth:900}}>
          Turn private knowledge{" "}
          <span style={{background:`linear-gradient(135deg,${C.cyan} 0%,#00aaff 50%,${C.blue} 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
            into precise AI
          </span>{" "}answers
        </motion.h1>
        <motion.p initial={{opacity:0,y:22}} animate={{opacity:1,y:0}} transition={{duration:0.6,delay:0.36}}
          className="mt-6 text-base leading-relaxed sm:mt-7 sm:text-lg" style={{color:C.muted,maxWidth:540}}>
          OMNIX gives operators, support teams, and builders a secure place to ask questions
          against private knowledge — with searchable history, workspaces built for real operations,
          and enterprise-grade security.
        </motion.p>
        <motion.div initial={{opacity:0,y:22}} animate={{opacity:1,y:0}} transition={{duration:0.5,delay:0.5}}
          className="mt-8 flex w-full max-w-sm flex-col items-center gap-3 sm:mt-10 sm:w-auto sm:max-w-none sm:flex-row sm:gap-4">
          <CyanBtn large href="/register">Start working free <Icon d={ICONS.arrow} size={18} stroke={C.navyDark} sw={2.5}/></CyanBtn>
          <GhostBtn large><Icon d={ICONS.play} size={18} stroke={C.muted} sw={1.8}/>Watch demo</GhostBtn>
        </motion.div>
        <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.75}}
          className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {["No credit card","Free for small teams","GDPR & SOC 2"].map(t=>(
            <span key={t} className="text-xs flex items-center gap-1.5" style={{color:"rgba(255,255,255,0.28)"}}>
              <Icon d={ICONS.check} size={11} stroke="rgba(0,255,255,0.5)" sw={2.5}/>{t}
            </span>
          ))}
        </motion.div>
        <HeroChat/>
      </div>
    </section>
  );
}

// ─── MARQUEE ──────────────────────────────────────────────────────────────────
function Marquee() {
  const items = ["Meridian Labs","Vertex Systems","Foundry Digital","Apex Ops","Clearline AI","Orbit Health","DataCore","Nimbus Tech","Stratum HQ","Prism Works","Relay Cloud","Cascade IO"];
  const doubled = [...items,...items];
  return (
    <div className="py-10 overflow-hidden relative"
      style={{borderTop:`1px solid rgba(255,255,255,0.05)`,borderBottom:`1px solid rgba(255,255,255,0.05)`}}>
      <SectionBg>
        <DriftingOrb x="50%" y="50%" size={500} color="rgba(0,255,255,0.04)" dur={18}/>
      </SectionBg>
      <p className="text-center text-xs font-black tracking-widest mb-6 relative z-10"
        style={{color:C.faint,letterSpacing:"0.12em"}}>TRUSTED BY TEAMS AT</p>
      <div className="relative z-10">
        <div className="absolute left-0 top-0 bottom-0 w-32 z-10 pointer-events-none"
          style={{background:`linear-gradient(90deg,#061020,transparent)`}}/>
        <div className="absolute right-0 top-0 bottom-0 w-32 z-10 pointer-events-none"
          style={{background:`linear-gradient(270deg,#061020,transparent)`}}/>
        <motion.div className="flex gap-10 whitespace-nowrap"
          animate={{x:[0,-2200]}} transition={{duration:38,repeat:Infinity,ease:"linear"}}>
          {doubled.map((name,i)=>(
            <div key={i} className="flex items-center gap-3 px-5 py-2.5 rounded-xl flex-shrink-0"
              style={{background:C.card,border:`1px solid ${C.border}`}}>
              <div className="w-5 h-5 rounded flex items-center justify-center" style={{background:"rgba(0,255,255,0.1)"}}>
                <OmnixMark size={14}/>
              </div>
              <span className="text-sm font-semibold" style={{color:"rgba(255,255,255,0.5)"}}>{name}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function Stats() {
  const stats=[
    {value:"10,000+",label:"Active teams",        icon:ICONS.team   },
    {value:"98.7%",  label:"Answer accuracy",     icon:ICONS.shield  },
    {value:"< 1.8s", label:"Avg response time",   icon:ICONS.bolt    },
    {value:"99.99%", label:"Platform uptime",     icon:ICONS.lock    },
    {value:"50M+",   label:"Queries answered",    icon:ICONS.chat    },
    {value:"SOC 2",  label:"Type II certified",   icon:ICONS.check   },
  ];
  return (
    <Sec className="px-4 py-14 sm:px-6 sm:py-20">
      <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-5">
        {stats.map(s=>(
          <motion.div key={s.label} variants={fadeUp}
            className="flex flex-col items-center text-center p-5 rounded-2xl transition-all duration-200"
            style={{background:C.card,border:`1px solid ${C.border}`}}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.borderC;(e.currentTarget as HTMLElement).style.background="rgba(0,255,255,0.04)";}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.border;(e.currentTarget as HTMLElement).style.background=C.card;}}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
              style={{background:"rgba(0,255,255,0.08)",border:`1px solid rgba(0,255,255,0.14)`}}>
              <Icon d={s.icon} size={16} stroke={C.cyan} sw={1.8}/>
            </div>
            <div className="text-2xl font-black mb-1" style={{background:`linear-gradient(135deg,${C.white},${C.cyan})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
              {s.value}
            </div>
            <div className="text-xs" style={{color:C.faint}}>{s.label}</div>
          </motion.div>
        ))}
      </div>
    </Sec>
  );
}

// ─── FEATURES ─────────────────────────────────────────────────────────────────
const FEATS=[
  {icon:ICONS.chat,      title:"Precision AI Chat",         accent:C.cyan,    desc:"Ask complex questions across all your team's documents. OMNIX retrieves the right context and gives grounded, citation-backed answers every time."},
  {icon:ICONS.files,     title:"Shared Knowledge Files",    accent:"#818cf8", desc:"Upload PDFs, DOCX, Markdown, and text files. Every workspace member has instant access to the same documents, indexed in seconds."},
  {icon:ICONS.workspace, title:"Collaborative Workspaces",  accent:"#34d399", desc:"Invite teammates with role-based access. Founders, editors, and members each get the right level of control and visibility."},
  {icon:ICONS.clock,     title:"Searchable Chat History",   accent:"#fb923c", desc:"Every conversation is stored, indexed, and searchable. Find any past answer in seconds across your entire team's history."},
  {icon:ICONS.lock,      title:"Enterprise Security",       accent:"#f472b6", desc:"Identity-first architecture. Every screen is gated behind an active session. Encrypted at rest and in transit."},
  {icon:ICONS.bolt,      title:"Real-Time Sync",            accent:C.cyan,    desc:"Conversations sync instantly across every device. Start on desktop, pick up on mobile — your workspace travels with you."},
  {icon:ICONS.globe,     title:"Multi-Mode Retrieval",      accent:"#818cf8", desc:"Switch between Auto, Workspace, Web, and Hybrid retrieval modes on the fly to get exactly the context you need."},
  {icon:ICONS.chart,     title:"Workspace Analytics",       accent:"#34d399", desc:"Track team query patterns, response quality, and knowledge gaps. Make smarter decisions about what to document next."},
  {icon:ICONS.link,      title:"API & Integrations",        accent:"#fb923c", desc:"Connect OMNIX to your existing tools. REST API, webhooks, and native integrations with Slack, Notion, and more."},
];

function Features() {
  const [hov,setHov]=useState<number|null>(null);
  return (
    <section id="features" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="14%" y="55%" size={600} color="rgba(0,51,255,0.07)" dur={28} delay={-6}/>
        <DriftingOrb x="88%" y="35%" size={480} color="rgba(0,255,255,0.06)" dur={22} delay={-3}/>
        <ParticleField/>
      </SectionBg>
      <Sec className="max-w-6xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="text-center mb-16">
          <Label>FEATURES</Label>
          <H2>Everything your team needs</H2>
          <motion.p variants={fadeUp} className="text-lg" style={{color:C.muted,maxWidth:480,margin:"0 auto"}}>
            OMNIX is built for teams that need answers they can trust — fast, secure, and grounded in your actual knowledge base.
          </motion.p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATS.map((f,i)=>(
            <motion.div key={f.title} variants={fadeUp}
              className="relative rounded-2xl p-6 cursor-pointer transition-all duration-300 group overflow-hidden"
              style={{background:hov===i?`${f.accent}09`:C.card,border:`1px solid ${hov===i?`${f.accent}28`:C.border}`,transform:hov===i?"translateY(-4px)":"translateY(0)",boxShadow:hov===i?`0 24px 64px ${f.accent}14`:"none"}}
              onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
              <div className="absolute top-0 right-0 w-20 h-20 pointer-events-none rounded-bl-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{background:`radial-gradient(circle at top right,${f.accent}18,transparent 70%)`}}/>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{background:`${f.accent}12`,border:`1px solid ${f.accent}22`}}>
                <Icon d={f.icon} size={22} stroke={f.accent} sw={1.7}/>
              </div>
              <h3 className="font-black text-base mb-2" style={{color:C.white}}>{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{color:C.faint}}>{f.desc}</p>
              <div className="mt-4 flex items-center gap-1 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{color:f.accent}}>
                Learn more <Icon d={ICONS.arrow} size={12} stroke={f.accent} sw={2.5}/>
              </div>
            </motion.div>
          ))}
        </div>
      </Sec>
    </section>
  );
}

// ─── APP SCREENSHOTS ──────────────────────────────────────────────────────────
function AppScreenshots() {
  const [active,setActive]=useState(0);
  const tabs=[
    {label:"AI Chat",   icon:ICONS.chat    },
    {label:"Files",     icon:ICONS.files   },
    {label:"History",   icon:ICONS.clock   },
    {label:"Settings",  icon:ICONS.settings},
  ];

  const screens=[
    <div key="chat" className="flex h-full">
      <div className="w-52 flex-shrink-0 p-4" style={{borderRight:`1px solid rgba(255,255,255,0.05)`,background:"rgba(0,0,0,0.2)"}}>
        <div className="text-xs font-black mb-3 px-1" style={{color:C.faint,letterSpacing:"0.1em"}}>KNOWLEDGE BASE</div>
        {[
          {icon:ICONS.doc,    label:"Runbooks"     },
          {icon:ICONS.doc,    label:"Policies"     },
          {icon:ICONS.tag,    label:"Tickets"      },
          {icon:ICONS.files,  label:"Documentation"},
          {icon:ICONS.shield, label:"Compliance"   },
          {icon:ICONS.chart,  label:"Analytics"    },
        ].map((item,i)=>(
          <div key={item.label} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-0.5 cursor-pointer"
            style={{background:i===0?"rgba(0,255,255,0.08)":"transparent",color:i===0?C.cyan:C.muted}}>
            <Icon d={item.icon} size={14} stroke={i===0?C.cyan:C.muted} sw={1.8}/>{item.label}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col p-5 gap-3">
        <div className="rounded-2xl px-4 py-3 text-sm self-end max-w-xs"
          style={{background:"rgba(0,255,255,0.1)",border:`1px solid rgba(0,255,255,0.2)`,color:C.white}}>
          What are our enterprise SLA commitments?
        </div>
        <div className="rounded-2xl px-4 py-3.5 text-sm max-w-sm"
          style={{background:C.card,border:`1px solid ${C.border}`,color:"rgba(255,255,255,0.82)"}}>
          <div className="text-xs mb-2 flex items-center gap-1.5" style={{color:C.cyan}}>
            <OmnixMark size={12}/><b>OMNIX AI</b>
          </div>
          Based on enterprise-sla.pdf: 99.9% uptime, P1 response within 4 hours, automatic SLA credits for outages.
          <div className="flex gap-1.5 mt-2">
            <span className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
              style={{background:"rgba(0,255,255,0.07)",color:C.cyan,border:`1px solid rgba(0,255,255,0.14)`}}>
              <Icon d={ICONS.doc} size={9} stroke={C.cyan} sw={2}/>enterprise-sla.pdf
            </span>
          </div>
        </div>
        <div className="mt-auto flex gap-3 items-center px-4 py-3 rounded-2xl"
          style={{background:C.card,border:`1px solid ${C.border}`}}>
          <span className="text-sm flex-1" style={{color:"rgba(255,255,255,0.2)"}}>Ask OMNIX anything…</span>
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:C.cyan,color:C.navyDark}}>
            <Icon d={ICONS.arrow} size={13} stroke={C.navyDark} sw={2.5}/>
          </div>
        </div>
      </div>
    </div>,

    <div key="files" className="p-6 flex flex-col gap-4">
      <div className="rounded-2xl p-5" style={{background:C.card,border:`1px solid ${C.border}`}}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-bold text-sm" style={{color:C.white}}>demo files</div>
            <div className="text-xs" style={{color:C.faint}}>Shared with all workspace members</div>
          </div>
          <div className="flex -space-x-2">
            {[C.cyan,"#818cf8","#34d399"].map(c=><div key={c} className="w-7 h-7 rounded-full border-2" style={{background:c,borderColor:C.navyDark}}/>)}
          </div>
        </div>
        <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2"
          style={{borderColor:"rgba(0,255,255,0.2)",background:"rgba(0,255,255,0.03)"}}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{background:"rgba(0,255,255,0.08)"}}>
            <Icon d={ICONS.upload} size={22} stroke={C.cyan} sw={1.7}/>
          </div>
          <div className="text-sm font-semibold" style={{color:C.white}}>Drop files here or click to upload</div>
          <div className="text-xs" style={{color:C.faint}}>PDF, DOCX, TXT, Markdown supported</div>
          <div className="mt-2 px-5 py-2 rounded-xl text-sm font-bold" style={{background:C.cyan,color:C.navyDark}}>Choose files</div>
        </div>
      </div>
      <div>
        <div className="text-xs font-black mb-3" style={{color:C.faint,letterSpacing:"0.1em"}}>UPLOADED FILES</div>
        {["enterprise-sla.pdf","runbooks.md","compliance-policy.docx","api-reference.pdf"].map((file,i)=>(
          <div key={file} className="flex items-center gap-3 px-4 py-3 rounded-xl mb-1.5"
            style={{background:C.card,border:`1px solid ${C.border}`}}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:"rgba(255,255,255,0.04)"}}>
              <Icon d={ICONS.doc} size={16} stroke={C.muted} sw={1.7}/>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{color:C.white}}>{file}</div>
              <div className="text-xs" style={{color:C.faint}}>Indexed · {(i+1)*12}KB · {i+1}d ago</div>
            </div>
            <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg" style={{background:"rgba(34,197,94,0.1)",color:"#4ade80"}}>
              <Icon d={ICONS.check} size={9} stroke="#4ade80" sw={2.5}/>Ready
            </div>
          </div>
        ))}
      </div>
    </div>,

    <div key="history" className="p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{background:C.card,border:`1px solid ${C.border}`}}>
        <Icon d={ICONS.search} size={16} stroke={C.faint} sw={1.8}/>
        <span className="text-sm" style={{color:"rgba(255,255,255,0.2)"}}>Search chat history…</span>
      </div>
      {["Enterprise rollout blockers","SLA compliance requirements","API rate limit policies","Onboarding step checklist","Data residency rules"].map((chat,i)=>(
        <div key={chat} className="p-4 rounded-2xl cursor-pointer transition-all"
          style={{background:C.card,border:`1px solid ${C.border}`}}
          onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.borderC;}}
          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.border;}}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm" style={{color:C.white}}>{chat}</div>
            <span className="text-xs" style={{color:C.faint}}>{i+1}h ago</span>
          </div>
          <p className="text-xs leading-relaxed" style={{color:C.faint}}>
            OMNIX AI retrieved context from {i+2} documents and provided a grounded answer with source attribution…
          </p>
          <div className="mt-2.5 text-xs font-semibold flex items-center gap-1" style={{color:C.cyan}}>
            Open chat <Icon d={ICONS.arrow} size={11} stroke={C.cyan} sw={2.5}/>
          </div>
        </div>
      ))}
    </div>,

    <div key="settings" className="flex h-full">
      <div className="w-52 flex-shrink-0 p-4" style={{borderRight:`1px solid rgba(255,255,255,0.05)`}}>
        <div className="text-xs font-black mb-3 px-1" style={{color:C.faint,letterSpacing:"0.1em"}}>SETTINGS</div>
        {["Profile / Account","Workspace","Team Members","Notifications","Security","Interface","About / Terms"].map((item,i)=>(
          <div key={item} className="px-3 py-2 rounded-lg mb-0.5 text-sm cursor-pointer"
            style={{background:i===0?"rgba(0,255,255,0.08)":"transparent",color:i===0?C.cyan:C.muted}}>
            {item}
          </div>
        ))}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <div className="p-5 rounded-2xl" style={{background:C.card,border:`1px solid ${C.border}`}}>
          <div className="font-black text-base mb-1" style={{color:C.white}}>Profile / Account</div>
          <div className="text-xs mb-4" style={{color:C.faint}}>Manage the identity teammates see across OMNIX</div>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black"
              style={{background:`linear-gradient(135deg,${C.cyan},${C.blue})`,color:C.navyDark}}>A</div>
            <div>
              <div className="font-bold" style={{color:C.white}}>Alex Morgan</div>
              <div className="text-xs flex items-center gap-1" style={{color:C.faint}}>
                alex-morgan · <span style={{color:"#4ade80"}}>Authenticated</span>
                <Icon d={ICONS.check} size={10} stroke="#4ade80" sw={2.5}/>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Display name","OMNIX handle","Email","Role"].map(f=>(
              <div key={f} className="p-3 rounded-xl" style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`}}>
                <div className="text-xs mb-1" style={{color:C.faint}}>{f}</div>
                <div className="text-sm" style={{color:"rgba(255,255,255,0.6)"}}>—</div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 rounded-2xl" style={{background:C.card,border:`1px solid ${C.border}`}}>
          <div className="font-bold text-sm mb-3" style={{color:C.white}}>Workspace Alerts</div>
          {["Invite notifications","Workspace emails","Security alerts"].map(item=>(
            <div key={item} className="flex items-center justify-between py-2.5">
              <span className="text-sm" style={{color:C.muted}}>{item}</span>
              <div className="w-10 h-5 rounded-full flex items-center px-0.5" style={{background:C.cyan,justifyContent:"flex-end"}}>
                <div className="w-4 h-4 rounded-full bg-white"/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
  ];

  return (
    <section id="inside-app" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="50%" y="50%" size={700} color="rgba(0,255,255,0.06)" dur={24} delay={-8}/>
        <AnimatedGrid opacity={0.03}/>
      </SectionBg>
      <Sec className="max-w-6xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="mb-8 text-center sm:mb-12">
          <Label>INSIDE THE APP</Label>
          <H2>A workspace built for <GradText>real operations</GradText></H2>
          <motion.p variants={fadeUp} className="text-lg" style={{color:C.muted,maxWidth:520,margin:"0 auto"}}>
            Everything your team needs, organised into a clean, distraction-free interface.
          </motion.p>
        </motion.div>
        <motion.div variants={fadeUp} className="flex justify-center mb-8">
          <div className="omnix-scrollbar flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl p-1.5" style={{background:C.card,border:`1px solid ${C.border}`}}>
            {tabs.map((t,i)=>(
              <button key={t.label} onClick={()=>setActive(i)}
                className="flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition-all duration-200 sm:px-5"
                style={{background:active===i?"rgba(0,255,255,0.14)":"transparent",color:active===i?C.cyan:C.faint,border:active===i?`1px solid rgba(0,255,255,0.25)`:"1px solid transparent"}}>
                <Icon d={t.icon} size={15} stroke={active===i?C.cyan:C.faint} sw={active===i?2:1.7}/>{t.label}
              </button>
            ))}
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="rounded-2xl overflow-hidden"
          style={{border:`1px solid rgba(0,255,255,0.12)`,background:"rgba(6,18,30,0.98)",boxShadow:`0 40px 120px rgba(0,0,0,0.6),0 0 60px rgba(0,255,255,0.08)`}}>
          <div className="flex items-center gap-2 px-5 py-3.5"
            style={{borderBottom:`1px solid rgba(255,255,255,0.05)`,background:"rgba(255,255,255,0.02)"}}>
            <div className="flex gap-1.5">
              {["#ff5f57","#febc2e","#28c840"].map(c=><div key={c} className="w-2.5 h-2.5 rounded-full" style={{background:c}}/>)}
            </div>
            <div className="flex-1 text-center text-xs" style={{color:"rgba(255,255,255,0.25)"}}>OMNIX — {tabs[active].label}</div>
          </div>
          <div style={{height:420}}>
            <AnimatePresence mode="wait">
              <motion.div key={active} initial={{opacity:0,x:16}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-16}}
                transition={{duration:0.22}} className="h-full">
                {screens[active]}
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </Sec>
    </section>
  );
}

// ─── HOW IT WORKS ─────────────────────────────────────────────────────────────
function HowItWorks() {
  const steps=[
    {num:"01",title:"Create your workspace",    desc:"Sign up free, name your workspace, and invite your team. No credit card required. Up in 60 seconds.",  icon:ICONS.workspace},
    {num:"02",title:"Upload your knowledge",    desc:"Drop in PDFs, Markdown, DOCX, and text files. OMNIX indexes every document and makes it instantly searchable.", icon:ICONS.upload},
    {num:"03",title:"Ask precise questions",    desc:"Type any question in natural language. OMNIX retrieves context from your documents and returns grounded, cited answers.", icon:ICONS.chat},
    {num:"04",title:"Share across your team",   desc:"Teammates can ask their own questions, see shared history, and build on what others have already asked and learned.", icon:ICONS.team},
  ];
  return (
    <section id="how-it-works" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="50%" y="30%" size={700} color="rgba(0,51,255,0.07)" dur={26} delay={-7}/>
        <DriftingOrb x="80%" y="70%" size={500} color="rgba(0,255,255,0.06)" dur={20} delay={-3}/>
        <AnimatedGrid opacity={0.03}/>
      </SectionBg>
      <Sec className="max-w-5xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="mb-10 text-center sm:mb-16">
          <Label>HOW IT WORKS</Label>
          <H2>Set up in minutes, <GradText>value in seconds</GradText></H2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {steps.map((s,i)=>(
            <motion.div key={s.num} variants={fadeUp}
              className="relative overflow-hidden rounded-2xl p-5 sm:p-7"
              style={{background:C.card,border:`1px solid ${C.border}`}}>
              <div className="absolute top-5 right-5 text-6xl font-black select-none"
                style={{color:"rgba(0,255,255,0.04)"}}>{s.num}</div>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5"
                style={{background:"rgba(0,255,255,0.08)",border:`1px solid rgba(0,255,255,0.18)`}}>
                <Icon d={s.icon} size={22} stroke={C.cyan} sw={1.7}/>
              </div>
              <h3 className="font-black text-lg mb-2" style={{color:C.white}}>{s.title}</h3>
              <p className="text-sm leading-relaxed" style={{color:C.faint}}>{s.desc}</p>
              {i<steps.length-1&&(
                <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center"
                    style={{background:C.navyDark,border:`1px solid ${C.border}`}}>
                    <Icon d={ICONS.arrow} size={10} stroke={C.cyan} sw={2.5}/>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </Sec>
    </section>
  );
}

// ─── RETRIEVAL MODES ──────────────────────────────────────────────────────────
function RetrievalModes() {
  const [active,setActive]=useState(0);
  const modes=[
    {name:"Auto",      color:C.cyan,    desc:"OMNIX intelligently selects the best retrieval strategy for each question — workspace docs, live web, or a blend of both. Zero configuration needed.",                           icon:ICONS.bolt   },
    {name:"Workspace", color:"#818cf8", desc:"Retrieval is strictly limited to documents your team has uploaded. Answers are always grounded in your own knowledge base, with no external data ever included.",               icon:ICONS.files  },
    {name:"Web",       color:"#34d399", desc:"OMNIX queries the live web in real time and synthesises up-to-date answers. Ideal for current events, public documentation, and rapidly changing external information.",       icon:ICONS.globe  },
    {name:"Hybrid",    color:"#fb923c", desc:"Combines workspace documents with live web context. You get the precision of private knowledge and the freshness of real-time data — simultaneously, in a single answer.",     icon:ICONS.link   },
  ];
  const m=modes[active];
  return (
    <section id="retrieval" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="25%" y="50%" size={600} color="rgba(0,255,255,0.06)" dur={22} delay={-5}/>
        <DriftingOrb x="80%" y="40%" size={500} color="rgba(0,51,255,0.07)" dur={28} delay={-12}/>
      </SectionBg>
      <Sec className="max-w-5xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Label>RETRIEVAL MODES</Label>
          <H2>Choose how <GradText>OMNIX thinks</GradText></H2>
        </motion.div>
        <motion.div variants={fadeUp} className="flex flex-col md:flex-row gap-6 items-start">
          <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible">
            {modes.map((md,i)=>(
              <button key={md.name} onClick={()=>setActive(i)}
                className="flex items-center gap-3 px-5 py-3.5 rounded-2xl text-sm font-bold whitespace-nowrap transition-all duration-200"
                style={{
                  background:active===i?`${md.color}14`:C.card,
                  border:`1px solid ${active===i?`${md.color}35`:C.border}`,
                  color:active===i?md.color:C.faint,
                  boxShadow:active===i?`0 0 24px ${md.color}16`:"none",
                }}>
                <Icon d={md.icon} size={16} stroke={active===i?md.color:C.faint} sw={1.8}/>
                {md.name}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={active}
              initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}}
              transition={{duration:0.28}}
              className="flex-1 rounded-2xl p-5 sm:p-8"
              style={{background:`${m.color}06`,border:`1px solid ${m.color}28`,boxShadow:`0 0 40px ${m.color}10`}}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{background:`${m.color}14`,border:`1px solid ${m.color}28`}}>
                  <Icon d={m.icon} size={22} stroke={m.color} sw={1.7}/>
                </div>
                <div>
                  <div className="font-black text-xl" style={{color:C.white}}>{m.name} mode</div>
                  <div className="text-xs font-bold" style={{color:m.color}}>Active retrieval strategy</div>
                </div>
              </div>
              <p className="text-base leading-relaxed mb-6" style={{color:C.muted}}>{m.desc}</p>
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl"
                style={{background:"rgba(255,255,255,0.03)",border:`1px solid rgba(255,255,255,0.06)`}}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:m.color}}/>
                <span className="text-sm font-semibold" style={{color:m.color}}>{m.name}</span>
                <span className="text-sm" style={{color:C.faint}}>— currently active for this workspace</span>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </Sec>
    </section>
  );
}

// ─── SECURITY ─────────────────────────────────────────────────────────────────
function Security() {
  const badges=[
    {label:"SOC 2 Type II",    color:C.cyan   },
    {label:"GDPR Compliant",   color:"#818cf8"},
    {label:"AES-256",          color:"#34d399"},
    {label:"TLS 1.3",          color:"#fb923c"},
    {label:"Zero Trust",       color:"#f472b6"},
    {label:"Audit Logs",       color:C.cyan   },
  ];
  return (
    <section id="security" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="88%" y="30%" size={600} color="rgba(0,255,255,0.07)" dur={24} delay={-5}/>
        <DriftingOrb x="10%" y="70%" size={480} color="rgba(0,51,255,0.06)" dur={20} delay={-9}/>
        <ParticleField/>
      </SectionBg>
      <Sec className="max-w-5xl mx-auto relative z-10">
        <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2 md:gap-16">
          <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
            {badges.map(b=>(
              <motion.div key={b.label} variants={fadeUp}
                className="flex items-center gap-2.5 px-5 py-3 rounded-2xl text-sm font-bold"
                style={{background:`${b.color}0d`,border:`1px solid ${b.color}28`,color:b.color}}>
                <Icon d={ICONS.shield} size={15} stroke={b.color} sw={1.8}/>
                {b.label}
              </motion.div>
            ))}
            <motion.div variants={fadeUp} className="w-full p-5 rounded-2xl mt-2"
              style={{background:"rgba(255,255,255,0.02)",border:`1px solid rgba(255,255,255,0.06)`}}>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-2 h-2 rounded-full" style={{background:"#22c55e"}}/>
                <span className="text-xs font-black" style={{color:"rgba(255,255,255,0.35)",letterSpacing:"0.1em"}}>SECURITY STATUS</span>
              </div>
              {["Identity verified","Documents encrypted","Workspace isolated","Session active"].map(item=>(
                <div key={item} className="flex items-center justify-between py-1.5">
                  <span className="text-sm" style={{color:C.muted}}>{item}</span>
                  <div className="flex items-center gap-1.5 text-xs" style={{color:"#4ade80"}}>
                    <Icon d={ICONS.check} size={11} stroke="#4ade80" sw={2.5}/>OK
                  </div>
                </div>
              ))}
            </motion.div>
          </motion.div>
          <motion.div variants={fadeUp}>
            <Label>ENTERPRISE SECURITY</Label>
            <H2>Your knowledge stays <GradText>yours — always</GradText></H2>
            <motion.p variants={fadeUp} className="text-base leading-relaxed mb-6" style={{color:C.muted}}>
              OMNIX was built security-first. Every screen requires an active session. Every file is encrypted at rest with AES-256. Every action is logged for compliance.
            </motion.p>
            {[
              "Identity-first: every page gated behind active session",
              "End-to-end encryption for all data in transit",
              "Granular role-based access per workspace",
              "Complete audit trail for compliance teams",
              "Data residency controls — choose your region",
            ].map(item=>(
              <motion.div key={item} variants={fadeUp} className="flex items-start gap-3 mb-3">
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{background:"rgba(0,255,255,0.12)",border:`1px solid rgba(0,255,255,0.25)`}}>
                  <Icon d={ICONS.check} size={9} stroke={C.cyan} sw={2.5}/>
                </div>
                <span className="text-sm leading-relaxed" style={{color:C.muted}}>{item}</span>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </Sec>
    </section>
  );
}

// ─── PRICING ──────────────────────────────────────────────────────────────────
function Pricing() {
  const [annual,setAnnual]=useState(true);
  const plans=[
    {name:"Starter",   price:"Free",              sub:"For small teams getting started",        accent:C.faint, popular:false,
     features:["3 workspace members","5 document uploads","Chat history (30 days)","Auto retrieval mode","Community support"],
     cta:"Get started free"},
    {name:"Pro",       price:annual?"$18":"$24",  sub:"Per member / month, billed annually",   accent:C.cyan,  popular:true,
     features:["Unlimited members","Unlimited document uploads","Unlimited chat history","All retrieval modes","Priority support","Workspace analytics","API access"],
     cta:"Start Pro trial"},
    {name:"Enterprise",price:"Custom",             sub:"For large orgs with advanced needs",    accent:"#818cf8",popular:false,
     features:["Everything in Pro","SSO / SAML","Custom data residency","SLA guarantee (99.99%)","Dedicated support","Custom integrations","Compliance exports","On-prem option"],
     cta:"Contact sales"},
  ];
  return (
    <section id="pricing" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="50%" y="40%" size={800} color="rgba(0,255,255,0.07)" dur={30} delay={-10}/>
        <DriftingOrb x="15%" y="60%" size={500} color="rgba(0,51,255,0.06)" dur={22} delay={-6}/>
        <DriftingOrb x="88%" y="35%" size={450} color="rgba(0,51,255,0.05)" dur={18} delay={-1}/>
        <ParticleField/>
      </SectionBg>
      <Sec className="max-w-6xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Label>PRICING</Label>
          <H2>Simple, transparent pricing</H2>
          <motion.p variants={fadeUp} className="text-lg mb-8" style={{color:C.muted}}>Start free. Scale as your team grows.</motion.p>
          <motion.div variants={fadeUp} className="inline-flex items-center gap-1 p-1.5 rounded-2xl"
            style={{background:C.card,border:`1px solid ${C.border}`}}>
            <button onClick={()=>setAnnual(false)}
              className="px-5 py-2 rounded-xl text-sm font-bold transition-all"
              style={{background:!annual?"rgba(0,255,255,0.14)":"transparent",color:!annual?C.cyan:C.faint,border:!annual?`1px solid rgba(0,255,255,0.25)`:"none"}}>
              Monthly
            </button>
            <button onClick={()=>setAnnual(true)}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition-all"
              style={{background:annual?"rgba(0,255,255,0.14)":"transparent",color:annual?C.cyan:C.faint,border:annual?`1px solid rgba(0,255,255,0.25)`:"none"}}>
              Annual
              <span className="text-xs px-2 py-0.5 rounded-full font-black" style={{background:"rgba(34,197,94,0.15)",color:"#4ade80"}}>-25%</span>
            </button>
          </motion.div>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map(p=>(
            <motion.div key={p.name} variants={fadeUp}
              className="relative rounded-2xl p-7 flex flex-col"
              style={{background:p.popular?`linear-gradient(145deg,rgba(0,255,255,0.07),rgba(0,51,255,0.07))`:C.card,border:p.popular?`1px solid rgba(0,255,255,0.28)`:`1px solid ${C.border}`,boxShadow:p.popular?`0 0 60px rgba(0,255,255,0.1),0 40px 80px rgba(0,0,0,0.3)`:"none"}}>
              {p.popular&&(
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1 rounded-full text-xs font-black"
                  style={{background:C.cyan,color:C.navyDark}}>MOST POPULAR</div>
              )}
              <div className="mb-6">
                <div className="font-black text-lg mb-1" style={{color:p.popular?C.cyan:C.white}}>{p.name}</div>
                <div className="text-xs mb-4" style={{color:C.faint}}>{p.sub}</div>
                <div className="flex items-end gap-1">
                  <span className="text-5xl font-black" style={{color:C.white}}>{p.price}</span>
                  {p.price!=="Free"&&p.price!=="Custom"&&<span className="text-sm mb-2" style={{color:C.faint}}>/mo</span>}
                </div>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {p.features.map(f=>(
                  <li key={f} className="flex items-start gap-2.5 text-sm">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                      style={{background:`${p.accent}18`,border:`1px solid ${p.accent}30`}}>
                      <Icon d={ICONS.check} size={8} stroke={p.accent} sw={2.5}/>
                    </div>
                    <span style={{color:C.muted}}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href="/register"
                className="block w-full py-3.5 rounded-xl text-center font-black text-sm transition-all duration-200"
                  style={{background:p.popular?C.cyan:"transparent",border:p.popular?"none":`1px solid ${p.accent}50`,color:p.popular?C.navyDark:p.accent}}
                  onMouseEnter={e=>{if(p.popular){(e.currentTarget as HTMLElement).style.boxShadow=`0 0 40px rgba(0,255,255,0.5)`;}else{(e.currentTarget as HTMLElement).style.background=`${p.accent}14`;}}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.boxShadow="none";if(!p.popular)(e.currentTarget as HTMLElement).style.background="transparent";}}>
                  {p.cta}
              </Link>
            </motion.div>
          ))}
        </div>
      </Sec>
    </section>
  );
}

// ─── TESTIMONIALS ─────────────────────────────────────────────────────────────
function Testimonials() {
  const tees=[
    {text:"OMNIX transformed how our support team handles complex product questions. We went from 15-minute research cycles to instant, accurate answers backed by our actual documentation.",author:"Sarah Chen",    role:"Head of Customer Success · Meridian Labs",color:C.cyan,   av:"SC"},
    {text:"The workspace model is exactly right for enterprise. Private knowledge stays private, history is searchable, and the team collaboration features make it genuinely useful at scale.",  author:"Marcus Williams",role:"VP Engineering · Vertex Systems",          color:"#818cf8",av:"MW"},
    {text:"We replaced three different tools with OMNIX. The precision of answers grounded in our own documents is unlike anything we'd used before. Our ops team loves it.",                   author:"Priya Nair",    role:"Operations Lead · Foundry Digital",          color:"#34d399",av:"PN"},
    {text:"The retrieval modes are a game-changer. Being able to switch between workspace-only and hybrid web search on the fly means we always get exactly the context we need.",              author:"James Liu",     role:"CTO · Clearline AI",                        color:"#fb923c",av:"JL"},
    {text:"Setup took under 10 minutes. We uploaded our runbooks, invited the team, and immediately started getting value. The onboarding experience is incredibly smooth.",                    author:"Elena Moser",   role:"DevOps Lead · Stratum HQ",                  color:"#f472b6",av:"EM"},
    {text:"Security was our biggest concern. OMNIX's SOC 2 certification and identity-first approach gave us the confidence to roll it out to 200+ team members enterprise-wide.",              author:"David Park",    role:"CISO · Orbit Health",                       color:C.cyan,   av:"DP"},
  ];
  return (
    <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="28%" y="50%" size={600} color="rgba(0,51,255,0.06)" dur={28} delay={-8}/>
        <DriftingOrb x="76%" y="50%" size={500} color="rgba(0,255,255,0.05)" dur={22} delay={-3}/>
        <AnimatedGrid opacity={0.025}/>
      </SectionBg>
      <Sec className="max-w-6xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="text-center mb-16">
          <Label>TESTIMONIALS</Label>
          <H2>Trusted by teams that need <GradText>precision</GradText></H2>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tees.map(t=>(
            <motion.div key={t.author} variants={fadeUp}
              className="p-6 rounded-2xl flex flex-col gap-5 transition-all duration-300"
              style={{background:C.card,border:`1px solid ${C.border}`}}
              onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=`${t.color}28`;(e.currentTarget as HTMLElement).style.transform="translateY(-3px)";}}
              onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.border;(e.currentTarget as HTMLElement).style.transform="translateY(0)";}}>
              <div className="flex gap-0.5">
                {[...Array(5)].map((_,i)=>(
                  <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={t.color}>
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
                  </svg>
                ))}
              </div>
              <p className="text-sm leading-relaxed flex-1" style={{color:"rgba(255,255,255,0.56)"}}>&quot;{t.text}&quot;</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0"
                  style={{background:`${t.color}16`,border:`1px solid ${t.color}28`,color:t.color}}>
                  {t.av}
                </div>
                <div>
                  <div className="text-sm font-black" style={{color:C.white}}>{t.author}</div>
                  <div className="text-xs" style={{color:C.faint}}>{t.role}</div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </Sec>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────
const FAQS=[
  {q:"How does OMNIX retrieve context from my documents?",     a:"OMNIX indexes your uploaded files using semantic search. When you ask a question, it retrieves the most relevant chunks of text from your documents and passes them to the AI as context — ensuring grounded, citation-backed answers."},
  {q:"Is my data private and secure?",                         a:"Absolutely. OMNIX uses AES-256 encryption for data at rest and TLS for data in transit. Your documents are only accessible to members of your workspace. We are SOC 2 Type II certified and fully GDPR compliant."},
  {q:"What file types can I upload?",                          a:"OMNIX supports PDF, DOCX, TXT, and Markdown files today, with CSV and XLSX support coming soon. Files are automatically indexed and made available to the AI within seconds of upload."},
  {q:"How many team members can I have?",                      a:"The Starter plan supports up to 3 members. Pro unlocks unlimited members. Enterprise plans can accommodate any org size with custom SLAs and dedicated infrastructure."},
  {q:"What retrieval modes does OMNIX support?",               a:"OMNIX offers four modes: Auto (smart selection), Workspace (private docs only), Web (real-time web search), and Hybrid (workspace + web combined). You can switch modes mid-conversation."},
  {q:"Can I use OMNIX via API?",                               a:"Yes. Pro and Enterprise plans include API access. You can query OMNIX programmatically, integrate it into your existing tools, and build on top of the retrieval layer with webhooks and custom integrations."},
];

function FAQ() {
  const [open,setOpen]=useState<number|null>(null);
  return (
    <section className="relative overflow-hidden px-4 py-16 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="80%" y="50%" size={500} color="rgba(0,255,255,0.06)" dur={20} delay={-4}/>
        <DriftingOrb x="20%" y="40%" size={400} color="rgba(0,51,255,0.05)" dur={26} delay={-11}/>
      </SectionBg>
      <Sec className="max-w-3xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="text-center mb-14">
          <Label>FAQ</Label>
          <H2>Frequently asked <GradText>questions</GradText></H2>
        </motion.div>
        <div className="space-y-3">
          {FAQS.map((faq,i)=>(
            <motion.div key={i} variants={fadeUp}
              className="rounded-2xl overflow-hidden transition-all duration-200"
              style={{background:open===i?"rgba(0,255,255,0.05)":C.card,border:open===i?`1px solid rgba(0,255,255,0.22)`:`1px solid ${C.border}`}}>
              <button className="w-full flex items-center justify-between px-6 py-5 text-left"
                onClick={()=>setOpen(open===i?null:i)}>
                <span className="font-bold text-sm pr-4" style={{color:C.white}}>{faq.q}</span>
                <motion.div animate={{rotate:open===i?45:0}} transition={{duration:0.22}}
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{background:open===i?"rgba(0,255,255,0.15)":"rgba(255,255,255,0.06)",border:`1px solid ${open===i?"rgba(0,255,255,0.25)":C.border}`}}>
                  <Icon d={ICONS.plus} size={11} stroke={open===i?C.cyan:C.muted} sw={2.5}/>
                </motion.div>
              </button>
              <AnimatePresence>
                {open===i&&(
                  <motion.div initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}} exit={{height:0,opacity:0}}
                    transition={{duration:0.25}} style={{overflow:"hidden"}}>
                    <p className="px-6 pb-5 text-sm leading-relaxed" style={{color:C.faint}}>{faq.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Sec>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────
function CTA() {
  return (
    <section id="get-started" className="relative overflow-hidden px-4 py-16 scroll-mt-24 sm:px-6 sm:py-28">
      <SectionBg>
        <DriftingOrb x="50%" y="50%" size={1000} color="rgba(0,255,255,0.09)" dur={35} delay={-15}/>
        <DriftingOrb x="20%" y="75%" size={500} color="rgba(0,51,255,0.07)" dur={22} delay={-8}/>
        <DriftingOrb x="82%" y="25%" size={450} color="rgba(0,255,255,0.06)" dur={28} delay={-3}/>
        <ParticleField/>
      </SectionBg>
      <Sec className="max-w-5xl mx-auto relative z-10">
        <motion.div variants={fadeUp} className="rounded-3xl p-px"
          style={{background:`linear-gradient(135deg,rgba(0,255,255,0.35),rgba(0,51,255,0.2),transparent 70%)`}}>
          <div className="relative overflow-hidden rounded-3xl px-5 py-14 text-center sm:px-12 sm:py-24"
            style={{background:`linear-gradient(145deg,rgba(6,20,38,0.99),rgba(5,14,26,0.99))`}}>
            <SectionBg>
              <AnimatedGrid opacity={0.03}/>
              <div className="absolute inset-0"
                style={{background:`radial-gradient(ellipse at 50% 0%,rgba(0,255,255,0.09) 0%,transparent 65%)`}}/>
            </SectionBg>
            <div className="relative z-10">
              <motion.div variants={fadeUp} className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-black mb-8"
                style={{background:"rgba(0,255,255,0.07)",border:`1px solid rgba(0,255,255,0.22)`,color:C.cyan,letterSpacing:"0.1em"}}>
                <span className="w-1.5 h-1.5 rounded-full" style={{background:C.cyan}}/>
                START WITH OMNIX
              </motion.div>
              <motion.h2 variants={fadeUp} className="mb-6 text-3xl font-black leading-tight tracking-tight sm:text-6xl" style={{color:C.white}}>
                Bring a secure AI workspace<br className="hidden sm:block"/><GradText> to your team today.</GradText>
              </motion.h2>
              <motion.p variants={fadeUp} className="mb-8 text-base sm:mb-12 sm:text-xl" style={{color:C.muted,maxWidth:500,marginInline:"auto"}}>
                Sign in to continue an existing workspace, or create a new account and get started in minutes — no credit card required.
              </motion.p>
              <motion.div variants={fadeUp} className="mx-auto flex max-w-sm flex-col items-center justify-center gap-3 sm:max-w-none sm:flex-row sm:flex-wrap sm:gap-4">
                <CyanBtn large href="/register">Start working free <Icon d={ICONS.arrow} size={18} stroke={C.navyDark} sw={2.5}/></CyanBtn>
                <GhostBtn large href="/login">Sign in to workspace</GhostBtn>
              </motion.div>
              <motion.div variants={fadeUp} className="flex items-center justify-center gap-8 mt-10 flex-wrap">
                {["Free for small teams","No credit card","SOC 2 certified","GDPR compliant"].map(t=>(
                  <span key={t} className="text-xs flex items-center gap-1.5" style={{color:"rgba(255,255,255,0.3)"}}>
                    <Icon d={ICONS.check} size={11} stroke="rgba(0,255,255,0.45)" sw={2.5}/>{t}
                  </span>
                ))}
              </motion.div>
            </div>
          </div>
        </motion.div>
      </Sec>
    </section>
  );
}

// ─── FOOTER ───────────────────────────────────────────────────────────────────
function Footer() {
  const cols=[
    {title:"Product",   links:["Features","How it works","Pricing","Changelog","Roadmap","Status"]},
    {title:"Company",   links:["About","Blog","Careers","Press","Brand","Contact"]},
    {title:"Resources", links:["Docs","API Reference","Community","Guides","Security","Partners"]},
    {title:"Legal",     links:["Privacy","Terms","Cookie Policy","GDPR","Compliance","DPA"]},
  ];
  const social=[
    {icon:ICONS.link, label:"X"},
    {icon:ICONS.globe, label:"LinkedIn"},
    {icon:ICONS.files, label:"GitHub"},
    {icon:ICONS.play,  label:"YouTube"},
  ];
  return (
    <footer className="relative px-4 pb-8 pt-14 sm:px-8 sm:pb-10 sm:pt-20" style={{borderTop:`1px solid rgba(255,255,255,0.05)`}}>
      <SectionBg>
        <DriftingOrb x="50%" y="50%" size={600} color="rgba(0,255,255,0.04)" dur={32} delay={-6}/>
      </SectionBg>
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6 pb-14 mb-14"
          style={{borderBottom:`1px solid rgba(255,255,255,0.06)`}}>
          <div>
            <h3 className="font-black text-xl mb-1" style={{color:C.white}}>Stay in the loop</h3>
            <p className="text-sm" style={{color:C.faint}}>Product updates, security advisories, and team tips — monthly.</p>
          </div>
          <div className="flex w-full flex-col gap-3 min-[380px]:flex-row md:w-auto">
            <input type="email" placeholder="you@company.com"
              className="min-w-0 flex-1 rounded-xl px-4 py-3 text-sm outline-none md:w-64"
              style={{background:C.card,border:`1px solid ${C.border}`,color:C.white}}/>
            <button className="px-5 py-3 rounded-xl text-sm font-black flex items-center gap-2"
              style={{background:C.cyan,color:C.navyDark}}>
              Subscribe<Icon d={ICONS.arrow} size={13} stroke={C.navyDark} sw={2.5}/>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-14">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <OmnixMark size={30}/>
              <span className="font-black tracking-[0.14em] text-lg" style={{color:C.white}}>OMNIX</span>
            </div>
            <p className="text-sm leading-relaxed mb-6" style={{color:C.faint}}>
              AI workspace for knowledge teams. Precise answers, secure by design.
            </p>
            <div className="flex gap-3">
              {social.map(s=>(
                <a key={s.label} href="#"
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
                  style={{background:C.card,border:`1px solid ${C.border}`}}
                  onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.borderC;}}
                  onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.borderColor=C.border;}}>
                  <Icon d={s.icon} size={14} stroke={C.faint} sw={1.8}/>
                </a>
              ))}
            </div>
          </div>
          {cols.map(col=>(
            <div key={col.title}>
              <div className="text-xs font-black tracking-widest mb-5"
                style={{color:C.faint,letterSpacing:"0.1em"}}>{col.title.toUpperCase()}</div>
              <ul className="space-y-2.5">
                {col.links.map(link=>(
                  <li key={link}>
                    <a href="#" className="text-sm transition-colors duration-200" style={{color:"rgba(255,255,255,0.38)"}}
                      onMouseEnter={e=>(e.currentTarget.style.color=C.white)}
                      onMouseLeave={e=>(e.currentTarget.style.color="rgba(255,255,255,0.38)")}>
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8"
          style={{borderTop:`1px solid rgba(255,255,255,0.05)`}}>
          <div className="flex items-center gap-6">
            <p className="text-xs" style={{color:"rgba(255,255,255,0.2)"}}>© 2026 OMNIX. All rights reserved.</p>
            <div className="flex items-center gap-1.5 text-xs" style={{color:"rgba(255,255,255,0.2)"}}>
              <span className="w-1.5 h-1.5 rounded-full" style={{background:"#22c55e"}}/>All systems operational
            </div>
          </div>
          <p className="text-xs" style={{color:"rgba(255,255,255,0.14)"}}>Built for teams that need answers they can trust.</p>
        </div>
      </div>
    </footer>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export function LandingExperience() {
  return (
    <div className="min-h-screen"
      style={{background:C.navyDark,fontFamily:"'Inter','DM Sans',system-ui,sans-serif",WebkitFontSmoothing:"antialiased"}}>
      <Navbar/>
      <Hero/>
      <Marquee/>
      <Stats/>
      <Features/>
      <AppScreenshots/>
      <HowItWorks/>
      <RetrievalModes/>
      <Security/>
      <Pricing/>
      <Testimonials/>
      <FAQ/>
      <CTA/>
      <Footer/>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AnimatedGrid,
  C,
  DriftingOrb,
  GradText,
  H2,
  ICONS,
  Icon,
  Label,
  OmnixMark,
  Sec,
  SectionBg,
  fadeUp,
} from "@/components/landing/LandingPrimitives";

// ─── APP SCREENSHOTS ──────────────────────────────────────────────────────────
export function AppScreenshots() {
  const [active,setActive]=useState(0);
  const tabs=[
    {label:"AI Chat",   icon:ICONS.chat    },
    {label:"Files",     icon:ICONS.files   },
    {label:"History",   icon:ICONS.clock   },
    {label:"Settings",  icon:ICONS.settings},
  ];

  const screens=[
    <div key="chat" className="flex h-full">
      <div className="w-52 flex-shrink-0 p-4" style={{borderRight:`1px solid var(--omnix-rgba-255-255-255-0-05)`,background:"var(--omnix-rgba-0-0-0-0-2)"}}>
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
            style={{background:i===0?"var(--omnix-rgba-0-255-255-0-08)":"transparent",color:i===0?C.cyan:C.muted}}>
            <Icon d={item.icon} size={14} stroke={i===0?C.cyan:C.muted} sw={1.8}/>{item.label}
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col p-5 gap-3">
        <div className="rounded-2xl px-4 py-3 text-sm self-end max-w-xs"
          style={{background:"var(--omnix-rgba-0-255-255-0-1)",border:`1px solid var(--omnix-rgba-0-255-255-0-2)`,color:C.white}}>
          What changed in the onboarding notes?
        </div>
        <div className="rounded-2xl px-4 py-3.5 text-sm max-w-sm"
          style={{background:C.card,border:`1px solid ${C.border}`,color:"var(--omnix-rgba-255-255-255-0-82)"}}>
          <div className="text-xs mb-2 flex items-center gap-1.5" style={{color:C.cyan}}>
            <OmnixMark size={12}/><b>OMNIX AI</b>
          </div>
          Based on onboarding-notes.md: invite copy changed, source setup moved earlier, and the owner checklist still needs review.
          <div className="flex gap-1.5 mt-2">
            <span className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
              style={{background:"var(--omnix-rgba-0-255-255-0-07)",color:C.cyan,border:`1px solid var(--omnix-rgba-0-255-255-0-14)`}}>
              <Icon d={ICONS.doc} size={9} stroke={C.cyan} sw={2}/>onboarding-notes.md
            </span>
          </div>
        </div>
        <div className="mt-auto flex gap-3 items-center px-4 py-3 rounded-2xl"
          style={{background:C.card,border:`1px solid ${C.border}`}}>
          <span className="text-sm flex-1" style={{color:"var(--omnix-rgba-255-255-255-0-2)"}}>Ask OMNIX anything…</span>
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
            {[C.cyan,"var(--omnix-color-818cf8)","var(--omnix-color-34d399)"].map(c=><div key={c} className="w-7 h-7 rounded-full border-2" style={{background:c,borderColor:C.navyDark}}/>)}
          </div>
        </div>
        <div className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-2"
          style={{borderColor:"var(--omnix-rgba-0-255-255-0-2)",background:"var(--omnix-rgba-0-255-255-0-03)"}}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{background:"var(--omnix-rgba-0-255-255-0-08)"}}>
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
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:"var(--omnix-rgba-255-255-255-0-04)"}}>
              <Icon d={ICONS.doc} size={16} stroke={C.muted} sw={1.7}/>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold" style={{color:C.white}}>{file}</div>
              <div className="text-xs" style={{color:C.faint}}>Indexed · {(i+1)*12}KB · {i+1}d ago</div>
            </div>
            <div className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg" style={{background:"var(--omnix-rgba-34-197-94-0-1)",color:"var(--omnix-color-4ade80)"}}>
              <Icon d={ICONS.check} size={9} stroke="var(--omnix-color-4ade80)" sw={2.5}/>Ready
            </div>
          </div>
        ))}
      </div>
    </div>,

    <div key="history" className="p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
        style={{background:C.card,border:`1px solid ${C.border}`}}>
        <Icon d={ICONS.search} size={16} stroke={C.faint} sw={1.8}/>
        <span className="text-sm" style={{color:"var(--omnix-rgba-255-255-255-0-2)"}}>Search chat history…</span>
      </div>
      {["Launch checklist blockers","Support handoff notes","API usage notes","Onboarding step checklist","Source visibility rules"].map((chat,i)=>(
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
      <div className="w-52 flex-shrink-0 p-4" style={{borderRight:`1px solid var(--omnix-rgba-255-255-255-0-05)`}}>
        <div className="text-xs font-black mb-3 px-1" style={{color:C.faint,letterSpacing:"0.1em"}}>SETTINGS</div>
        {["Profile / Account","Workspace","Team Members","Notifications","Security","Interface","About / Terms"].map((item,i)=>(
          <div key={item} className="px-3 py-2 rounded-lg mb-0.5 text-sm cursor-pointer"
            style={{background:i===0?"var(--omnix-rgba-0-255-255-0-08)":"transparent",color:i===0?C.cyan:C.muted}}>
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
                alex-morgan · <span style={{color:"var(--omnix-color-4ade80)"}}>Authenticated</span>
                <Icon d={ICONS.check} size={10} stroke="var(--omnix-color-4ade80)" sw={2.5}/>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Display name","OMNIX handle","Email","Role"].map(f=>(
              <div key={f} className="p-3 rounded-xl" style={{background:"var(--omnix-rgba-255-255-255-0-02)",border:`1px solid ${C.border}`}}>
                <div className="text-xs mb-1" style={{color:C.faint}}>{f}</div>
                <div className="text-sm" style={{color:"var(--omnix-rgba-255-255-255-0-6)"}}>—</div>
              </div>
            ))}
          </div>
        </div>
        <div className="p-4 rounded-2xl" style={{background:C.card,border:`1px solid ${C.border}`}}>
          <div className="font-bold text-sm mb-3" style={{color:C.white}}>In-App Notifications</div>
          {["Mention alerts","Workspace invitations","Security notices"].map(item=>(
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
        <DriftingOrb x="50%" y="50%" size={700} color="var(--omnix-rgba-0-255-255-0-06)" dur={24} delay={-8}/>
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
                style={{background:active===i?"var(--omnix-rgba-0-255-255-0-14)":"transparent",color:active===i?C.cyan:C.faint,border:active===i?`1px solid var(--omnix-rgba-0-255-255-0-25)`:"1px solid transparent"}}>
                <Icon d={t.icon} size={15} stroke={active===i?C.cyan:C.faint} sw={active===i?2:1.7}/>{t.label}
              </button>
            ))}
          </div>
        </motion.div>
        <motion.div variants={fadeUp} className="rounded-2xl overflow-hidden"
          style={{border:`1px solid var(--omnix-rgba-0-255-255-0-12)`,background:"var(--omnix-rgba-6-18-30-0-98)",boxShadow:`0 40px 120px var(--omnix-rgba-0-0-0-0-6),0 0 60px var(--omnix-rgba-0-255-255-0-08)`}}>
          <div className="flex items-center gap-2 px-5 py-3.5"
            style={{borderBottom:`1px solid var(--omnix-rgba-255-255-255-0-05)`,background:"var(--omnix-rgba-255-255-255-0-02)"}}>
            <div className="flex gap-1.5">
              {["var(--omnix-color-ff5f57)","var(--omnix-color-febc2e)","var(--omnix-color-28c840)"].map(c=><div key={c} className="w-2.5 h-2.5 rounded-full" style={{background:c}}/>)}
            </div>
            <div className="flex-1 text-center text-xs" style={{color:"var(--omnix-rgba-255-255-255-0-25)"}}>OMNIX — {tabs[active].label}</div>
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

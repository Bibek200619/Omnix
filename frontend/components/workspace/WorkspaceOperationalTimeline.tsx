"use client";

import { motion, AnimatePresence } from "framer-motion";
import { 
  Activity, 
  ChevronRight, 
  CircleDot, 
  Clock, 
  Compass, 
  Flag, 
  History, 
  Layers3, 
  Loader2, 
  Milestone, 
  Zap 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ClientTime } from "@/components/ui/ClientTime";
import type { WorkspaceOperationalTimelineEvent, WorkspaceInitiative } from "@/lib/workspace-types";

type OperationalTimelineProps = {
  events: WorkspaceOperationalTimelineEvent[];
  initiatives?: WorkspaceInitiative[];
  loading?: boolean;
  className?: string;
};

const EVENT_ICONS: Record<string, any> = {
  initiative_started: Flag,
  momentum_spike: Zap,
  decision_made: CircleDot,
  synthesis: Layers3,
  slowdown: Clock,
  default: Activity
};

export function WorkspaceOperationalTimeline({
  events,
  initiatives = [],
  loading = false,
  className
}: OperationalTimelineProps) {
  if (loading && events.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center p-12 text-slate-500", className)}>
        <Loader2 className="h-6 w-6 animate-spin mb-3" />
        <p className="text-sm font-medium">Synchronizing operational continuity...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={cn("p-12 text-center rounded-[18px] border border-dashed border-white/10 bg-white/[0.02]", className)}>
        <History className="h-8 w-8 mx-auto mb-4 text-white/20" />
        <h3 className="text-sm font-bold text-white/60 mb-1">No Continuity History</h3>
        <p className="text-xs text-white/30">Organizational progression events will appear here.</p>
      </div>
    );
  }

  return (
    <section className={cn("relative space-y-6", className)}>
      {/* Active Initiatives Section */}
      {initiatives.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {initiatives.map((initiative) => (
            <motion.div
              key={initiative.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="group relative overflow-hidden rounded-xl border border-white/5 bg-[rgba(6,10,20,0.6)] p-4 transition-all hover:border-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.1)]"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80">Active Initiative</span>
                  </div>
                  <h4 className="text-sm font-bold text-white group-hover:text-cyan-200 transition-colors truncate">
                    {initiative.name}
                  </h4>
                </div>
                <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Compass className="h-4 w-4 text-cyan-400" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(initiative.momentum_score * 10, 100)}%` }}
                    className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
                  />
                </div>
                <span className="text-[10px] font-bold text-white/40">
                  {Math.round(initiative.momentum_score * 10)}% Momentum
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Timeline Feed */}
      <div className="relative">
        <div className="absolute left-[19px] top-4 bottom-4 w-px bg-gradient-to-b from-cyan-500/40 via-white/5 to-transparent" />
        
        <div className="space-y-8">
          {events.map((event, index) => {
            const Icon = EVENT_ICONS[event.event_type] || EVENT_ICONS.default;
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="relative pl-12"
              >
                <div className="absolute left-0 top-0 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-[#060a14] shadow-[var(--omnix-glow-xs)]">
                  <Icon className="h-4 w-4 text-cyan-400" />
                  {index === 0 && (
                    <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-cyan-500 animate-pulse border-2 border-[#060a14]" />
                  )}
                </div>
                
                <div className="group">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/30">
                      <ClientTime value={event.created_at} fallback="Recently" />
                    </span>
                    <span className="hidden sm:inline-block h-1 w-1 rounded-full bg-white/10" />
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-white/5 bg-white/[0.03] text-[9px] font-bold text-cyan-200/60 uppercase tracking-tight">
                      {event.event_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  
                  <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:bg-white/[0.04] hover:border-white/10">
                    <div className="relative z-10">
                      <p className="text-sm font-medium leading-relaxed text-slate-300">
                        {event.summary}
                      </p>
                      {event.metadata?.initiative_name && (
                        <div className="mt-3 flex items-center gap-2 text-[10px] font-bold text-white/30">
                          <Milestone className="h-3 w-3" />
                          <span>Part of <span className="text-white/60">{event.metadata.initiative_name as string}</span></span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

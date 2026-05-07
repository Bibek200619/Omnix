"use client";

import { motion } from "framer-motion";
import { 
  Activity, 
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

const EVENT_ICONS: Record<string, React.ElementType> = {
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
        <p className="text-sm font-medium">Loading timeline...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={cn("p-12 text-center rounded-[18px] border border-dashed border-white/10 bg-white/[0.02]", className)}>
        <History className="h-8 w-8 mx-auto mb-4 text-white/20" />
        <h3 className="text-sm font-medium text-white/60 mb-1">Quiet Timeline</h3>
        <p className="text-xs text-white/30">Key milestones and decisions will appear here.</p>
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
              className="group relative overflow-hidden rounded-xl border border-white/5 bg-[rgba(6,10,20,0.6)] p-4 transition-all hover:border-white/10 hover:bg-white/[0.02]"
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-emerald-400/60">Focus Area</span>
                  </div>
                  <h4 className="text-sm font-medium text-white/90 group-hover:text-white transition-colors truncate">
                    {initiative.name}
                  </h4>
                </div>
                <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center">
                  <Compass className="h-4 w-4 text-cyan-400/80" />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(initiative.momentum_score * 10, 100)}%` }}
                    className="h-full bg-gradient-to-r from-cyan-500/80 to-emerald-500/80"
                  />
                </div>
                <span className="text-[10px] font-medium text-white/40">
                  {Math.round(initiative.momentum_score * 10)}% Activity
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Timeline Feed */}
      <div className="relative">
        <div className="absolute left-[17px] top-4 bottom-4 w-px bg-gradient-to-b from-cyan-500/40 via-white/5 to-transparent sm:left-[19px]" />
        
        <div className="space-y-8">
          {events.map((event, index) => {
            const Icon = EVENT_ICONS[event.event_type] || EVENT_ICONS.default;
            return (
              <motion.div
                key={event.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="relative pl-10 sm:pl-12"
              >
                <div className="absolute left-0 top-0 flex h-[34px] w-[34px] items-center justify-center rounded-xl border border-white/10 bg-[#060a14] sm:h-10 sm:w-10">
                  <Icon className="h-3.5 w-3.5 text-cyan-400/80 sm:h-4 sm:w-4" />
                  {index === 0 && (
                    <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-cyan-500/80 border-2 border-[#060a14] sm:h-3 sm:w-3" />
                  )}
                </div>
                
                <div className="group">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 mb-1.5">
                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] sm:tracking-[0.15em] text-white/30">
                      <ClientTime value={event.created_at} fallback="Recently" />
                    </span>
                    <span className="hidden sm:inline-block h-1 w-1 rounded-full bg-white/10" />
                    <span className="inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full border border-white/5 bg-white/[0.03] text-[8px] sm:text-[9px] font-medium text-cyan-200/50 uppercase tracking-tight">
                      {event.event_type === 'momentum_spike' ? 'High Activity' : 
                       event.event_type === 'initiative_started' ? 'Project Started' :
                       event.event_type === 'decision_made' ? 'Decision' :
                       event.event_type === 'synthesis' ? 'Summary' :
                       event.event_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  
                  <div className="relative overflow-hidden rounded-xl sm:rounded-2xl border border-white/5 bg-white/[0.02] p-3 sm:p-4 transition-all hover:bg-white/[0.04] hover:border-white/10">
                    <div className="relative z-10">
                      <p className="text-xs sm:text-sm font-medium leading-relaxed text-slate-300">
                        {event.summary}
                      </p>
                      {typeof event.metadata?.initiative_name === "string" && (
                        <div className="mt-2.5 sm:mt-3 flex items-center gap-2 text-[9px] sm:text-[10px] font-bold text-white/30">
                          <Milestone className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                          <span>Part of <span className="text-white/60">{event.metadata.initiative_name}</span></span>
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

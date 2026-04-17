import os

filepath = "frontend/components/layout/Sidebar.tsx"
with open(filepath, "r") as f:
    content = f.read()

old_str = """                      {/* Render Subspaces */}
                      {ws.subspaces && ws.subspaces.length > 0 && (
                        <div className="ml-[24px] border-l border-[var(--omnix-border-2)] pl-1">
                          {ws.subspaces.map((sub, subIndex) => (
                            <motion.button
                              key={sub.id}
                              layout
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              onClick={() => {
                                setActiveWorkspace(sub.id);
                                setOpen(false);
                              }}
                              className={cn(
                                "relative flex w-full items-center gap-2 px-[11px] py-1.5 text-left transition rounded-md my-0.5",
                                sub.id === activeWorkspaceId
                                  ? "bg-cyan-300/[0.06]"
                                  : "hover:bg-[var(--omnix-surface)]",
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 truncate text-xs text-[var(--omnix-text-2)]">
                                  <span className={cn("transition", sub.id === activeWorkspaceId ? "text-cyan-300 font-medium" : "")}>{sub.name}</span>
                                  {sub.is_global && <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] uppercase tracking-wider text-amber-300">Global</span>}
                                  {sub.workspace_type === "sub" && !sub.is_global && <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[8px] uppercase tracking-wider text-emerald-300">Team</span>}
                                </div>
                              </div>
                              {sub.id === activeWorkspaceId && (
                                <Check className="h-3 w-3 shrink-0 text-cyan-300" />
                              )}
                            </motion.button>
                          ))}
                        </div>
                      )}"""

new_str = """                      {/* Render Subspaces */}
                      {ws.subspaces && ws.subspaces.length > 0 && (
                        <div className="ml-[10px] pl-3 border-l border-[var(--omnix-border-2)]">
                          {ws.subspaces.map((sub, subIndex) => (
                            <motion.button
                              key={sub.id}
                              layout
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              onClick={() => {
                                setActiveWorkspace(sub.id);
                                setOpen(false);
                              }}
                              className={cn(
                                "relative flex w-full items-center gap-2 px-[11px] py-1.5 text-left transition rounded-md my-0.5",
                                sub.id === activeWorkspaceId
                                  ? "bg-cyan-300/[0.06]"
                                  : "hover:bg-[var(--omnix-surface)]",
                              )}
                            >
                              <div className="absolute -left-[13px] text-[var(--omnix-border-2)] text-[10px] font-mono select-none flex items-center h-full">
                                {subIndex === ws.subspaces!.length - 1 ? "└─" : "├─"}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 truncate text-xs text-[var(--omnix-text-2)]">
                                  <span className={cn("transition", sub.id === activeWorkspaceId ? "text-cyan-300 font-medium" : "")}>{sub.name}</span>
                                  {sub.is_global && <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] uppercase tracking-wider text-amber-300">Global</span>}
                                  {sub.workspace_type === "sub" && !sub.is_global && <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[8px] uppercase tracking-wider text-emerald-300">Team</span>}
                                </div>
                              </div>
                              {sub.id === activeWorkspaceId && (
                                <Check className="h-3 w-3 shrink-0 text-cyan-300" />
                              )}
                            </motion.button>
                          ))}
                        </div>
                      )}"""

content = content.replace(old_str, new_str)
with open(filepath, "w") as f:
    f.write(content)

print("Patch applied to Sidebar.tsx successfully.")

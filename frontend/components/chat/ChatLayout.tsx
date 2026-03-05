"use client";
import { ReactNode } from "react";
import { MessageSquare, Settings, Plus, LogOut, Menu } from "lucide-react";
import Link from "next/link";

export function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-[#030712] overflow-hidden">
      {/* Sidebar - Desktop */}
      <aside className="w-72 border-r border-white/5 bg-black/40 flex-col hidden md:flex shrink-0">
        <div className="p-5 border-b border-white/5">
          <Link href="/" className="text-2xl font-bold text-white flex items-center gap-2 tracking-tight">
            Omnix<span className="text-purple-500">.</span>
          </Link>
        </div>
        
        <div className="p-4">
          <button 
            onClick={() => console.log("[Sidebar] New Conversation clicked")}
            className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors border border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-gray-200"
          >
            <Plus className="w-5 h-5" /> New Conversation
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1 custom-scrollbar">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">Recent</div>
          {[1, 2, 3].map((i) => (
            <button 
              key={i} 
              onClick={() => console.log(`[Sidebar] Selected Conversation ${i}`)}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 text-left text-sm text-gray-300 transition-colors truncate"
            >
              <MessageSquare className="w-4 h-4 shrink-0 text-gray-400" />
              <span className="truncate">Data analysis discussion {i}</span>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-white/5 space-y-1">
          <button 
            onClick={() => console.log("[Sidebar] Settings clicked")}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/5 text-sm text-gray-300 transition-colors font-medium"
          >
            <Settings className="w-4 h-4" /> Settings
          </button>
          <Link href="/auth/login" className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-500/10 hover:text-red-400 text-sm text-gray-300 transition-colors font-medium">
            <LogOut className="w-4 h-4" /> Log out
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full h-full max-w-full">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-white/5 bg-black/40 backdrop-blur-md z-10">
          <Link href="/" className="text-xl font-bold text-white tracking-tight">
            Omnix<span className="text-purple-500">.</span>
          </Link>
          <button className="p-2 text-gray-400 hover:text-white">
            <Menu className="w-6 h-6" />
          </button>
        </header>

        {children}
      </main>
    </div>
  );
}

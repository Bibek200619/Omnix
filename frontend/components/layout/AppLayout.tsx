"use client";
import { ReactNode, useState } from "react";
import { MessageSquare, Settings, History, Plus, LogOut, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";

export function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { name: "Chat", href: "/chat", icon: MessageSquare },
    { name: "History", href: "/history", icon: History },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

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
          <Link 
            href="/chat"
            className="w-full flex items-center gap-2 bg-white/5 hover:bg-white/10 transition-colors border border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-gray-200"
          >
            <Plus className="w-5 h-5" /> New Conversation
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">Menu</div>
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link 
                key={item.href}
                href={item.href}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-sm font-medium relative group ${
                  isActive ? "text-white" : "text-gray-400 hover:text-gray-200 hover:bg-white/5"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="desktop-active-nav-indicator"
                    className="absolute inset-0 bg-white/10 rounded-xl"
                    initial={false}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
                <item.icon className="w-5 h-5 shrink-0 relative z-10" />
                <span className="relative z-10">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5 space-y-1">
          <Link href="/auth/login" className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-500/10 hover:text-red-400 text-sm text-gray-400 transition-colors font-medium">
            <LogOut className="w-5 h-5" /> Log out
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative w-full h-full max-w-full overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 border-b border-white/5 bg-black/40 backdrop-blur-md z-20">
          <Link href="/" className="text-xl font-bold text-white tracking-tight">
            Omnix<span className="text-purple-500">.</span>
          </Link>
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 text-gray-400 hover:text-white transition-colors"
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </header>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute inset-0 top-[73px] bg-black/95 backdrop-blur-xl z-20 md:hidden flex flex-col"
            >
              <div className="p-4 space-y-2">
                <Link 
                  href="/chat"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full flex items-center gap-2 bg-white/10 hover:bg-white/20 transition-colors border border-white/10 rounded-xl px-4 py-3 text-sm font-medium text-white mb-6"
                >
                  <Plus className="w-5 h-5" /> New Conversation
                </Link>

                {navItems.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <Link 
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl transition-all text-base font-medium ${
                        isActive ? "bg-white/10 text-white" : "text-gray-400 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      <item.icon className="w-6 h-6 shrink-0" />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}

                <div className="mt-8 pt-4 border-t border-white/10">
                  <Link 
                    href="/auth/login" 
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full flex items-center gap-3 px-4 py-4 rounded-xl hover:bg-red-500/10 hover:text-red-400 text-base text-gray-400 transition-colors font-medium"
                  >
                    <LogOut className="w-6 h-6" /> Log out
                  </Link>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </main>
    </div>
  );
}

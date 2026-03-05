"use client";
import { AppLayout } from "@/components/layout/AppLayout";
import { PageTransition } from "@/components/layout/PageTransition";
import { MessageSquare, MoreHorizontal, Calendar, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";

const MOCK_HISTORY = [
  { id: 1, title: "Data Analysis Request", date: "Today", messages: 12 },
  { id: 2, title: "React Performance Tuning", date: "Yesterday", messages: 8 },
  { id: 3, title: "Next.js App Router discussion", date: "Oct 24", messages: 24 },
  { id: 4, title: "Marketing copy ideas", date: "Oct 20", messages: 6 },
  { id: 5, title: "System Architecture Planning", date: "Oct 15", messages: 42 },
];

export default function HistoryPage() {
  const router = useRouter();

  return (
    <AppLayout>
      <PageTransition>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Chat History</h1>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input 
                  type="text" 
                  placeholder="Search conversations..." 
                  className="w-full md:w-64 bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                />
              </div>
            </div>

            {MOCK_HISTORY.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-gray-500" />
                </div>
                <h3 className="text-lg font-medium text-white mb-1">No chats yet</h3>
                <p className="text-gray-400 text-sm">Start a new conversation to see your history here.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {MOCK_HISTORY.map((chat, idx) => (
                  <motion.button
                    key={chat.id}
                    onClick={() => router.push(`/chat?id=${chat.id}`)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    whileTap={{ scale: 0.98 }}
                    className="group w-full flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/10 transition-all text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center shrink-0 group-hover:bg-purple-500/20 transition-colors">
                        <MessageSquare className="w-5 h-5 text-purple-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-medium text-gray-200 group-hover:text-white transition-colors">{chat.title}</h3>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {chat.date}</span>
                          <span>•</span>
                          <span>{chat.messages} messages</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 hidden md:block">
                      <MoreHorizontal className="w-5 h-5" />
                    </div>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}

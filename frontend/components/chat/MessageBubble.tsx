import { cn } from "@/lib/utils";
import { User, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

interface MessageBubbleProps {
  role: "user" | "ai";
  content: string;
}

export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("flex gap-4 w-full max-w-4xl mx-auto py-6", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-lg",
        isUser ? "bg-gradient-to-br from-purple-500 to-purple-700" : "bg-gradient-to-br from-blue-500 to-blue-700"
      )}>
        {isUser ? <User className="w-5 h-5 text-white" /> : <Sparkles className="w-4 h-4 text-white" />}
      </div>
      
      <div className={cn(
        "flex flex-col max-w-[85%] md:max-w-[75%]",
        isUser ? "items-end" : "items-start"
      )}>
        <div className="text-xs text-gray-500 mb-1.5 font-medium px-1 uppercase tracking-wider">
          {isUser ? "You" : "Omnix"}
        </div>
        <div className={cn(
          "px-5 py-3.5 rounded-2xl text-[15px] leading-relaxed shadow-sm",
          isUser 
            ? "bg-purple-600/20 border border-purple-500/20 rounded-tr-sm text-gray-100" 
            : "bg-white/5 border border-white/10 rounded-tl-sm text-gray-200"
        )}>
          {content}
        </div>
      </div>
    </motion.div>
  );
}

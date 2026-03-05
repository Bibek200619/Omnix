"use client";
import { useState } from "react";
import { Send, Paperclip, StopCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || disabled) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="p-4 md:p-6 bg-[#030712]/80 border-t border-white/5 backdrop-blur-xl relative z-20 sticky bottom-0">
      <div className="max-w-4xl mx-auto relative">
        <form onSubmit={handleSubmit} className="relative flex items-end shadow-2xl rounded-2xl group bg-gray-900 border border-white/10 transition-colors focus-within:border-white/20 focus-within:bg-gray-800">
          <button 
            type="button"
            className="p-4 text-gray-400 hover:text-white transition-colors rounded-xl hover:bg-white/10 z-10 mb-0.5"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Ask Omnix anything..."
            className="w-full bg-transparent border-none px-2 py-4 max-h-[200px] text-white placeholder-gray-500 focus:outline-none focus:ring-0 resize-none custom-scrollbar"
            rows={1}
            style={{ minHeight: '56px' }}
          />
          
          <div className="p-2 mb-1">
            <AnimatePresence mode="wait">
              {disabled ? (
                <motion.button 
                  key="stop"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  type="button"
                  className="p-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors"
                >
                  <StopCircle className="w-5 h-5 fill-current" />
                </motion.button>
              ) : (
                <motion.button 
                  key="send"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2.5 bg-white text-black rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  <Send className="w-5 h-5" />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </form>
        <div className="text-center mt-3 text-xs text-gray-500">
          Omnix can make mistakes. Consider verifying important information.
        </div>
      </div>
    </div>
  );
}

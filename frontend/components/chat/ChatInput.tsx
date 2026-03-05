"use client";
import { useState } from "react";
import { Send, Paperclip } from "lucide-react";

export function ChatInput({ onSend }: { onSend: (message: string) => void }) {
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  return (
    <div className="p-4 md:p-6 bg-transparent border-t border-white/5 backdrop-blur-xl relative z-20">
      <div className="max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="relative flex items-center shadow-2xl rounded-2xl group">
          <button 
            type="button"
            className="absolute left-3 p-2.5 text-gray-400 hover:text-white transition-colors rounded-xl hover:bg-white/10 z-10"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Omnix anything..."
            className="w-full bg-gray-900 border border-white/10 rounded-2xl pl-14 pr-16 py-4 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500 transition-all focus:bg-gray-800"
          />
          
          <button 
            type="submit"
            disabled={!input.trim()}
            className="absolute right-2 p-2.5 bg-white text-black rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed z-10"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
        <div className="text-center mt-3 text-xs text-gray-500">
          Omnix can make mistakes. Consider verifying important information.
        </div>
      </div>
    </div>
  );
}

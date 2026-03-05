"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ChatInputProps = {
  onSend: (message: string) => void;
  loading: boolean;
};

export function ChatInput({ onSend, loading }: ChatInputProps) {
  const [value, setValue] = useState("");

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-2">
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask Omnix about your knowledge base..."
          className="max-h-36 min-h-11 flex-1 resize-none rounded-lg border border-transparent bg-transparent px-3 py-3 text-sm leading-5 text-white outline-none placeholder:text-slate-500 focus:border-white/10 focus:bg-white/[0.04]"
        />
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          title="Send message"
          isLoading={loading}
          disabled={!value.trim()}
          onClick={submit}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ChatInputProps = {
  onSend: (message: string) => void;
  loading: boolean;
};

export function ChatInput({ onSend, loading }: ChatInputProps) {
  const [value, setValue] = React.useState("");

  const submit = () => {
    const trimmed = value.trim();

    if (!trimmed || loading) {
      return;
    }

    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-white/10 bg-[#0d0d0b]/92 px-3 py-3 backdrop-blur-xl sm:px-6">
      <form
        className="mx-auto flex max-w-4xl items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">
          Message
        </label>
        <textarea
          id="chat-message"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Ask Omnix about your documents..."
          className="max-h-36 min-h-12 flex-1 resize-none rounded-md border border-white/10 bg-white/[0.06] px-4 py-3 text-sm leading-6 text-stone-50 outline-none transition placeholder:text-stone-500 focus:border-teal-200/65 focus:bg-white/[0.09] focus:ring-4 focus:ring-teal-200/10"
        />
        <Button type="submit" size="icon" disabled={!value.trim() || loading} aria-label="Send message">
          <SendHorizonal className="h-5 w-5" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}

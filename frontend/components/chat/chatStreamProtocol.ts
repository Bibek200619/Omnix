import type { Message } from "@/components/chat/types";

export type StreamEvent = {
  type: "init" | "status" | "sources" | "token" | "error" | "done";
  conversation_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
  sources?: Message["sources"];
  status?: string;
  text?: string;
  detail?: string;
};

export async function readChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  abortController: AbortController,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let streamTimeout: number | undefined;

  const processEvent = (block: string) => {
    for (const line of block.split(/\r?\n/).filter(Boolean)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.replace(/^data:\s?/, "");
      try {
        onEvent(JSON.parse(payload) as StreamEvent);
      } catch (error) {
        console.error("Failed to parse stream payload", payload, error);
      }
    }
  };

  const resetStreamTimeout = () => {
    if (streamTimeout) window.clearTimeout(streamTimeout);
    streamTimeout = window.setTimeout(() => {
      console.warn("[chat] stream timeout reached, aborting");
      abortController.abort(new Error("Stream timed out after 45 seconds of inactivity."));
    }, 45000);
  };

  try {
    resetStreamTimeout();
    while (true) {
      const { done, value } = await reader.read();
      resetStreamTimeout();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\n\n/);
      buffer = parts.pop() || "";
      for (const part of parts) processEvent(part);
    }
    if (buffer.trim()) processEvent(buffer);
  } finally {
    if (streamTimeout) window.clearTimeout(streamTimeout);
  }
}

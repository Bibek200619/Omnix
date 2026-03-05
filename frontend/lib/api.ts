const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export type ChatResponse = {
  response: string;
  conversation_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
};

function getErrorMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null || !("detail" in data)) {
    return null;
  }

  const detail = data.detail;

  return typeof detail === "string" ? detail : null;
}

export async function sendMessage(message: string): Promise<ChatResponse> {
  const response = await fetch(`${API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ message })
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getErrorMessage(data) ?? `Chat request failed with status ${response.status}`);
  }

  return data as ChatResponse;
}

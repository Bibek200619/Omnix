import { supabase } from "@/lib/supabase";
import type {
  WorkspaceMentionInboxItem,
  WorkspaceMentionMarkAllReadResponse,
  WorkspaceMentionMarkReadResponse,
  WorkspaceMentionUnreadCount,
  WorkspaceSearchResponse,
} from "@/lib/workspace-types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "OMNIX_API_PROXY_TARGET_REDACTED";

export type ApiStatus = "idle" | "loading" | "success" | "error";

let _activeWorkspaceId: string | null = null;

export function setApiWorkspaceId(id: string | null): void {
  _activeWorkspaceId = id;
}

type ApiErrorPayload = {
  endpoint: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  responsePayload?: unknown;
  rawMessage?: string;
};

export class ApiError extends Error {
  endpoint: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  responsePayload?: unknown;
  rawMessage?: string;

  constructor(message: string, payload: ApiErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.endpoint = payload.endpoint;
    this.url = payload.url;
    this.method = payload.method;
    this.status = payload.status;
    this.statusText = payload.statusText;
    this.responsePayload = payload.responsePayload;
    this.rawMessage = payload.rawMessage;
  }
}

function extractErrorMessage(errorData: { detail?: string | { msg?: string }[]; message?: string }) {
  if (typeof errorData.detail === "string") {
    return errorData.detail;
  }
  if (Array.isArray(errorData.detail)) {
    const firstError = errorData.detail[0];
    return firstError?.msg ? String(firstError.msg) : JSON.stringify(errorData.detail);
  }
  if (errorData.message) {
    return errorData.message;
  }
  return null;
}

function logApiError(error: ApiError) {
  console.error("[api] request failed", {
    error,
    endpoint: error.endpoint,
    method: error.method,
    status: error.status,
    responsePayload: error.responsePayload,
    rawMessage: error.rawMessage,
  });
}

class ApiClient {
  private inFlightGets = new Map<string, Promise<unknown>>();

  private applyWorkspaceHeader(headers: Headers) {
    if (_activeWorkspaceId) {
      headers.set("X-Omnix-Workspace", _activeWorkspaceId);
    }
  }

  private async getAuthToken(): Promise<string | null> {
    if (!supabase) {
      return null;
    }

    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error("Unable to read Supabase session", error);
      return null;
    }

    return session?.access_token ?? null;
  }

  async request(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = await this.getAuthToken();
    const headers = new Headers(options.headers);
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;

    if (!headers.has("Content-Type") && !isFormData) {
      headers.set("Content-Type", "application/json");
    }

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    this.applyWorkspaceHeader(headers);

    let response: Response;

    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (exc) {
      const error = new ApiError("Omnix API is unreachable.", {
        endpoint,
        url,
        method: options.method ?? "GET",
        rawMessage: exc instanceof Error ? exc.message : String(exc),
      });
      logApiError(error);
      throw error;
    }

    if (response.status === 401) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };
      await supabase?.auth.signOut();
      const error = new ApiError("Authentication is required.", {
        endpoint,
        url,
        method: options.method ?? "GET",
        status: response.status,
        statusText: response.statusText,
        responsePayload: errorData,
        rawMessage: extractErrorMessage(errorData) ?? "Unauthorized",
      });
      logApiError(error);
      throw error;
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };

      const error = new ApiError("Omnix API request failed.", {
        endpoint,
        url,
        method: options.method ?? "GET",
        status: response.status,
        statusText: response.statusText,
        responsePayload: errorData,
        rawMessage: extractErrorMessage(errorData) ?? `HTTP ${response.status}`,
      });
      logApiError(error);
      throw error;
    }

    return response;
  }

  /**
   * Open a streaming POST request and return the raw Response so caller can
   * iterate over response.body as a stream. Does not attempt to parse JSON.
   */
  async stream(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = await this.getAuthToken();
    const headers = new Headers(options.headers);
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

    if (!headers.has("Content-Type") && !isFormData) {
      headers.set("Content-Type", "application/json");
    }

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    this.applyWorkspaceHeader(headers);

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers,
      });
    } catch (exc) {
      const error = new ApiError("Omnix API is unreachable.", {
        endpoint,
        url,
        method: options.method ?? "POST",
        rawMessage: exc instanceof Error ? exc.message : String(exc),
      });
      logApiError(error);
      throw error;
    }

    if (response.status === 401) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };
      await supabase?.auth.signOut();
      const error = new ApiError("Authentication is required.", {
        endpoint,
        url,
        method: options.method ?? "POST",
        status: response.status,
        statusText: response.statusText,
        responsePayload: errorData,
        rawMessage: extractErrorMessage(errorData) ?? "Unauthorized",
      });
      logApiError(error);
      throw error;
    }

    if (!response.ok && response.status !== 200) {
      // For streaming endpoints some servers may return 200 with streaming body.
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };

      const error = new ApiError("Omnix API request failed.", {
        endpoint,
        url,
        method: options.method ?? "POST",
        status: response.status,
        statusText: response.statusText,
        responsePayload: errorData,
        rawMessage: extractErrorMessage(errorData) ?? `HTTP ${response.status}`,
      });
      logApiError(error);
      throw error;
    }

    return response;
  }

  async post<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(data || {}),
    });
    return response.json() as Promise<T>;
  }

  async patch<T>(endpoint: string, data?: unknown): Promise<T> {
    const response = await this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(data || {}),
    });
    return response.json() as Promise<T>;
  }

  async get<T>(endpoint: string): Promise<T> {
    const key = `${_activeWorkspaceId ?? "none"}::${endpoint}`;
    const inFlight = this.inFlightGets.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }

    const request = this.request(endpoint, {
      method: "GET",
    })
      .then((response) => response.json() as Promise<T>)
      .finally(() => {
        this.inFlightGets.delete(key);
      });

    this.inFlightGets.set(key, request);
    return request;
  }

  async searchWorkspace(workspaceId: string, query: string): Promise<WorkspaceSearchResponse> {
    return this.get<WorkspaceSearchResponse>(
      `/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}`,
    );
  }

  async listWorkspaceMentions(workspaceId: string): Promise<WorkspaceMentionInboxItem[]> {
    return this.get<WorkspaceMentionInboxItem[]>(`/workspaces/${workspaceId}/mentions`);
  }

  async getWorkspaceMentionsUnreadCount(workspaceId: string): Promise<WorkspaceMentionUnreadCount> {
    return this.get<WorkspaceMentionUnreadCount>(`/workspaces/${workspaceId}/mentions/unread-count`);
  }

  async markWorkspaceMentionRead(workspaceId: string, mentionId: string): Promise<WorkspaceMentionMarkReadResponse> {
    return this.patch<WorkspaceMentionMarkReadResponse>(`/workspaces/${workspaceId}/mentions/${mentionId}/read`);
  }

  async markAllWorkspaceMentionsRead(workspaceId: string): Promise<WorkspaceMentionMarkAllReadResponse> {
    return this.patch<WorkspaceMentionMarkAllReadResponse>(`/workspaces/${workspaceId}/mentions/read-all`);
  }

  async delete<T = void>(endpoint: string): Promise<T> {
    const response = await this.request(endpoint, {
      method: "DELETE",
    });
    if (response.status === 204) {
      return undefined as unknown as T;
    }
    return response.json() as Promise<T>;
  }
}

export const apiClient = new ApiClient();

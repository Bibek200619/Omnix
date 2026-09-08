import { supabase } from "@/lib/supabase";
import type {
  WorkspaceMentionInboxItem,
  WorkspaceMentionMarkAllReadResponse,
  WorkspaceMentionMarkReadResponse,
  WorkspaceMentionUnreadCount,
  WorkspaceSearchResponse,
} from "@/lib/workspace-types";

const DEFAULT_API_BASE_URL = "/api";

function normalizeApiBaseUrl(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }
  return trimmed.replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
}

function normalizeEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export const API_BASE_URL = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export function apiUrl(endpoint: string) {
  return `${API_BASE_URL}${normalizeEndpoint(endpoint)}`;
}

export type ApiStatus = "idle" | "loading" | "success" | "error";

type ApiGetOptions = {
  dedupe?: boolean;
  signal?: AbortSignal;
};

let _activeWorkspaceId: string | null = null;
const apiWorkspaceChangeListeners = new Set<() => void>();

function normalizeWorkspaceId(id: string | null): string | null {
  const normalized = id?.trim();
  return normalized || null;
}

function notifyApiWorkspaceChanged() {
  for (const listener of apiWorkspaceChangeListeners) {
    listener();
  }
}

export function setApiWorkspaceId(id: string | null): void {
  const normalizedId = normalizeWorkspaceId(id);
  if (_activeWorkspaceId === normalizedId) {
    return;
  }
  _activeWorkspaceId = normalizedId;
  notifyApiWorkspaceChanged();
}

export function getApiWorkspaceId(): string | null {
  return _activeWorkspaceId;
}

function subscribeApiWorkspaceChange(listener: () => void): () => void {
  apiWorkspaceChangeListeners.add(listener);
  return () => {
    apiWorkspaceChangeListeners.delete(listener);
  };
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

type ApiErrorData = {
  detail?: string | { msg?: string }[];
  message?: string;
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

  toJSON(options: { includeSensitive?: boolean } = {}) {
    const includeSensitive = options.includeSensitive ?? process.env.NODE_ENV !== "production";
    return {
      name: this.name,
      message: this.message,
      endpoint: this.endpoint,
      url: this.url,
      method: this.method,
      status: this.status,
      statusText: this.statusText,
      rawMessage: includeSensitive ? this.rawMessage : undefined,
      responsePayload: includeSensitive ? this.responsePayload : undefined,
      sensitiveFieldsRedacted: includeSensitive ? undefined : Boolean(this.rawMessage || this.responsePayload),
    };
  }
}

function extractErrorMessage(errorData: ApiErrorData) {
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

async function readErrorPayload(response: Response): Promise<ApiErrorData> {
  return (await response.json().catch(() => ({}))) as ApiErrorData;
}

function logApiError(error: ApiError) {
  if (process.env.NODE_ENV === "production") {
    // Production: only log safe, non-sensitive fields
    console.error("[api] request failed", {
      method: error.method,
      url: error.url,
      status: error.status,
      message: error.message,
    });
  } else {
    // Development: log truncated summary (strip potential tokens/PII)
    const summary = error.toJSON({ includeSensitive: true });
    if (typeof summary.responsePayload === "string" && summary.responsePayload.length > 200) {
      summary.responsePayload = summary.responsePayload.slice(0, 200) + "…[truncated]";
    } else if (summary.responsePayload && typeof summary.responsePayload === "object") {
      const serialized = JSON.stringify(summary.responsePayload);
      if (serialized.length > 200) {
        summary.responsePayload = serialized.slice(0, 200) + "…[truncated]";
      }
    }
    console.error("[api] request failed", summary);
  }
}

class ApiClient {
  private inFlightGets = new Map<string, Promise<unknown>>();

  constructor() {
    subscribeApiWorkspaceChange(() => {
      this.inFlightGets.clear();
    });
  }

  private applyWorkspaceHeader(
    headers: Headers,
    requestWorkspaceId: string | null,
  ) {
    if (requestWorkspaceId) {
      headers.set("X-Omnix-Workspace", requestWorkspaceId);
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

  private async refreshAuthToken(): Promise<string | null> {
    if (!supabase) {
      return null;
    }

    const {
      data: { session: currentSession },
      error: currentSessionError,
    } = await supabase.auth.getSession();

    if (currentSessionError || !currentSession?.refresh_token) {
      if (currentSessionError && process.env.NODE_ENV !== "production") {
        console.warn("Unable to inspect Supabase session for API recovery", currentSessionError);
      }
      return null;
    }

    const {
      data: { session: refreshedSession },
      error,
    } = await supabase.auth.refreshSession();

    if (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Unable to refresh Supabase session for API retry", error);
      }
      return null;
    }

    return refreshedSession?.access_token ?? null;
  }

  private buildHeaders(
    options: RequestInit,
    token: string | null,
    requestWorkspaceId: string | null,
  ): Headers {
    const headers = new Headers(options.headers);
    const isFormData =
      typeof FormData !== "undefined" && options.body instanceof FormData;

    if (!headers.has("Content-Type") && !isFormData) {
      headers.set("Content-Type", "application/json");
    }

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    this.applyWorkspaceHeader(headers, requestWorkspaceId);

    return headers;
  }

  private async fetchOnce(
    normalizedEndpoint: string,
    url: string,
    options: RequestInit,
    token: string | null,
    fallbackMethod: string,
    requestWorkspaceId: string | null,
  ): Promise<Response> {
    const headers = this.buildHeaders(options, token, requestWorkspaceId);

    try {
      return await fetch(url, {
        ...options,
        headers,
      });
    } catch (exc) {
      if (options.signal?.aborted || (exc instanceof Error && exc.name === "AbortError")) {
        throw exc;
      }
      const error = new ApiError("Omnix API is unreachable.", {
        endpoint: normalizedEndpoint,
        url,
        method: options.method ?? fallbackMethod,
        rawMessage: exc instanceof Error ? exc.message : String(exc),
      });
      logApiError(error);
      throw error;
    }
  }

  private buildAuthenticationError(
    normalizedEndpoint: string,
    url: string,
    options: RequestInit,
    response: Response,
    errorData: ApiErrorData,
    fallbackMethod: string,
  ) {
    return new ApiError("Your session needs attention. Please refresh or sign in again.", {
      endpoint: normalizedEndpoint,
      url,
      method: options.method ?? fallbackMethod,
      status: response.status,
      statusText: response.statusText,
      responsePayload: errorData,
      rawMessage: extractErrorMessage(errorData) ?? "Unauthorized",
    });
  }

  private async fetchWithAuthRecovery(
    normalizedEndpoint: string,
    url: string,
    options: RequestInit,
    fallbackMethod: string,
    requestWorkspaceId: string | null,
  ): Promise<Response> {
    const token = await this.getAuthToken();
    const response = await this.fetchOnce(
      normalizedEndpoint,
      url,
      options,
      token,
      fallbackMethod,
      requestWorkspaceId,
    );

    if (response.status !== 401) {
      return response;
    }

    const firstErrorData = await readErrorPayload(response.clone());
    const refreshedToken = await this.refreshAuthToken();

    if (refreshedToken) {
      const retryResponse = await this.fetchOnce(
        normalizedEndpoint,
        url,
        options,
        refreshedToken,
        fallbackMethod,
        requestWorkspaceId,
      );
      if (retryResponse.status !== 401) {
        return retryResponse;
      }
      const retryErrorData = await readErrorPayload(retryResponse.clone());
      const retryError = this.buildAuthenticationError(
        normalizedEndpoint,
        url,
        options,
        retryResponse,
        retryErrorData,
        fallbackMethod,
      );
      logApiError(retryError);
      throw retryError;
    }

    const error = this.buildAuthenticationError(
      normalizedEndpoint,
      url,
      options,
      response,
      firstErrorData,
      fallbackMethod,
    );
    logApiError(error);
    throw error;
  }

  private async requestForWorkspace(
    endpoint: string,
    options: RequestInit,
    requestWorkspaceId: string | null,
  ): Promise<Response> {
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = apiUrl(normalizedEndpoint);
    const response = await this.fetchWithAuthRecovery(
      normalizedEndpoint,
      url,
      options,
      "GET",
      requestWorkspaceId,
    );

    if (!response.ok) {
      const errorData = await readErrorPayload(response);

      const error = new ApiError("Omnix API request failed.", {
        endpoint: normalizedEndpoint,
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

  async request(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    return this.requestForWorkspace(
      endpoint,
      options,
      _activeWorkspaceId,
    );
  }

  /**
   * Open a streaming POST request and return the raw Response so caller can
   * iterate over response.body as a stream. Does not attempt to parse JSON.
   */
  async stream(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const requestWorkspaceId = _activeWorkspaceId;
    const normalizedEndpoint = normalizeEndpoint(endpoint);
    const url = apiUrl(normalizedEndpoint);
    const response = await this.fetchWithAuthRecovery(
      normalizedEndpoint,
      url,
      options,
      "POST",
      requestWorkspaceId,
    );

    if (!response.ok && response.status !== 200) {
      // For streaming endpoints some servers may return 200 with streaming body.
      const errorData = await readErrorPayload(response);

      const error = new ApiError("Omnix API request failed.", {
        endpoint: normalizedEndpoint,
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

  async get<T>(endpoint: string, options: ApiGetOptions = {}): Promise<T> {
    const requestWorkspaceId = _activeWorkspaceId;
    const execute = () =>
      this.requestForWorkspace(
        endpoint,
        {
          method: "GET",
          signal: options.signal,
        },
        requestWorkspaceId,
      ).then((response) => response.json() as Promise<T>);

    if (options.dedupe === false || options.signal) {
      return execute();
    }

    const key = `${requestWorkspaceId ?? "none"}::${endpoint}`;
    const inFlight = this.inFlightGets.get(key);
    if (inFlight) {
      return inFlight as Promise<T>;
    }

    const request = execute().finally(() => {
      if (this.inFlightGets.get(key) === request) {
        this.inFlightGets.delete(key);
      }
    });

    this.inFlightGets.set(key, request);
    return request;
  }

  async searchWorkspace(
    workspaceId: string,
    query: string,
    options: { signal?: AbortSignal; limit?: number; cursor?: number } = {},
  ): Promise<WorkspaceSearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (options.limit) {
      params.set("limit", String(options.limit));
    }
    if (options.cursor) {
      params.set("cursor", String(options.cursor));
    }

    const endpoint = `/workspaces/${workspaceId}/search?${params.toString()}`;
    const response = await this.request(endpoint, {
      method: "GET",
      signal: options.signal,
    });
    return response.json() as Promise<WorkspaceSearchResponse>;
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

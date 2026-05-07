import { supabase } from "@/lib/supabase";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://18.204.231.209";

export type ApiStatus = "idle" | "loading" | "success" | "error";

class ApiClient {
  private inFlightGets = new Map<string, Promise<unknown>>();

  private getActiveWorkspaceId() {
    try {
      if (typeof window !== "undefined") {
        return window.localStorage.getItem("omnix.activeWorkspaceId");
      }
    } catch {
      // Ignore localStorage failures
    }

    return null;
  }

  private applyWorkspaceHeader(headers: Headers) {
    const activeWorkspace = this.getActiveWorkspaceId();
    if (activeWorkspace) {
      headers.set("X-Omnix-Workspace", activeWorkspace);
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
    } catch {
      throw new Error(
        `Unable to reach the Omnix API at ${API_BASE_URL}. Start the FastAPI service or check NEXT_PUBLIC_API_BASE_URL.`,
      );
    }

    if (response.status === 401) {
      await supabase?.auth.signOut();

      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };

      let errorMessage = "An error occurred";
      if (typeof errorData.detail === "string") {
        errorMessage = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        // FastAPI validation errors often look like [{ "msg": "...", ... }]
        const firstError = errorData.detail[0];
        errorMessage = firstError?.msg
          ? String(firstError.msg)
          : JSON.stringify(errorData.detail);
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else {
        errorMessage = `HTTP ${response.status}`;
      }

      throw new Error(errorMessage);
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
    } catch {
      throw new Error(`Unable to reach the Omnix API at ${API_BASE_URL}. Start the FastAPI service or check NEXT_PUBLIC_API_BASE_URL.`);
    }

    if (response.status === 401) {
      await supabase?.auth.signOut();
      throw new Error("Unauthorized");
    }

    if (!response.ok && response.status !== 200) {
      // For streaming endpoints some servers may return 200 with streaming body.
      const errorData = (await response.json().catch(() => ({}))) as {
        detail?: string | { msg?: string }[];
        message?: string;
      };

      let errorMessage = "An error occurred";
      if (typeof errorData.detail === "string") {
        errorMessage = errorData.detail;
      } else if (Array.isArray(errorData.detail)) {
        const firstError = errorData.detail[0];
        errorMessage = firstError?.msg
          ? String(firstError.msg)
          : JSON.stringify(errorData.detail);
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else {
        errorMessage = `HTTP ${response.status}`;
      }

      throw new Error(errorMessage);
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
    const key = `${this.getActiveWorkspaceId() ?? "none"}::${endpoint}`;
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

  async delete(endpoint: string): Promise<void> {
    await this.request(endpoint, {
      method: "DELETE",
    });
  }
}

export const apiClient = new ApiClient();

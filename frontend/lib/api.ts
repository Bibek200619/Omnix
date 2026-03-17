import { supabase } from "@/lib/supabase";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://52.90.155.44";

console.log(
  "ENV =",
  process.env.NEXT_PUBLIC_API_BASE_URL
);

export type ApiStatus = "idle" | "loading" | "success" | "error";

class ApiClient {
  private applyWorkspaceHeader(headers: Headers) {
    try {
      if (typeof window !== "undefined") {
        const activeWorkspace = window.localStorage.getItem("omnix.activeWorkspaceId");
        if (activeWorkspace) headers.set("X-Omnix-Workspace", activeWorkspace);
      }
    } catch {
      // Ignore localStorage failures
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

      if (typeof window !== "undefined") {
        window.location.assign("/login");
      }

      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
      };
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
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
      if (typeof window !== "undefined") window.location.assign("/login");
      throw new Error("Unauthorized");
    }

    if (!response.ok && response.status !== 200) {
      // For streaming endpoints some servers may return 200 with streaming body.
      const error = (await response.json().catch(() => ({}))) as { detail?: string; message?: string };
      throw new Error(error.detail || error.message || `HTTP ${response.status}`);
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
    const response = await this.request(endpoint, {
      method: "GET",
    });
    return response.json() as Promise<T>;
  }

  async delete(endpoint: string): Promise<void> {
    await this.request(endpoint, {
      method: "DELETE",
    });
  }
}

export const apiClient = new ApiClient();

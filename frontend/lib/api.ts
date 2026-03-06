import { supabase } from "@/lib/supabase";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type ApiStatus = "idle" | "loading" | "success" | "error";

class ApiClient {
  private async getAuthToken(): Promise<string | null> {
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

  async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
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

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      await supabase.auth.signOut();

      if (typeof window !== "undefined") {
        window.location.assign("/login");
      }

      throw new Error("Unauthorized");
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(error.detail || `HTTP ${response.status}`);
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

  async get<T>(endpoint: string): Promise<T> {
    const response = await this.request(endpoint, {
      method: "GET",
    });
    return response.json() as Promise<T>;
  }
}

export const apiClient = new ApiClient();

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type ApiStatus = "idle" | "loading" | "success" | "error";

class ApiClient {
  private getAuthToken(): string | null {
    if (typeof window !== "undefined") {
      try {
        const supabaseAuth = localStorage.getItem("sb-qsaaipuaxcreiljnwcgs-auth-token");
        if (supabaseAuth) {
          const parsed = JSON.parse(supabaseAuth) as { access_token?: string };
          return parsed?.access_token ?? null;
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  async request(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${API_BASE_URL}${endpoint}`;
    const token = this.getAuthToken();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options.headers && typeof options.headers === "object" && !Array.isArray(options.headers)) {
      Object.assign(headers, options.headers);
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      // Unauthorized - redirect to login
      if (typeof window !== "undefined") {
        localStorage.removeItem("sb-qsaaipuaxcreiljnwcgs-auth-token");
        window.location.href = "/login";
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

import { readFileSync } from "node:fs";

const SUPABASE_STORAGE_KEY = "omnix.supabase.auth";

type LiveEnvironment = {
  baseURL: string;
  storageState: string;
};

type LiveProcessEnvironment = {
  [name: string]: string | undefined;
  OMNIX_E2E_BASE_URL?: string;
  OMNIX_E2E_STORAGE_STATE?: string;
};

type StorageOrigin = {
  origin?: unknown;
  localStorage?: Array<{ name?: unknown }>;
};

type StorageState = {
  origins?: StorageOrigin[];
};

type StorageStateReader = (path: string) => string;

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} is required for live browser integration tests.`);
  }
  return normalized;
}

function normalizedBaseURL(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OMNIX_E2E_BASE_URL must be a valid absolute URL.");
  }

  const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("OMNIX_E2E_BASE_URL must use HTTPS unless it targets a loopback host.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.search = "";
  url.hash = "";
  return url;
}

function parseStorageState(serialized: string): StorageState {
  try {
    return JSON.parse(serialized) as StorageState;
  } catch {
    throw new Error("OMNIX_E2E_STORAGE_STATE must point to valid Playwright storage-state JSON.");
  }
}

export function resolveLiveEnvironment(
  env: LiveProcessEnvironment = process.env,
  readStorageState: StorageStateReader = (path) => readFileSync(path, "utf8"),
): LiveEnvironment {
  const baseURL = normalizedBaseURL(required(env.OMNIX_E2E_BASE_URL, "OMNIX_E2E_BASE_URL"));
  const storageState = required(env.OMNIX_E2E_STORAGE_STATE, "OMNIX_E2E_STORAGE_STATE");

  let parsedState: StorageState;
  try {
    parsedState = parseStorageState(readStorageState(storageState));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("OMNIX_E2E_STORAGE_STATE")) {
      throw error;
    }
    throw new Error("OMNIX_E2E_STORAGE_STATE could not be read.");
  }

  const matchingOrigin = parsedState.origins?.find((candidate) => {
    if (typeof candidate.origin !== "string") return false;
    try {
      return new URL(candidate.origin).origin === baseURL.origin;
    } catch {
      return false;
    }
  });
  const hasSupabaseSession = matchingOrigin?.localStorage?.some((entry) => entry.name === SUPABASE_STORAGE_KEY);
  if (!hasSupabaseSession) {
    throw new Error(
      `OMNIX_E2E_STORAGE_STATE must contain ${SUPABASE_STORAGE_KEY} for the deployment origin.`,
    );
  }

  return {
    baseURL: baseURL.toString().replace(/\/$/, ""),
    storageState,
  };
}

import { apiClient } from "./api";

type QueryKey = string | readonly unknown[];

type QueryOptions = {
  ttlMs?: number;
  force?: boolean;
};

type CacheEntry<T> = {
  data: T;
  expiresAt: number;
};

const DEFAULT_QUERY_TTL_MS = 15_000;
const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function normalizeQueryKey(key: QueryKey) {
  return typeof key === "string" ? key : JSON.stringify(key);
}

export async function query<T>(
  key: QueryKey,
  fetcher: () => Promise<T>,
  options?: QueryOptions,
): Promise<T> {
  const normalizedKey = normalizeQueryKey(key);
  const ttlMs = options?.ttlMs ?? DEFAULT_QUERY_TTL_MS;
  const now = Date.now();
  const cached = cache.get(normalizedKey) as CacheEntry<T> | undefined;

  if (!options?.force && cached && cached.expiresAt > now) {
    return cached.data;
  }

  const pending = inFlight.get(normalizedKey);
  if (!options?.force && pending) {
    return pending as Promise<T>;
  }

  const request = fetcher()
    .then((data) => {
      cache.set(normalizedKey, { data, expiresAt: Date.now() + ttlMs });
      return data;
    })
    .finally(() => {
      inFlight.delete(normalizedKey);
    });

  inFlight.set(normalizedKey, request);
  return request;
}

export function queryGet<T>(endpoint: string, options?: QueryOptions & { key?: QueryKey }) {
  return query<T>(options?.key ?? endpoint, () => apiClient.get<T>(endpoint), options);
}

export function invalidateQuery(key: QueryKey) {
  cache.delete(normalizeQueryKey(key));
}

export function invalidateQueries(prefixOrMatcher?: string | ((key: string) => boolean)) {
  if (!prefixOrMatcher) {
    cache.clear();
    return;
  }

  const matcher =
    typeof prefixOrMatcher === "string"
      ? (key: string) => key.startsWith(prefixOrMatcher)
      : prefixOrMatcher;

  for (const key of cache.keys()) {
    if (matcher(key)) {
      cache.delete(key);
    }
  }
}

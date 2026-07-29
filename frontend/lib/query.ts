import {
  QueryClient,
  queryOptions,
  type QueryFilters,
  type QueryKey as TanStackQueryKey,
} from "@tanstack/react-query";
import { ApiError, apiClient } from "./api";

export type QueryKey = string | readonly unknown[];

export type QueryOptions = {
  ttlMs?: number;
  force?: boolean;
};

type QueryFetcherContext = {
  signal: AbortSignal;
};

const QUERY_SCOPE = "omnix";
const DEFAULT_QUERY_TTL_MS = 15_000;
const DEFAULT_QUERY_GC_MS = 5 * 60_000;

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "CancelledError")
  );
}

export function shouldRetryQuery(failureCount: number, error: unknown) {
  if (failureCount > 0 || isAbortError(error)) {
    return false;
  }
  if (!(error instanceof ApiError)) {
    return true;
  }
  return (
    error.status === undefined ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

export function createOmnixQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: DEFAULT_QUERY_GC_MS,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: shouldRetryQuery,
        retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 1_000),
        staleTime: DEFAULT_QUERY_TTL_MS,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") {
    return createOmnixQueryClient();
  }
  browserQueryClient ??= createOmnixQueryClient();
  return browserQueryClient;
}

export function omnixQueryKey(key: QueryKey): TanStackQueryKey {
  return [QUERY_SCOPE, key] as const;
}

export function apiQueryOptions<T>(
  endpoint: string,
  options?: QueryOptions & { key?: QueryKey },
) {
  return queryOptions({
    queryKey: omnixQueryKey(options?.key ?? endpoint),
    queryFn: ({ signal }) =>
      apiClient.get<T>(endpoint, { dedupe: false, signal }),
    staleTime: options?.ttlMs ?? DEFAULT_QUERY_TTL_MS,
  });
}

export async function query<T>(
  key: QueryKey,
  fetcher: (context: QueryFetcherContext) => Promise<T>,
  options?: QueryOptions,
): Promise<T> {
  return queryWithClient(getQueryClient(), key, fetcher, options);
}

export async function queryWithClient<T>(
  client: QueryClient,
  key: QueryKey,
  fetcher: (context: QueryFetcherContext) => Promise<T>,
  options?: QueryOptions,
): Promise<T> {
  const queryKey = omnixQueryKey(key);

  if (options?.force) {
    await client.cancelQueries(
      { exact: true, queryKey },
      { silent: true },
    );
    await client.invalidateQueries({
      exact: true,
      queryKey,
      refetchType: "none",
    });
  }

  return client.fetchQuery({
    queryKey,
    queryFn: fetcher,
    staleTime: options?.ttlMs ?? DEFAULT_QUERY_TTL_MS,
  });
}

export function queryGet<T>(
  endpoint: string,
  options?: QueryOptions & { key?: QueryKey },
) {
  return query<T>(
    options?.key ?? endpoint,
    ({ signal }) =>
      apiClient.get<T>(endpoint, { dedupe: false, signal }),
    options,
  );
}

export function invalidateQuery(key: QueryKey) {
  void invalidateClientQuery(getQueryClient(), key);
}

export function invalidateClientQuery(
  client: QueryClient,
  key: QueryKey,
) {
  const filters: QueryFilters = {
    exact: true,
    queryKey: omnixQueryKey(key),
  } as const;
  const cancellation = client.cancelQueries(filters, { silent: true });
  const invalidation = client.invalidateQueries(filters);
  return Promise.all([cancellation, invalidation]).then(() => undefined);
}

export function invalidateQueries(
  prefixOrMatcher?: string | ((key: string) => boolean),
) {
  void invalidateClientQueries(getQueryClient(), prefixOrMatcher);
}

export function invalidateClientQueries(
  client: QueryClient,
  prefixOrMatcher?: string | ((key: string) => boolean),
) {
  if (!prefixOrMatcher) {
    client.clear();
    return Promise.resolve();
  }

  const matcher =
    typeof prefixOrMatcher === "string"
      ? (key: string) => key.startsWith(prefixOrMatcher)
      : prefixOrMatcher;

  const filters: QueryFilters = {
    predicate: (candidate) => {
      if (candidate.queryKey[0] !== QUERY_SCOPE) {
        return false;
      }
      const rawKey = candidate.queryKey[1];
      const normalizedKey =
        typeof rawKey === "string" ? rawKey : JSON.stringify(rawKey);
      return matcher(normalizedKey);
    },
  };
  const cancellation = client.cancelQueries(filters, { silent: true });
  const invalidation = client.invalidateQueries(filters);
  return Promise.all([cancellation, invalidation]).then(() => undefined);
}

import { expect, test } from "@playwright/test";
import { ApiError } from "../lib/api";
import {
  createOmnixQueryClient,
  invalidateClientQueries,
  omnixQueryKey,
  queryWithClient,
} from "../lib/query";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("deduplicates a query and reuses fresh cached data", async () => {
  const client = createOmnixQueryClient();
  const pending = deferred<string>();
  let calls = 0;
  const fetcher = () => {
    calls += 1;
    return pending.promise;
  };

  const first = queryWithClient(client, "/workspaces/one/tasks", fetcher);
  const second = queryWithClient(client, "/workspaces/one/tasks", fetcher);

  expect(calls).toBe(1);
  pending.resolve("current");
  await expect(first).resolves.toBe("current");
  await expect(second).resolves.toBe("current");
  await expect(
    queryWithClient(client, "/workspaces/one/tasks", fetcher),
  ).resolves.toBe("current");
  expect(calls).toBe(1);
  client.clear();
});

test("a forced query cancels the older request and keeps the fresh value", async () => {
  const client = createOmnixQueryClient();
  let calls = 0;
  let firstAborted = false;
  const fetcher = ({ signal }: { signal: AbortSignal }) => {
    calls += 1;
    if (calls > 1) {
      return Promise.resolve("fresh");
    }
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        firstAborted = true;
        reject(new DOMException("Cancelled", "AbortError"));
      }, { once: true });
    });
  };

  const first = queryWithClient(client, "/workspaces/one/channels", fetcher);
  const fresh = await queryWithClient(
    client,
    "/workspaces/one/channels",
    fetcher,
    { force: true },
  );
  await first.catch(() => undefined);

  expect(firstAborted).toBe(true);
  expect(fresh).toBe("fresh");
  expect(client.getQueryData(
    omnixQueryKey("/workspaces/one/channels"),
  )).toBe("fresh");
  client.clear();
});

test("invalidation cancels a pending value before a replacement read", async () => {
  const client = createOmnixQueryClient();
  const firstStarted = deferred<void>();
  let calls = 0;
  let firstAborted = false;
  const fetcher = ({ signal }: { signal: AbortSignal }) => {
    calls += 1;
    if (calls > 1) {
      return Promise.resolve("after-mutation");
    }
    firstStarted.resolve();
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        firstAborted = true;
        reject(new DOMException("Cancelled", "AbortError"));
      }, { once: true });
    });
  };

  const stale = queryWithClient(
    client,
    "/workspaces/one/initiatives",
    fetcher,
  );
  await firstStarted.promise;
  await invalidateClientQueries(client, "/workspaces/one");
  const current = await queryWithClient(
    client,
    "/workspaces/one/initiatives",
    fetcher,
  );
  await stale.catch(() => undefined);

  expect(firstAborted).toBe(true);
  expect(current).toBe("after-mutation");
  expect(calls).toBe(2);
  client.clear();
});

test("invalidation makes fresh cached data stale before returning", async () => {
  const client = createOmnixQueryClient();
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return calls === 1 ? "before-mutation" : "after-mutation";
  };

  await expect(queryWithClient(
    client,
    "/workspaces/one/initiatives",
    fetcher,
  )).resolves.toBe("before-mutation");

  const invalidation = invalidateClientQueries(client, "/workspaces/one");
  const refreshed = queryWithClient(
    client,
    "/workspaces/one/initiatives",
    fetcher,
  );

  await invalidation;
  await expect(refreshed).resolves.toBe("after-mutation");
  expect(calls).toBe(2);
  client.clear();
});

test("a realtime projection survives cancellation of a stale snapshot", async () => {
  const client = createOmnixQueryClient();
  const queryKey = omnixQueryKey("/workspaces/one/channels");
  const snapshotStarted = deferred<void>();
  let snapshotAborted = false;
  const staleSnapshot = queryWithClient(
    client,
    "/workspaces/one/channels",
    ({ signal }) => {
      snapshotStarted.resolve();
      return new Promise<string[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          snapshotAborted = true;
          reject(new DOMException("Cancelled", "AbortError"));
        }, { once: true });
      });
    },
  );

  await snapshotStarted.promise;
  await client.cancelQueries(
    { exact: true, queryKey },
    { silent: true },
  );
  client.setQueryData(queryKey, ["realtime-channel"]);
  await client.invalidateQueries({ exact: true, queryKey });
  await staleSnapshot.catch(() => undefined);

  expect(snapshotAborted).toBe(true);
  expect(client.getQueryData(queryKey)).toEqual(["realtime-channel"]);

  await expect(queryWithClient(
    client,
    "/workspaces/one/channels",
    async () => ["canonical-channel"],
  )).resolves.toEqual(["canonical-channel"]);
  expect(client.getQueryData(queryKey)).toEqual(["canonical-channel"]);
  client.clear();
});

test("retries one transient failure but does not retry a client error", async () => {
  const transientClient = createOmnixQueryClient();
  let transientCalls = 0;
  const recovered = await queryWithClient(
    transientClient,
    "/workspaces/one/timeline",
    async () => {
      transientCalls += 1;
      if (transientCalls === 1) {
        throw new ApiError("Temporary failure", {
          endpoint: "/workspaces/one/timeline",
          method: "GET",
          status: 503,
          url: "/api/workspaces/one/timeline",
        });
      }
      return "recovered";
    },
  );

  const clientErrorClient = createOmnixQueryClient();
  let clientErrorCalls = 0;
  await expect(queryWithClient(
    clientErrorClient,
    "/workspaces/one/private",
    async () => {
      clientErrorCalls += 1;
      throw new ApiError("Denied", {
        endpoint: "/workspaces/one/private",
        method: "GET",
        status: 403,
        url: "/api/workspaces/one/private",
      });
    },
  )).rejects.toThrow("Denied");

  expect(recovered).toBe("recovered");
  expect(transientCalls).toBe(2);
  expect(clientErrorCalls).toBe(1);
  transientClient.clear();
  clientErrorClient.clear();
});

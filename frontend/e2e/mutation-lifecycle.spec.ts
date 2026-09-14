import { expect, test } from "@playwright/test";
import {
  latestOwnedMutationFailure,
  mutationAttempt,
  mutationRevisionStillOwned,
  recordOwnedMutationFailure,
  releaseExclusiveMutation,
  releaseExclusiveMutations,
  resolveOwnedMutationFailure,
  resolveMutationFailure,
  rollbackOptimisticPatch,
  runExclusiveMutation,
} from "../lib/mutation-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("deduplicates the same mutation synchronously and releases it after success", async () => {
  const registry = new Map<string, Promise<unknown>>();
  const pending = deferred<string>();
  let calls = 0;
  const operation = () => {
    calls += 1;
    return pending.promise;
  };

  const first = runExclusiveMutation(registry, "task:create:workspace-one", operation);
  const duplicate = runExclusiveMutation(registry, "task:create:workspace-one", operation);

  expect(duplicate).toBe(first);
  expect(calls).toBe(1);
  pending.resolve("created");
  await expect(first).resolves.toBe("created");
  expect(registry.size).toBe(0);

  await expect(
    runExclusiveMutation(registry, "task:create:workspace-one", async () => {
      calls += 1;
      return "created-again";
    }),
  ).resolves.toBe("created-again");
  expect(calls).toBe(2);
});

test("installs the lane before synchronous execution and releases synchronous throws", async () => {
  const registry = new Map<string, Promise<unknown>>();
  let nested: Promise<string> | undefined;
  const first = runExclusiveMutation(registry, "workspace:rename", async () => {
    nested = runExclusiveMutation(registry, "workspace:rename", async () => "nested");
    return "renamed";
  });

  expect(nested).toBe(first);
  await expect(first).resolves.toBe("renamed");

  const failed = runExclusiveMutation(registry, "workspace:rename", () => {
    throw new Error("synchronous failure");
  });
  await expect(failed).rejects.toThrow("synchronous failure");
  expect(registry.size).toBe(0);
});

test("releases a failed mutation and does not block a different key", async () => {
  const registry = new Map<string, Promise<unknown>>();
  const pending = deferred<string>();

  const first = runExclusiveMutation(
    registry,
    "task:update:task-one",
    () => pending.promise,
  );
  const parallel = runExclusiveMutation(
    registry,
    "task:update:task-two",
    async () => "parallel",
  );

  await expect(parallel).resolves.toBe("parallel");
  pending.reject(new Error("network unavailable"));
  await expect(first).rejects.toThrow("network unavailable");
  expect(registry.size).toBe(0);
});

test("an externally committed mutation can release its lane before transport settles", async () => {
  const registry = new Map<string, Promise<unknown>>();
  let finishFirst!: () => void;
  let finishSecond!: () => void;
  const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const secondGate = new Promise<void>((resolve) => { finishSecond = resolve; });
  const first = runExclusiveMutation(registry, "message", () => firstGate);

  expect(releaseExclusiveMutation(registry, "message")).toBe(true);
  const second = runExclusiveMutation(registry, "message", () => secondGate);
  finishFirst();
  await first;

  expect(runExclusiveMutation(registry, "message", async () => undefined)).toBe(second);
  finishSecond();
  await second;
});

test("scope release abandons only matching lanes and keeps late cleanup identity-safe", async () => {
  const registry = new Map<string, Promise<unknown>>();
  let releaseOld!: () => void;
  const oldRequest = runExclusiveMutation(registry, "task:create:workspace-a", () => (
    new Promise<void>((resolve) => { releaseOld = resolve; })
  ));
  const otherRequest = runExclusiveMutation(
    registry,
    "task:create:workspace-b",
    async () => "other",
  );

  expect(releaseExclusiveMutations(registry, (key) => key.endsWith("workspace-a"))).toBe(1);
  const replacement = runExclusiveMutation(
    registry,
    "task:create:workspace-a",
    async () => "replacement",
  );
  releaseOld();

  await expect(oldRequest).resolves.toBeUndefined();
  await expect(otherRequest).resolves.toBe("other");
  await expect(replacement).resolves.toBe("replacement");
});

test("token-owned failures reveal older unresolved errors when a newer one clears", () => {
  const first = recordOwnedMutationFailure([], {
    key: "channel-create",
    message: "Channel failed",
    token: "channel-a",
  });
  const both = recordOwnedMutationFailure(first, {
    key: "message-delivery",
    message: "Message failed",
    token: "message-b",
  });

  expect(latestOwnedMutationFailure(both)).toBe("Message failed");
  expect(latestOwnedMutationFailure(
    resolveOwnedMutationFailure(both, "message-delivery", "wrong-token"),
  )).toBe("Message failed");
  expect(latestOwnedMutationFailure(
    resolveOwnedMutationFailure(both, "message-delivery", "message-b"),
  )).toBe("Channel failed");
});

test("draft ownership is lost after any newer edit, even if its value is restored", () => {
  expect(mutationRevisionStillOwned(4, 4)).toBe(true);
  expect(mutationRevisionStillOwned(6, 4)).toBe(false);
  expect(mutationRevisionStillOwned(4, null)).toBe(false);
});

test("a shared failure banner clears only after every owned failure resolves", () => {
  const failures = new Set(["main-send", "thread-send"]);

  expect(resolveMutationFailure(failures, "thread-send")).toBe(false);
  expect(failures).toEqual(new Set(["main-send"]));
  expect(resolveMutationFailure(failures, "unrelated")).toBe(false);
  expect(resolveMutationFailure(failures, "main-send")).toBe(true);
  expect(failures.size).toBe(0);
});

test("reuses a nonce only while retrying the same semantic attempt", () => {
  let generated = 0;
  const createNonce = () => `nonce-${++generated}`;

  const first = mutationAttempt(null, "workspace-one::task title", createNonce);
  const retry = mutationAttempt(first, "workspace-one::task title", createNonce);
  const changedPayload = mutationAttempt(retry, "workspace-one::new title", createNonce);
  const changedWorkspace = mutationAttempt(
    changedPayload,
    "workspace-two::new title",
    createNonce,
  );

  expect(retry).toBe(first);
  expect(retry.nonce).toBe("nonce-1");
  expect(changedPayload.nonce).toBe("nonce-2");
  expect(changedWorkspace.nonce).toBe("nonce-3");
});

test("rolls back only fields still owned by the failed optimistic patch", () => {
  const before = {
    id: "task-one",
    status: "idea",
    owner: "Ada",
    title: "Original",
  };
  const optimistic = {
    status: "active",
    owner: "Grace",
  };

  expect(
    rollbackOptimisticPatch(
      {
        ...before,
        ...optimistic,
        owner: "Lin",
        title: "Realtime title",
      },
      before,
      optimistic,
    ),
  ).toEqual({
    id: "task-one",
    status: "idea",
    owner: "Lin",
    title: "Realtime title",
  });
});

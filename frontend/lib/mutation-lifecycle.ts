export type MutationAttempt = Readonly<{
  fingerprint: string;
  nonce: string;
}>;

type MutationRegistry = Map<string, Promise<unknown>>;

export type OwnedMutationFailure = Readonly<{
  key: string;
  message: string;
  token: string;
}>;

function createMutationNonce() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function runExclusiveMutation<T>(
  registry: MutationRegistry,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const inFlight = registry.get(key) as Promise<T> | undefined;
  if (inFlight) {
    return inFlight;
  }

  let resolveRequest!: (value: T | PromiseLike<T>) => void;
  let rejectRequest!: (reason?: unknown) => void;
  const request = new Promise<T>((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  registry.set(key, request);
  try {
    Promise.resolve(operation()).then(resolveRequest, rejectRequest);
  } catch (error) {
    rejectRequest(error);
  }
  const release = () => {
    if (registry.get(key) === request) {
      registry.delete(key);
    }
  };
  void request.then(release, release);
  return request;
}

export function releaseExclusiveMutation(
  registry: MutationRegistry,
  key: string,
) {
  return registry.delete(key);
}

export function releaseExclusiveMutations(
  registry: MutationRegistry,
  matches: (key: string) => boolean,
) {
  let released = 0;
  for (const key of [...registry.keys()]) {
    if (matches(key) && registry.delete(key)) {
      released += 1;
    }
  }
  return released;
}

export function recordOwnedMutationFailure(
  failures: readonly OwnedMutationFailure[],
  failure: OwnedMutationFailure,
) {
  return [...failures.filter((current) => current.key !== failure.key), failure];
}

export function resolveOwnedMutationFailure(
  failures: readonly OwnedMutationFailure[],
  key: string,
  token: string,
) {
  return failures.filter((failure) => failure.key !== key || failure.token !== token);
}

export function latestOwnedMutationFailure(
  failures: readonly OwnedMutationFailure[],
) {
  return failures[failures.length - 1]?.message ?? null;
}

export function mutationRevisionStillOwned(
  currentRevision: number,
  ownedRevision: number | null,
) {
  return ownedRevision !== null && currentRevision === ownedRevision;
}

export function resolveMutationFailure(
  failures: Set<string>,
  key: string,
) {
  return failures.delete(key) && failures.size === 0;
}

export function mutationAttempt(
  current: MutationAttempt | null,
  fingerprint: string,
  nonceFactory: () => string = createMutationNonce,
): MutationAttempt {
  if (current?.fingerprint === fingerprint) {
    return current;
  }
  return {
    fingerprint,
    nonce: nonceFactory(),
  };
}

export function rollbackOptimisticPatch<T extends object>(
  current: T,
  before: T,
  optimisticPatch: Partial<T>,
): T {
  let next = current;

  for (const key of Object.keys(optimisticPatch) as Array<keyof T>) {
    if (!Object.is(current[key], optimisticPatch[key])) {
      continue;
    }
    if (next === current) {
      next = { ...current };
    }
    next[key] = before[key];
  }

  return next;
}

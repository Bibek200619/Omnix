"use client";

import { useCallback, useMemo, useState } from "react";
import {
  type OwnedMutationFailure,
  latestOwnedMutationFailure,
  recordOwnedMutationFailure,
  resolveOwnedMutationFailure,
} from "@/lib/mutation-lifecycle";

export type ReportConversationFailure = (
  key: string,
  token: string,
  message: string,
) => void;

export type ResolveConversationFailure = (
  key: string,
  token: string,
) => void;

export function useConversationFailures() {
  const [failures, setFailures] = useState<OwnedMutationFailure[]>([]);

  const reportFailure = useCallback<ReportConversationFailure>(
    (key, token, message) => {
      setFailures((current) => recordOwnedMutationFailure(current, {
        key,
        message,
        token,
      }));
    },
    [],
  );
  const resolveFailure = useCallback<ResolveConversationFailure>(
    (key, token) => {
      setFailures((current) => resolveOwnedMutationFailure(current, key, token));
    },
    [],
  );
  const dismissLatestFailure = useCallback(() => {
    setFailures((current) => {
      const latest = current[current.length - 1];
      return latest
        ? resolveOwnedMutationFailure(current, latest.key, latest.token)
        : current;
    });
  }, []);
  const clearFailures = useCallback(() => setFailures([]), []);
  const error = useMemo(() => latestOwnedMutationFailure(failures), [failures]);

  return {
    clearFailures,
    dismissLatestFailure,
    error,
    reportFailure,
    resolveFailure,
  };
}

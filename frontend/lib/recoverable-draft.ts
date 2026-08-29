"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type SetStateAction } from "react";

const draftStoragePrefix = "omnix.draft.v1";
const useDraftHydrationEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function encodeDraftPart(part: unknown) {
  const text = String(part ?? "none").trim() || "none";
  return encodeURIComponent(text);
}

export function recoverableDraftKey(parts: readonly unknown[]) {
  return `${draftStoragePrefix}:${parts.map(encodeDraftPart).join(":")}`;
}

export function readRecoverableDraft(key: string | null) {
  if (!key) return null;
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeRecoverableDraft(
  key: string | null,
  value: string,
  defaultValue = "",
) {
  if (!key) return;
  try {
    const store = storage();
    if (!store) return;
    if (value === defaultValue) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    // Draft recovery is best effort; component state remains authoritative.
  }
}

export function clearRecoverableDraft(key: string | null) {
  if (!key) return;
  try {
    storage()?.removeItem(key);
  } catch {
    // Draft recovery is best effort.
  }
}

export function useRecoverableTextDraft(
  key: string | null,
  defaultValue = "",
) {
  const [value, setValueState] = useState(defaultValue);

  useDraftHydrationEffect(() => {
    setValueState(readRecoverableDraft(key) ?? defaultValue);
  }, [defaultValue, key]);

  const setValue = useCallback((next: SetStateAction<string>) => {
    setValueState((current) => {
      const resolved = typeof next === "function"
        ? (next as (value: string) => string)(current)
        : next;
      writeRecoverableDraft(key, resolved, defaultValue);
      return resolved;
    });
  }, [defaultValue, key]);

  const clearValue = useCallback(() => {
    clearRecoverableDraft(key);
    setValueState(defaultValue);
  }, [defaultValue, key]);

  return [value, setValue, clearValue] as const;
}

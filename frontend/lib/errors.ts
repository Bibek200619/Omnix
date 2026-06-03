"use client";

import { ApiError } from "@/lib/api";

type ClientErrorDiagnostics = {
  endpoint?: string;
  status?: number;
  responsePayload?: unknown;
  [key: string]: unknown;
};

export function ensureSentence(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function logClientError(label: string, error: unknown, diagnostics: ClientErrorDiagnostics = {}) {
  const apiError = error instanceof ApiError ? error : null;
  console.error(label, {
    error,
    endpoint: diagnostics.endpoint ?? apiError?.endpoint,
    status: diagnostics.status ?? apiError?.status,
    responsePayload: diagnostics.responsePayload ?? apiError?.responsePayload,
    rawMessage: apiError?.rawMessage,
    ...diagnostics,
  });
}

export function userError(fallback: string) {
  return ensureSentence(fallback);
}

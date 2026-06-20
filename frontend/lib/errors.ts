"use client";

import { ApiError } from "@/lib/api";

type ClientErrorDiagnostics = {
  endpoint?: string;
  status?: number;
  responsePayload?: unknown;
  [key: string]: unknown;
};

const isDevelopment = process.env.NODE_ENV !== "production";

export function ensureSentence(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function logClientError(label: string, error: unknown, diagnostics: ClientErrorDiagnostics = {}) {
  const apiError = error instanceof ApiError ? error : null;
  const endpoint = diagnostics.endpoint ?? apiError?.endpoint;
  const status = diagnostics.status ?? apiError?.status;

  if (!isDevelopment) {
    console.error(label, {
      error: apiError
        ? apiError.toJSON({ includeSensitive: false })
        : error instanceof Error
          ? { name: error.name, message: "Client error redacted in production logs." }
          : { type: typeof error },
      endpoint,
      status,
      sensitiveFieldsRedacted: Boolean(diagnostics.responsePayload || apiError?.responsePayload || apiError?.rawMessage),
    });
    return;
  }

  console.error(label, {
    error: apiError ? apiError.toJSON({ includeSensitive: true }) : error,
    endpoint,
    status,
    responsePayload: diagnostics.responsePayload ?? apiError?.responsePayload,
    rawMessage: apiError?.rawMessage,
    ...diagnostics,
  });
}

export function userError(fallback: string) {
  return ensureSentence(fallback);
}

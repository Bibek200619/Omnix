"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { logClientError } from "@/lib/errors";

type ErrorBoundaryState = {
  hasError: boolean;
};

type AppErrorBoundaryProps = {
  children: ReactNode;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logClientError("Unhandled application render error", error, {
      componentStack: errorInfo.componentStack,
    });
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  private refreshPage = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main
          aria-live="assertive"
          className="flex min-h-screen items-center justify-center bg-[var(--omnix-bg)] px-6 text-white"
        >
          <section className="max-w-md text-center">
            <p className="omnix-display text-3xl font-bold tracking-[0.18em] text-cyan-100">OMNIX</p>
            <h1 className="mt-6 text-2xl font-semibold">Something went wrong.</h1>
            <p className="mt-3 text-sm leading-6 text-[var(--omnix-text-2)]">Try recovering first. Drafts in active composers are restored when this view remounts.</p>
            <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                className="omnix-primary-action min-h-11 rounded-xl px-5 py-2.5 text-sm font-semibold"
                onClick={this.reset}
              >
                Try again
              </button>
              <button
                type="button"
                className="min-h-11 rounded-xl border border-[var(--omnix-border)] px-5 py-2.5 text-sm font-semibold text-[var(--omnix-text-2)] transition hover:border-cyan-300/35 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                onClick={this.refreshPage}
              >
                Reload page
              </button>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

type SurfaceErrorBoundaryProps = {
  children: ReactNode;
  surfaceName: string;
};

export class SurfaceErrorBoundary extends Component<SurfaceErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logClientError(`${this.props.surfaceName} render error`, error, {
      componentStack: errorInfo.componentStack,
    });
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-3 sm:p-5">
          <OmnixErrorState
            title={`${this.props.surfaceName} needs attention`}
            message="This workspace surface could not render. Try again; active composer drafts are restored when it remounts."
            retryLabel="Try again"
            onRetry={this.reset}
          />
        </div>
      );
    }

    return this.props.children;
  }
}

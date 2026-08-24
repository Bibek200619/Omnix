export type VisibleRefreshReason = "interval" | "focus" | "visible";

type VisibleRefreshEntry = {
  callback: (reason: VisibleRefreshReason) => void;
  intervalMs: number;
  nextRunAt: number;
  reactivate: boolean;
};

type VisibleRefreshOptions = {
  key: string;
  intervalMs: number;
  callback: (reason: VisibleRefreshReason) => void;
  reactivate?: boolean;
};

class VisibleRefreshRegistry {
  private entries = new Map<string, VisibleRefreshEntry>();
  private timerId: number | null = null;
  private listening = false;
  private lastReactivateAt = 0;

  private invoke(entry: VisibleRefreshEntry, reason: VisibleRefreshReason) {
    try {
      entry.callback(reason);
    } catch (error) {
      console.error("[visible-refresh] callback failed", error);
    }
  }

  private clearTimer() {
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  private schedule() {
    this.clearTimer();
    if (this.entries.size === 0 || document.visibilityState !== "visible") return;

    const now = Date.now();
    const nextRunAt = Math.min(...Array.from(this.entries.values(), (entry) => entry.nextRunAt));
    this.timerId = window.setTimeout(() => this.runDueEntries(), Math.max(0, nextRunAt - now));
  }

  private runDueEntries() {
    this.timerId = null;
    if (document.visibilityState !== "visible") return;

    const now = Date.now();
    if (now - this.lastReactivateAt < 100) return;
    this.lastReactivateAt = now;
    for (const entry of this.entries.values()) {
      if (entry.nextRunAt <= now) {
        entry.nextRunAt = now + entry.intervalMs;
        this.invoke(entry, "interval");
      }
    }
    this.schedule();
  }

  private reactivate = (reason: "focus" | "visible") => {
    if (document.visibilityState !== "visible") return;

    const now = Date.now();
    for (const entry of this.entries.values()) {
      entry.nextRunAt = now + entry.intervalMs;
      if (entry.reactivate) this.invoke(entry, reason);
    }
    this.schedule();
  };

  private handleFocus = () => this.reactivate("focus");

  private handleVisibility = () => {
    if (document.visibilityState === "visible") {
      this.reactivate("visible");
    } else {
      this.clearTimer();
    }
  };

  private attach() {
    if (this.listening) return;
    window.addEventListener("focus", this.handleFocus);
    document.addEventListener("visibilitychange", this.handleVisibility);
    this.listening = true;
  }

  private detach() {
    if (!this.listening) return;
    window.removeEventListener("focus", this.handleFocus);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.listening = false;
    this.lastReactivateAt = 0;
    this.clearTimer();
  }

  subscribe({ key, intervalMs, callback, reactivate = true }: VisibleRefreshOptions) {
    if (typeof window === "undefined" || intervalMs <= 0) return () => undefined;

    this.entries.set(key, {
      callback,
      intervalMs,
      nextRunAt: Date.now() + intervalMs,
      reactivate,
    });
    this.attach();
    this.schedule();

    return () => {
      this.entries.delete(key);
      if (this.entries.size === 0) this.detach();
      else this.schedule();
    };
  }
}

export const visibleRefreshRegistry = new VisibleRefreshRegistry();

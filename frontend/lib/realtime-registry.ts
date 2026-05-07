import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type SubscriptionType = "presence" | "activity" | "status" | "typing" | "revocation";
type RealtimeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | string;

interface SubscriptionKey {
  type: SubscriptionType;
  workspaceId?: string;
  conversationId?: string;
}

type SubscriptionSetup = (channel: RealtimeChannel) => RealtimeChannel;
type SubscriptionStatusHandler = (status: RealtimeStatus) => void;

type SubscriptionEntry = {
  channel: RealtimeChannel;
  setup: SubscriptionSetup;
  onStatus?: SubscriptionStatusHandler;
  reconnectAttempts: number;
  reconnectTimer: number | null;
};

const MAX_RECONNECT_DELAY_MS = 15_000;

class RealtimeSubscriptionRegistry {
  private subscriptions: Map<string, SubscriptionEntry> = new Map();

  private generateKey(key: SubscriptionKey): string {
    return `${key.type}:${key.workspaceId ?? "global"}:${key.conversationId ?? "none"}`;
  }

  private createChannel(
    stringKey: string,
    setup: SubscriptionSetup,
    onStatus?: SubscriptionStatusHandler,
    reconnectAttempts = 0,
  ): RealtimeChannel {
    if (!supabase) {
      throw new Error("Supabase is not configured.");
    }

    const channel = setup(supabase.channel(stringKey));
    const entry: SubscriptionEntry = {
      channel,
      setup,
      onStatus,
      reconnectAttempts,
      reconnectTimer: null,
    };
    this.subscriptions.set(stringKey, entry);

    channel.subscribe((status) => {
      console.debug(`[realtime] ${stringKey} status:`, status);
      onStatus?.(status);

      if (status === "SUBSCRIBED") {
        const current = this.subscriptions.get(stringKey);
        if (current) {
          current.reconnectAttempts = 0;
        }
        return;
      }

      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        this.scheduleReconnect(stringKey);
      }
    });

    return channel;
  }

  private scheduleReconnect(stringKey: string) {
    const entry = this.subscriptions.get(stringKey);
    if (!entry || entry.reconnectTimer) {
      return;
    }

    const delay = Math.min(1_000 * 2 ** entry.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    entry.reconnectAttempts += 1;
    console.warn(`[realtime] ${stringKey} reconnect scheduled in ${delay}ms`);

    entry.reconnectTimer = window.setTimeout(() => {
      const current = this.subscriptions.get(stringKey);
      if (!current) {
        return;
      }

      current.reconnectTimer = null;
      void current.channel.unsubscribe();
      this.createChannel(stringKey, current.setup, current.onStatus, current.reconnectAttempts);
    }, delay);
  }

  subscribe(
    key: SubscriptionKey,
    setup: SubscriptionSetup,
    onStatus?: SubscriptionStatusHandler,
  ): RealtimeChannel | null {
    if (!supabase) {
      console.warn("[realtime] subscription attempted but supabase is not configured");
      return null;
    }

    const stringKey = this.generateKey(key);
    
    // Cleanup existing if any
    this.unsubscribe(key);

    return this.createChannel(stringKey, setup, onStatus);
  }

  unsubscribe(key: SubscriptionKey) {
    const stringKey = this.generateKey(key);
    const existing = this.subscriptions.get(stringKey);
    if (existing) {
      console.debug(`[realtime] unsubscribing from ${stringKey}`);
      if (existing.reconnectTimer) {
        window.clearTimeout(existing.reconnectTimer);
      }
      void existing.channel.unsubscribe();
      this.subscriptions.delete(stringKey);
    }
  }

  unsubscribeAll() {
    console.debug(`[realtime] unsubscribing from all ${this.subscriptions.size} channels`);
    this.subscriptions.forEach((entry) => {
      if (entry.reconnectTimer) {
        window.clearTimeout(entry.reconnectTimer);
      }
      void entry.channel.unsubscribe();
    });
    this.subscriptions.clear();
  }

  getSubscription(key: SubscriptionKey): RealtimeChannel | undefined {
    return this.subscriptions.get(this.generateKey(key))?.channel;
  }
}

export const realtimeRegistry = new RealtimeSubscriptionRegistry();

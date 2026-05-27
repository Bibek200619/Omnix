import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type SubscriptionType = "presence" | "activity" | "status" | "typing" | "revocation" | "channels" | "channel_messages" | "conversation_identity" | "tasks" | "initiatives";
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
  isUnsubscribing: boolean;
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
  ): RealtimeChannel | null {
    if (!supabase) {
      console.warn("[realtime] supabase not configured");
      return null;
    }

    // Ensure we don't have an active entry for this key before creating
    const existing = this.subscriptions.get(stringKey);
    if (existing && !existing.isUnsubscribing) {
      console.warn(`[realtime] channel ${stringKey} already exists and is active`);
      return existing.channel;
    }

    const rawChannel = supabase.channel(stringKey);
    const channel = setup(rawChannel);
    
    const entry: SubscriptionEntry = {
      channel,
      setup,
      onStatus,
      reconnectAttempts,
      reconnectTimer: null,
      isUnsubscribing: false,
    };
    this.subscriptions.set(stringKey, entry);

    channel.subscribe((status) => {
      // Re-verify entry still exists and matches this channel instance
      const current = this.subscriptions.get(stringKey);
      if (!current || current.channel !== channel || current.isUnsubscribing) {
        return;
      }

      console.debug(`[realtime] ${stringKey} status:`, status);
      onStatus?.(status);

      if (status === "SUBSCRIBED") {
        current.reconnectAttempts = 0;
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
    if (!entry || entry.reconnectTimer || entry.isUnsubscribing) {
      return;
    }

    const delay = Math.min(1_000 * 2 ** entry.reconnectAttempts, MAX_RECONNECT_DELAY_MS);
    entry.reconnectAttempts += 1;
    console.warn(`[realtime] ${stringKey} reconnect scheduled in ${delay}ms`);

    entry.reconnectTimer = window.setTimeout(() => {
      const current = this.subscriptions.get(stringKey);
      if (!current || current.isUnsubscribing) {
        return;
      }

      current.reconnectTimer = null;
      // Use internal unsubscribe logic that doesn't clear the entry if we're just reconnecting
      void current.channel.unsubscribe().then(() => {
        // Double check we still want to reconnect
        if (this.subscriptions.get(stringKey) === current && !current.isUnsubscribing) {
          this.createChannel(stringKey, current.setup, current.onStatus, current.reconnectAttempts);
        }
      });
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
    const existing = this.subscriptions.get(stringKey);
    if (existing) {
       this.unsubscribe(key);
    }

    return this.createChannel(stringKey, setup, onStatus);
  }

  unsubscribe(key: SubscriptionKey) {
    const stringKey = this.generateKey(key);
    const existing = this.subscriptions.get(stringKey);
    if (existing && !existing.isUnsubscribing) {
      console.debug(`[realtime] unsubscribing from ${stringKey}`);
      existing.isUnsubscribing = true;
      if (existing.reconnectTimer) {
        window.clearTimeout(existing.reconnectTimer);
        existing.reconnectTimer = null;
      }
      void existing.channel.unsubscribe().finally(() => {
        if (this.subscriptions.get(stringKey) === existing) {
           this.subscriptions.delete(stringKey);
        }
      });
    }
  }

  unsubscribeAll() {
    console.debug(`[realtime] unsubscribing from all ${this.subscriptions.size} channels`);
    this.subscriptions.forEach((entry) => {
      if (!entry.isUnsubscribing) {
        entry.isUnsubscribing = true;
        if (entry.reconnectTimer) {
          window.clearTimeout(entry.reconnectTimer);
          entry.reconnectTimer = null;
        }
        void entry.channel.unsubscribe();
      }
    });
    this.subscriptions.clear();
  }

  getSubscription(key: SubscriptionKey): RealtimeChannel | undefined {
    return this.subscriptions.get(this.generateKey(key))?.channel;
  }
}

export const realtimeRegistry = new RealtimeSubscriptionRegistry();

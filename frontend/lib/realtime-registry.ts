import { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type SubscriptionType = "presence" | "activity" | "status" | "typing";

interface SubscriptionKey {
  type: SubscriptionType;
  workspaceId?: string;
  conversationId?: string;
}

class RealtimeSubscriptionRegistry {
  private subscriptions: Map<string, RealtimeChannel> = new Map();

  private generateKey(key: SubscriptionKey): string {
    return `${key.type}:${key.workspaceId ?? "global"}:${key.conversationId ?? "none"}`;
  }

  subscribe(
    key: SubscriptionKey,
    setup: (channel: RealtimeChannel) => RealtimeChannel
  ): RealtimeChannel | null {
    if (!supabase) {
      console.warn("[realtime] subscription attempted but supabase is not configured");
      return null;
    }

    const stringKey = this.generateKey(key);
    
    // Cleanup existing if any
    this.unsubscribe(key);

    const channel = setup(supabase.channel(stringKey));
    
    channel.subscribe((status) => {
      console.debug(`[realtime] ${stringKey} status:`, status);
      if (status === "CHANNEL_ERROR") {
        // Simple backoff could be added here
        console.warn(`[realtime] ${stringKey} error, will attempt reconnect by lifecycle`);
      }
    });

    this.subscriptions.set(stringKey, channel);
    return channel;
  }

  unsubscribe(key: SubscriptionKey) {
    const stringKey = this.generateKey(key);
    const existing = this.subscriptions.get(stringKey);
    if (existing) {
      console.debug(`[realtime] unsubscribing from ${stringKey}`);
      void existing.unsubscribe();
      this.subscriptions.delete(stringKey);
    }
  }

  unsubscribeAll() {
    console.debug(`[realtime] unsubscribing from all ${this.subscriptions.size} channels`);
    this.subscriptions.forEach((channel) => {
      void channel.unsubscribe();
    });
    this.subscriptions.clear();
  }

  getSubscription(key: SubscriptionKey): RealtimeChannel | undefined {
    return this.subscriptions.get(this.generateKey(key));
  }
}

export const realtimeRegistry = new RealtimeSubscriptionRegistry();

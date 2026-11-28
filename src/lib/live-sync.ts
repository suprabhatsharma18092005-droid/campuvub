import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { refreshPushTokenSilently, pushDeviceId } from "@/lib/push";
import { savePushDevice } from "@/lib/push-device";
import { useSession } from "@/lib/session";

const TABLE_KEYS: Record<string, string[][]> = {
  products: [["products"]],
  categories: [["categories"]],
  subcategories: [["subcategories"]],
  brands: [["brands"]],
  banners: [["banners"], ["admin-banners"]],
  app_settings: [["app_settings"], ["admin-coins"], ["admin-delivery-boy"], ["admin-accounting"]],
};

let mounted = 0;

/** One shared realtime channel for catalogue + order + wallet changes. Mount once (AppShell). */
export function useLiveSync() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;

  useEffect(() => {
    mounted += 1;
    if (mounted > 1) {
      return () => {
        mounted -= 1;
      };
    }
    let connectedOnce = false;
    const suffix = Math.random().toString(36).slice(2, 8);
    let channel = supabase.channel(`live-sync-${userId ?? "anon"}-${suffix}`);
    for (const table of Object.keys(TABLE_KEYS)) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        for (const queryKey of TABLE_KEYS[table]!) void queryClient.invalidateQueries({ queryKey });
      });
    }
    if (userId) {
      // RLS limits these events to rows the user may read (own orders, or all for staff).
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (payload) => {
        const row = (payload.new ?? payload.old) as { id?: string; status?: string; created_at?: string } | null;
        if (payload.eventType === "INSERT" && row?.id && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("campu:new-order-instant", { detail: payload.new }));
        }
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-siren-orders"] });
        void queryClient.invalidateQueries({ queryKey: ["admin-coins"] });
        void queryClient.invalidateQueries({ queryKey: ["coin-wallet-events"] });
        if (row?.id) void queryClient.invalidateQueries({ queryKey: ["order", row.id] });
      });
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (connectedOnce) void queryClient.invalidateQueries();
      connectedOnce = true;
    });
    return () => {
      mounted -= 1;
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);
}

/** Re-registers this device's push token on every app open for signed-in users. */
export function usePushRegistration() {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const run = async () => {
      const saved = await refreshPushTokenSilently(async (token) => {
        if (cancelled) throw new Error("Registration cancelled");
        await savePushDevice(token, pushDeviceId());
      });
      if (saved && !cancelled) {
        void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      }
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queryClient, userId]);
}

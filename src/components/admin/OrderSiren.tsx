import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Banknote, BellRing, Coins } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { coinAdminQuery } from "@/components/admin/CoinRequests";
import { deliveryBoyAdminQuery } from "@/components/delivery/DeliveryBoySiren";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  INSTANT_ORDER_EVENT,
  initAdminAlarmUnlock,
  isAdminAlarmAudioReady,
  playFullVolumeOrderAlarm,
  subscribeAdminAlarmAudioReady,
  unlockAdminAlarmAudioNow,
} from "@/lib/admin-alarm-audio";
import { showBackgroundCoinBrowserNotification, type CoinTopupRequest } from "@/lib/coins";
import type { DeliveryPayoutRequest } from "@/lib/delivery-boy";
import {
  isAutoAcceptedCoinOrder,
  ringingCoinRequestIds,
  ringingOrderIds,
  ringingPayoutIds,
  type SirenOrderLike,
} from "@/lib/order-siren";

const ACK_KEY = "campu-admin-acknowledged-orders";
const ADMIN_SIREN_PREF_KEY = "campu-admin-siren-enabled";

const adminSirenListeners = new Set<() => void>();
let adminSirenEnabledCache = true;
let adminSirenPrefLoaded = false;

function readAdminSirenEnabled(): boolean {
  if (typeof window === "undefined") return true;
  if (!adminSirenPrefLoaded) {
    adminSirenPrefLoaded = true;
    try {
      const saved = window.localStorage.getItem(ADMIN_SIREN_PREF_KEY);
      adminSirenEnabledCache = saved === null ? true : saved === "true";
    } catch {
      adminSirenEnabledCache = true;
    }
  }
  return adminSirenEnabledCache;
}

export function setAdminSirenEnabled(enabled: boolean) {
  adminSirenEnabledCache = enabled;
  adminSirenPrefLoaded = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(ADMIN_SIREN_PREF_KEY, String(enabled));
    } catch {
      /* ignore */
    }
  }
  adminSirenListeners.forEach((fn) => fn());
}

export function useAdminSirenEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      adminSirenListeners.add(cb);
      return () => {
        adminSirenListeners.delete(cb);
      };
    },
    readAdminSirenEnabled,
    () => true,
  );
}

function loadAcks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/** Keeps ringing at full volume (media audio + dual-tone siren + vibration + flashing tab title) while recent orders (including auto-accepted Campu Coins orders), coin requests, or payout requests are unacknowledged. */
export function OrderSiren({
  orders,
  fullCoinOrderIds,
  coinRequests = [],
  payoutRequests = [],
  enabled,
}: {
  orders: SirenOrderLike[];
  fullCoinOrderIds?: ReadonlySet<string>;
  coinRequests?: CoinTopupRequest[];
  payoutRequests?: DeliveryPayoutRequest[];
  enabled: boolean;
}) {
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [instantOrders, setInstantOrders] = useState<SirenOrderLike[]>([]);
  const audioReady = useSyncExternalStore(
    subscribeAdminAlarmAudioReady,
    isAdminAlarmAudioReady,
    () => false,
  );
  const baseTitle = useRef<string>("");
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setAcks(loadAcks());
    initAdminAlarmUnlock();
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Sync acknowledgements across tabs or route transitions immediately
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACK_KEY) setAcks(loadAcks());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Instant realtime order reception: ring the exact millisecond a new order row arrives
  useEffect(() => {
    const onInstantOrder = (evt: Event) => {
      const detail = (evt as CustomEvent<SirenOrderLike | undefined>).detail;
      if (!detail?.id) return;
      const incoming: SirenOrderLike = {
        id: detail.id,
        status: detail.status || "pending",
        created_at: detail.created_at || new Date().toISOString(),
        accepted_at: detail.accepted_at ?? null,
        payment_method: detail.payment_method ?? null,
        utr_number: detail.utr_number ?? null,
      };
      setInstantOrders((prev) => {
        if (prev.some((o) => o.id === incoming.id)) return prev;
        return [incoming, ...prev].slice(0, 20);
      });
      setNow(Date.now());
      if (enabled && !loadAcks().has(incoming.id)) {
        playFullVolumeOrderAlarm();
      }
    };
    window.addEventListener(INSTANT_ORDER_EVENT, onInstantOrder);
    return () => window.removeEventListener(INSTANT_ORDER_EVENT, onInstantOrder);
  }, [enabled]);

  // Merge fetched orders with any instant realtime orders not yet in the fetched list
  const mergedOrders = useMemo(() => {
    if (instantOrders.length === 0) return orders;
    const fetchedIds = new Set(orders.map((o) => o.id));
    const extras = instantOrders.filter((o) => !fetchedIds.has(o.id));
    return extras.length > 0 ? [...extras, ...orders] : orders;
  }, [orders, instantOrders]);

  const ringingOrders = useMemo(
    () => ringingOrderIds(mergedOrders, acks, now, fullCoinOrderIds),
    [mergedOrders, acks, now, fullCoinOrderIds],
  );
  const hasAutoAcceptedCoinOrder = useMemo(() => {
    if (ringingOrders.length === 0) return false;
    const ringingSet = new Set(ringingOrders);
    return mergedOrders.some(
      (o) => ringingSet.has(o.id) && isAutoAcceptedCoinOrder(o, fullCoinOrderIds),
    );
  }, [mergedOrders, ringingOrders, fullCoinOrderIds]);
  const ringingCoins = useMemo(
    () => ringingCoinRequestIds(coinRequests, acks, now),
    [coinRequests, acks, now],
  );
  const ringingPayouts = useMemo(
    () => ringingPayoutIds(payoutRequests, acks, now),
    [payoutRequests, acks, now],
  );
  const totalCount = ringingOrders.length + ringingCoins.length + ringingPayouts.length;
  const active = totalCount > 0;

  // Fire a background browser notification once per newly ringing order
  useEffect(() => {
    if (!enabled || ringingOrders.length === 0) return;
    const unseen = ringingOrders.filter((id) => !notifiedIdsRef.current.has(id));
    if (unseen.length === 0) return;
    unseen.forEach((id) => notifiedIdsRef.current.add(id));
    showBackgroundCoinBrowserNotification(
      `🔴 New Campu Order! (${unseen.length})`,
      "Tap to open Admin Orders and acknowledge the alarm.",
      "/admin?tab=orders",
    );
  }, [enabled, ringingOrders]);

  useEffect(() => {
    if (!active || !enabled) return;
    playFullVolumeOrderAlarm();
    const t = setInterval(playFullVolumeOrderAlarm, 2400);
    return () => clearInterval(t);
  }, [active, enabled]);

  useEffect(() => {
    if (!active) return;
    baseTitle.current = document.title;
    let on = false;
    const label =
      ringingPayouts.length > 0 && ringingOrders.length === 0 && ringingCoins.length === 0
        ? `💸 (${ringingPayouts.length}) PAYOUT REQUEST! - Campu`
        : ringingCoins.length > 0 && ringingOrders.length === 0 && ringingPayouts.length === 0
          ? `🪙 (${ringingCoins.length}) COIN REQUEST! - Campu`
          : ringingOrders.length > 0 && ringingCoins.length === 0 && ringingPayouts.length === 0
            ? `🔴 (${ringingOrders.length}) NEW ORDER! - Campu`
            : `🔴 (${totalCount}) NEW ALERTS! - Campu`;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? label : baseTitle.current;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle.current;
    };
  }, [active, totalCount, ringingOrders.length, ringingCoins.length, ringingPayouts.length]);

  function acknowledge() {
    unlockAdminAlarmAudioNow();
    const next = new Set(acks);
    ringingOrders.forEach((id) => next.add(id));
    ringingCoins.forEach((id) => next.add(`coin:${id}`));
    ringingPayouts.forEach((id) => next.add(`payout:${id}`));
    const kept = [...next].slice(-500);
    localStorage.setItem(ACK_KEY, JSON.stringify(kept));
    setAcks(new Set(kept));
    setInstantOrders((prev) => prev.filter((o) => !next.has(o.id)));
  }

  if (!active) return null;

  const parts: string[] = [];
  if (ringingOrders.length > 0) {
    parts.push(`${ringingOrders.length} order${ringingOrders.length > 1 ? "s" : ""}`);
  }
  if (ringingCoins.length > 0) {
    parts.push(`${ringingCoins.length} coin recharge${ringingCoins.length > 1 ? "s" : ""}`);
  }
  if (ringingPayouts.length > 0) {
    parts.push(`${ringingPayouts.length} payout request${ringingPayouts.length > 1 ? "s" : ""}`);
  }
  const headline = `${parts.join(" & ")} waiting!`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-[3.35rem] z-40 px-4 sm:top-[4.15rem]"
    >
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-wrap items-center gap-3 rounded-2xl border-2 border-destructive bg-card px-4 py-3 text-card-foreground shadow-float">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-destructive" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive" />
          {ringingPayouts.length > 0 && ringingOrders.length === 0 && ringingCoins.length === 0 ? (
            <Banknote className="h-5 w-5" />
          ) : ringingCoins.length > 0 && ringingOrders.length === 0 && ringingPayouts.length === 0 ? (
            <Coins className="h-5 w-5" />
          ) : (
            <BellRing className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-extrabold text-destructive">{headline}</p>
          <p className="text-xs text-muted-foreground">
            {hasAutoAcceptedCoinOrder && "Includes Campu Coins order (payment auto-accepted). "}
            {enabled
              ? audioReady
                ? "Full-volume alarm rings until you acknowledge."
                : "Tap anywhere to enable full-volume sound."
              : "Alerts are off."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ringingOrders.length > 0 && (
            <Link
              to="/admin"
              search={{ tab: "orders" }}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              View Orders
            </Link>
          )}
          {ringingCoins.length > 0 && (
            <Link
              to="/admin"
              search={{ tab: "coins" }}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              Review Coins
            </Link>
          )}
          {ringingPayouts.length > 0 && (
            <Link
              to="/admin"
              search={{ tab: "delivery" }}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              Review Payouts
            </Link>
          )}
          <Button
            size="sm"
            onClick={acknowledge}
            className="h-9 rounded-full bg-destructive px-4 font-bold text-destructive-foreground shadow-xs hover:opacity-90"
          >
            Acknowledge
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Mounted in AppShell for admins browsing non-/admin pages so new orders
 * (including auto-accepted Campu Coins orders) ring instantly at full volume until acknowledged.
 */
export function GlobalAdminOrderSiren() {
  const enabled = useAdminSirenEnabled();
  const orders = useQuery({
    queryKey: ["admin-siren-orders"],
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    queryFn: async (): Promise<SirenOrderLike[]> => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, status, created_at, accepted_at, payment_method, utr_number")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as SirenOrderLike[];
    },
  });
  const coinAdmin = useQuery({
    ...coinAdminQuery,
    refetchInterval: 10_000,
  });
  const deliveryAdmin = useQuery({
    ...deliveryBoyAdminQuery,
    refetchInterval: 15_000,
  });

  const fullCoinOrderIds = useMemo(() => {
    const usages = coinAdmin.data?.ledger.orderUsages ?? {};
    const ids = new Set<string>();
    for (const [orderId, usage] of Object.entries(usages)) {
      if (usage && usage.coinsUsed > 0 && usage.payableAmount === 0) {
        ids.add(orderId);
      }
    }
    return ids;
  }, [coinAdmin.data?.ledger.orderUsages]);

  return (
    <OrderSiren
      orders={orders.data ?? []}
      fullCoinOrderIds={fullCoinOrderIds}
      coinRequests={coinAdmin.data?.ledger.requests ?? []}
      payoutRequests={deliveryAdmin.data?.state.payoutRequests ?? []}
      enabled={enabled}
    />
  );
}

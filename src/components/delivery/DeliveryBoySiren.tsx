import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bike } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { PushBanner } from "@/components/PushBanner";
import { Button } from "@/components/ui/button";
import {
  playCoinNotificationSound,
  showBackgroundCoinBrowserNotification,
} from "@/lib/coins";
import {
  DELIVERY_BOY_STATE_KEY,
  computeDeliveryOtpDigest,
  emptyDeliveryBoyState,
  parseDeliveryBoyState,
  reconcileDeliveryBoyState,
  ringingDeliveryAssignmentIds,
  useDeliveryBoyState,
  type DeliveryBoyStateV1,
} from "@/lib/delivery-boy";
import { rupees } from "@/lib/format";
import { notifyOrderStatus } from "@/lib/push.functions";
import { supabase } from "@/integrations/supabase/client";

const DELIVERY_ACK_KEY = "campu-delivery-boy-acknowledged-orders";
const DELIVERY_SIREN_PREF_KEY = "campu-delivery-boy-siren-enabled";
const ADMIN_SEEN_PAYOUT_ALERTS_KEY = "campu-admin-seen-payout-alerts-v1";
const RECENT_ALERT_WINDOW_MS = 10 * 60 * 1000;

const sirenPrefListeners = new Set<() => void>();
let sirenEnabledCache = true;
let sirenPrefLoaded = false;

function readSirenEnabled(): boolean {
  if (typeof window === "undefined") return true;
  if (!sirenPrefLoaded) {
    sirenPrefLoaded = true;
    try {
      const saved = window.localStorage.getItem(DELIVERY_SIREN_PREF_KEY);
      sirenEnabledCache = saved === null ? true : saved === "true";
    } catch {
      sirenEnabledCache = true;
    }
  }
  return sirenEnabledCache;
}

export function setDeliverySirenEnabled(enabled: boolean) {
  sirenEnabledCache = enabled;
  sirenPrefLoaded = true;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DELIVERY_SIREN_PREF_KEY, String(enabled));
    } catch {
      /* ignore */
    }
  }
  sirenPrefListeners.forEach((fn) => fn());
}

export function useDeliverySirenEnabled(): boolean {
  return useSyncExternalStore(
    (cb) => {
      sirenPrefListeners.add(cb);
      return () => {
        sirenPrefListeners.delete(cb);
      };
    },
    readSirenEnabled,
    () => true,
  );
}

function loadSet(storageKey: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSet(storageKey: string, set: Set<string>) {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...set].slice(-400)));
  } catch {
    /* ignore */
  }
}

let deliveryAudioCtx: AudioContext | null = null;
function getDeliveryAudioCtx() {
  if (!deliveryAudioCtx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    deliveryAudioCtx = new Ctx();
  }
  if (deliveryAudioCtx.state === "suspended") void deliveryAudioCtx.resume();
  return deliveryAudioCtx;
}

/** Exact same ringing sound + vibration pattern as Admin's OrderSiren. */
function ringDeliverySiren() {
  try {
    const ctx = getDeliveryAudioCtx();
    [880, 1320, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.25;
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* audio unavailable */
  }
}

/**
 * Mounted once in AppShell for signed-in users.
 * Activates ONLY if the user is an active Delivery Boy:
 * - Rings with the exact same Admin siren + vibration + flashing tab title + sticky top banner
 *   whenever a verified order is assigned to this Delivery Boy.
 * - Shows in-app PushBanner + chime when Admin marks their payout Paid or Rejected.
 */
export function DeliveryBoyNotifier() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const delivery = useDeliveryBoyState();
  const sirenEnabled = useDeliverySirenEnabled();
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [audioReady, setAudioReady] = useState(false);
  const baseTitle = useRef<string>("");
  const prevPayoutStatusRef = useRef<Map<string, string>>(new Map());
  const seededPayoutRef = useRef(false);

  const boyId = delivery.boyProfile?.userId;
  const activeBoy = delivery.isActiveBoy && Boolean(boyId);

  useEffect(() => {
    setAcks(loadSet(DELIVERY_ACK_KEY));
  }, []);

  useEffect(() => {
    if (!activeBoy) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [activeBoy]);

  useEffect(() => {
    if (!activeBoy) return;
    const unlock = () => {
      try {
        getDeliveryAudioCtx();
        setAudioReady(true);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [activeBoy]);

  const ringingIds = useMemo(() => {
    if (!activeBoy || !boyId) return [];
    return ringingDeliveryAssignmentIds(delivery.assignments, boyId, acks, now);
  }, [activeBoy, boyId, delivery.assignments, acks, now]);

  const ringing = ringingIds.length > 0;

  useEffect(() => {
    if (!ringing || !sirenEnabled) return;
    ringDeliverySiren();
    const t = setInterval(ringDeliverySiren, 2500);
    return () => clearInterval(t);
  }, [ringing, sirenEnabled]);

  useEffect(() => {
    if (!ringing) return;
    baseTitle.current = document.title;
    let on = false;
    const label = `🛵 (${ringingIds.length}) NEW DELIVERY! - Campu`;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? label : baseTitle.current;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle.current;
    };
  }, [ringing, ringingIds.length]);

  // Notify Delivery Boy when Admin completes or rejects a payout request
  useEffect(() => {
    if (!activeBoy || !boyId) return;
    const storageKey = `campu-boy-payout-notified-${boyId}`;
    const notified = loadSet(storageKey);
    const prevMap = prevPayoutStatusRef.current;

    if (!seededPayoutRef.current) {
      for (const req of delivery.payoutRequests) {
        prevMap.set(req.id, req.status);
        if (
          (req.status === "paid" || req.status === "rejected") &&
          !notified.has(`${req.id}:${req.status}`) &&
          req.reviewedAt &&
          Date.now() - new Date(req.reviewedAt).getTime() <= RECENT_ALERT_WINDOW_MS
        ) {
          notified.add(`${req.id}:${req.status}`);
          saveSet(storageKey, notified);
          emitPayoutDecisionBanner(req.amount, req.method, req.status, () => {
            void navigate({ to: "/delivery" });
          });
        }
      }
      seededPayoutRef.current = true;
      return;
    }

    for (const req of delivery.payoutRequests) {
      const prevStatus = prevMap.get(req.id);
      if (
        prevStatus &&
        prevStatus !== req.status &&
        (req.status === "paid" || req.status === "rejected") &&
        !notified.has(`${req.id}:${req.status}`)
      ) {
        notified.add(`${req.id}:${req.status}`);
        saveSet(storageKey, notified);
        emitPayoutDecisionBanner(req.amount, req.method, req.status, () => {
          void navigate({ to: "/delivery" });
        });
      }
      prevMap.set(req.id, req.status);
    }
  }, [activeBoy, boyId, delivery.payoutRequests, navigate]);

  function acknowledge() {
    const next = new Set(acks);
    ringingIds.forEach((id) => next.add(`deliv:${id}`));
    saveSet(DELIVERY_ACK_KEY, next);
    setAcks(new Set(next));
  }

  if (!activeBoy || !ringing) return null;

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
          <Bike className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-extrabold text-destructive">
            {ringingIds.length} new delivery order{ringingIds.length > 1 ? "s" : ""} assigned!
          </p>
          <p className="text-xs text-muted-foreground">
            {sirenEnabled
              ? audioReady
                ? "Siren rings until you acknowledge."
                : "Tap anywhere to enable sound."
              : "Alerts are off."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {pathname !== "/delivery" && (
            <Link
              to="/delivery"
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              Open Deliveries
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

function emitPayoutDecisionBanner(
  amount: number,
  method: "UPI" | "COD",
  status: "paid" | "rejected",
  onTap: () => void,
) {
  playCoinNotificationSound();
  const title =
    status === "paid" ? `💸 Payout Completed (${rupees(amount)})` : "Payout Request Declined";
  const body =
    status === "paid"
      ? `Your ${method === "UPI" ? "UPI" : "Cash"} payout of ${rupees(amount)} has been marked paid.`
      : `Your ${rupees(amount)} payout request was declined by Admin.`;
  showBackgroundCoinBrowserNotification(title, body, "/delivery");
  toast.custom(
    (id) => (
      <PushBanner
        title={title}
        body={body}
        onClick={() => {
          toast.dismiss(id);
          onTap();
        }}
      />
    ),
    { duration: 6000, position: "top-center" },
  );
}

export type AdminDeliveryBoyData = {
  state: DeliveryBoyStateV1;
  profiles: Array<{ id: string; full_name: string | null; phone_number: string | null }>;
};

export async function loadAndSyncDeliveryBoyAdmin(
  notifyStatus?: (args: { data: { orderId: string; status: string } }) => Promise<unknown>,
): Promise<AdminDeliveryBoyData> {
  const [settingRes, sugRes, profRes, ordRes] = await Promise.all([
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", DELIVERY_BOY_STATE_KEY)
      .maybeSingle(),
    supabase
      .from("suggestions")
      .select("id, user_id, suggestion_text")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("profiles").select("id, full_name, phone_number").order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("id, status, delivery_otp")
      .in("status", ["accepted", "out_for_delivery"])
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const base = settingRes.error
    ? emptyDeliveryBoyState()
    : parseDeliveryBoyState(settingRes.data?.value);
  const { state, changed } = reconcileDeliveryBoyState(base, sugRes.data ?? []);

  if (changed) {
    await supabase
      .from("app_settings")
      .upsert(
        { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(state) },
        { onConflict: "key" },
      );
  }

  // Sync Delivery Boy's out_for_delivery & OTP-verified delivered transitions to the real orders table
  // using the signed-in Admin's permissions so students see live status updates immediately.
  const openOrders = ordRes.data ?? [];
  for (const ord of openOrders) {
    const assign = state.assignments.find((a) => a.orderId === ord.id);
    if (!assign) continue;

    if (assign.status === "out_for_delivery" && ord.status === "accepted") {
      const { error } = await supabase
        .from("orders")
        .update({ status: "out_for_delivery" })
        .eq("id", ord.id);
      if (!error && notifyStatus) {
        void notifyStatus({ data: { orderId: ord.id, status: "out_for_delivery" } }).catch(
          () => undefined,
        );
      }
    } else if (assign.status === "delivered" && ord.delivery_otp) {
      const expectedDigest = await computeDeliveryOtpDigest(ord.id, ord.delivery_otp);
      if (expectedDigest.toLowerCase() === assign.otpDigest.toLowerCase()) {
        const { error } = await supabase.rpc("deliver_order_with_otp", {
          _order_id: ord.id,
          _delivery_otp: ord.delivery_otp,
        });
        if (!error && notifyStatus) {
          void notifyStatus({ data: { orderId: ord.id, status: "delivered" } }).catch(
            () => undefined,
          );
        }
      }
    }
  }

  return {
    state,
    profiles: (profRes.data ?? []) as AdminDeliveryBoyData["profiles"],
  };
}

export const deliveryBoyAdminQuery = {
  queryKey: ["admin-delivery-boy"],
  queryFn: () => loadAndSyncDeliveryBoyAdmin(),
};

/**
 * Mounted once in AppShell for Admin users:
 * - Syncs Delivery Boy OTP deliveries & payout requests from `suggestions` into `app_settings`
 * - Updates real `orders` rows when Delivery Boy verifies OTP or marks Out for Delivery
 * - Triggers chime + `PushBanner` + OS notification whenever a Delivery Boy requests payout (UPI or Cash)
 */
export function AdminDeliveryNotifier() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifyStatus = useServerFn(notifyOrderStatus);
  const seenRef = useRef<Set<string> | null>(null);
  const initializedRef = useRef(false);

  const q = useQuery({
    queryKey: ["admin-delivery-boy"],
    queryFn: () => loadAndSyncDeliveryBoyAdmin(notifyStatus),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  useEffect(() => {
    if (seenRef.current === null) {
      seenRef.current = loadSet(ADMIN_SEEN_PAYOUT_ALERTS_KEY);
    }
    const requests = q.data?.state.payoutRequests;
    if (!requests) return;

    const pending = requests.filter((r) => r.status === "pending");
    const now = Date.now();
    const seen = seenRef.current;

    const toAlert = pending.filter((r) => {
      if (seen.has(r.id)) return false;
      const ageMs = now - new Date(r.createdAt).getTime();
      return !initializedRef.current ? ageMs <= RECENT_ALERT_WINDOW_MS : true;
    });

    for (const r of pending) seen.add(r.id);
    saveSet(ADMIN_SEEN_PAYOUT_ALERTS_KEY, seen);
    initializedRef.current = true;

    if (toAlert.length > 0) {
      playCoinNotificationSound();
      for (const req of toAlert.slice(0, 2)) {
        const title = `💸 Delivery Payout Request (${rupees(req.amount)})`;
        const body =
          req.method === "UPI"
            ? `${req.boyName} requested UPI payout to ${req.upiId} (${req.bankingName}).`
            : `${req.boyName} requested Cash handover payout (${rupees(req.amount)}).`;
        showBackgroundCoinBrowserNotification(title, body, "/admin?tab=delivery");
        toast.custom(
          (id) => (
            <PushBanner
              title={title}
              body={body}
              onClick={() => {
                toast.dismiss(id);
                void navigate({ to: "/admin", search: { tab: "delivery" } });
              }}
            />
          ),
          { duration: 6500, position: "top-center" },
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-orders"] });
    }
  }, [q.data, navigate, queryClient]);

  return null;
}

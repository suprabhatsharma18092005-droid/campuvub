import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import { settingsQuery } from "@/lib/queries";
import { useSession } from "@/lib/session";

export const COIN_VALUE_INR = 1;
export const MIN_COIN_PURCHASE = 50;
export const COIN_LEDGER_SETTING_KEY = "coin_ledger_v1";
export const COIN_NOTIFY_QUEUE_KEY = "coin_notify_queue_v1";
export const COIN_PRESETS = [50, 100, 200, 500] as const;

/** Rounds coin / rupee amounts cleanly to 2 decimal places so fractional totals (e.g. 52.5) deduct accurately. */
export function roundCoinValue(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export type CoinNotificationJob =
  | {
      id: string;
      kind: "coin_request";
      requestId: string;
      userId: string;
      customerName: string;
      coins: number;
      amount: number;
      utrNumber: string;
      status: "pending" | "delivered" | "failed";
      attempts: number;
      lastError?: string | null;
      createdAt: string;
      lastAttemptAt?: string | null;
      deliveredAt?: string | null;
    }
  | {
      id: string;
      kind: "coin_status";
      requestId: string;
      userId: string;
      coins: number;
      decision: "approved" | "rejected";
      status: "pending" | "delivered" | "failed";
      attempts: number;
      lastError?: string | null;
      createdAt: string;
      lastAttemptAt?: string | null;
      deliveredAt?: string | null;
    };

export function parseCoinNotifyQueue(raw?: string | null): CoinNotificationJob[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CoinNotificationJob[]) : [];
  } catch {
    return [];
  }
}

/** Plays the app notification chime safely (ignores browser autoplay blocks). */
export function playCoinNotificationSound(): void {
  if (typeof window === "undefined") return;
  try {
    const audio = new Audio("/notification.mp3");
    audio.volume = 0.85;
    void audio.play().catch(() => undefined);
  } catch {
    /* audio unavailable */
  }
}

/** Fires an OS/browser notification if permission is granted and the tab is hidden. */
export function showBackgroundCoinBrowserNotification(
  title: string,
  body: string,
  path: string,
): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (document.visibilityState === "visible") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const opts: NotificationOptions = {
    body,
    icon: "/icon-192x192.png",
    badge: "/badge-monochrome.png",
    tag: `campu-coin-${path}`,
    data: { path },
  };

  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.ready
      .then((reg) => reg.showNotification(title, opts))
      .catch(() => {
        try {
          new Notification(title, opts);
        } catch {
          /* ignore */
        }
      });
    return;
  }

  try {
    new Notification(title, opts);
  } catch {
    /* ignore */
  }
}

export type CoinTopupStatus = "pending" | "approved" | "rejected";

export type CoinTopupRequest = {
  id: string;
  userId: string;
  userName: string;
  phone: string | null;
  coins: number;
  amount: number;
  utrNumber: string;
  status: CoinTopupStatus;
  createdAt: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
};

export type CoinTransactionType = "topup_approved" | "order_spend" | "order_refund";

export type CoinTransaction = {
  id: string;
  userId: string;
  type: CoinTransactionType;
  coins: number;
  amountInr: number;
  note: string;
  orderId?: string | null;
  requestId?: string | null;
  utrNumber?: string | null;
  createdAt: string;
};

export type CoinOrderUsage = {
  orderId: string;
  userId: string;
  coinsUsed: number;
  orderTotal: number;
  payableAmount: number;
  paymentMethod: "UPI" | "COD" | "COINS";
  refunded: boolean;
  createdAt: string;
  refundedAt?: string | null;
};

export type CoinLedgerV1 = {
  version: 1;
  balances: Record<string, number>;
  requests: CoinTopupRequest[];
  transactions: CoinTransaction[];
  orderUsages: Record<string, CoinOrderUsage>;
  processedSuggestionIds: string[];
  updatedAt: string;
};

export type CoinSuggestionEvent =
  | { type: "coin_purchase_request"; request: CoinTopupRequest }
  | { type: "coin_order_spend"; usage: CoinOrderUsage }
  | {
      type: "coin_order_cancel_refund";
      orderId: string;
      userId: string;
      coinsRefunded: number;
      createdAt: string;
    };

export function emptyCoinLedger(): CoinLedgerV1 {
  return {
    version: 1,
    balances: {},
    requests: [],
    transactions: [],
    orderUsages: {},
    processedSuggestionIds: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function validateCoinPurchaseInput(coins: number, amount: number): string | null {
  if (!Number.isFinite(coins) || !Number.isInteger(coins) || coins <= 0) {
    return "Enter a whole number of coins.";
  }
  if (coins < MIN_COIN_PURCHASE) {
    return `Minimum purchase is ₹${MIN_COIN_PURCHASE} (${MIN_COIN_PURCHASE} coins).`;
  }
  const expectedAmount = coins * COIN_VALUE_INR;
  if (!Number.isFinite(amount) || amount !== expectedAmount) {
    return `Payment must match ${coins} coins × ₹${COIN_VALUE_INR} = ₹${expectedAmount}.`;
  }
  return null;
}

export function makeCoinReceiptUtr(): string {
  const suffix = String(Date.now() % 100_000_000).padStart(8, "0");
  const rand = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `99${rand}${suffix}`;
}

export function parseCoinLedger(raw?: string | null): CoinLedgerV1 {
  if (!raw) return emptyCoinLedger();
  try {
    const parsed = JSON.parse(raw) as Partial<CoinLedgerV1>;
    if (!parsed || typeof parsed !== "object") return emptyCoinLedger();
    return {
      version: 1,
      balances:
        parsed.balances && typeof parsed.balances === "object"
          ? Object.fromEntries(
              Object.entries(parsed.balances).map(([k, v]) => [k, roundCoinValue(Number(v) || 0)]),
            )
          : {},
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      orderUsages:
        parsed.orderUsages && typeof parsed.orderUsages === "object" ? parsed.orderUsages : {},
      processedSuggestionIds: Array.isArray(parsed.processedSuggestionIds)
        ? parsed.processedSuggestionIds
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyCoinLedger();
  }
}

export function parseCoinSuggestionRow(raw: string): CoinSuggestionEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CoinSuggestionEvent> & {
      request?: Partial<CoinTopupRequest>;
      usage?: Partial<CoinOrderUsage>;
      orderId?: string;
      userId?: string;
      coinsRefunded?: number;
      createdAt?: string;
    };
    if (!parsed || typeof parsed !== "object") return null;

    if (
      parsed.type === "coin_purchase_request" &&
      parsed.request &&
      typeof parsed.request.id === "string" &&
      typeof parsed.request.userId === "string" &&
      typeof parsed.request.utrNumber === "string" &&
      /^[0-9]{12}$/.test(parsed.request.utrNumber)
    ) {
      const coins = Math.floor(Number(parsed.request.coins));
      const amount = Math.floor(Number(parsed.request.amount));
      if (validateCoinPurchaseInput(coins, amount) !== null) return null;
      return {
        type: "coin_purchase_request",
        request: {
          id: parsed.request.id,
          userId: parsed.request.userId,
          userName: parsed.request.userName?.trim() || "Student",
          phone: parsed.request.phone ?? null,
          coins,
          amount,
          utrNumber: parsed.request.utrNumber,
          // Suggestion rows can NEVER self-approve; always normalize to pending.
          status: "pending",
          createdAt: parsed.request.createdAt ?? new Date().toISOString(),
        },
      };
    }

    if (
      parsed.type === "coin_order_spend" &&
      parsed.usage &&
      typeof parsed.usage.orderId === "string" &&
      typeof parsed.usage.userId === "string"
    ) {
      const coinsUsed = roundCoinValue(Number(parsed.usage.coinsUsed));
      if (!Number.isFinite(coinsUsed) || coinsUsed <= 0) return null;
      return {
        type: "coin_order_spend",
        usage: {
          orderId: parsed.usage.orderId,
          userId: parsed.usage.userId,
          coinsUsed,
          orderTotal: roundCoinValue(Number(parsed.usage.orderTotal) || coinsUsed),
          payableAmount: roundCoinValue(Number(parsed.usage.payableAmount) || 0),
          paymentMethod:
            parsed.usage.paymentMethod === "UPI" || parsed.usage.paymentMethod === "COD"
              ? parsed.usage.paymentMethod
              : "COINS",
          refunded: false,
          createdAt: parsed.usage.createdAt ?? new Date().toISOString(),
        },
      };
    }

    if (
      parsed.type === "coin_order_cancel_refund" &&
      typeof parsed.orderId === "string" &&
      typeof parsed.userId === "string"
    ) {
      return {
        type: "coin_order_cancel_refund",
        orderId: parsed.orderId,
        userId: parsed.userId,
        coinsRefunded: roundCoinValue(Number(parsed.coinsRefunded) || 0),
        createdAt: parsed.createdAt ?? new Date().toISOString(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function applyOrderCoinSpendToLedger(
  ledger: CoinLedgerV1,
  usage: CoinOrderUsage,
  suggestionId?: string,
): { next: CoinLedgerV1; applied: boolean } {
  if (ledger.orderUsages[usage.orderId]) {
    const processed =
      suggestionId && !ledger.processedSuggestionIds.includes(suggestionId)
        ? [...ledger.processedSuggestionIds, suggestionId]
        : ledger.processedSuggestionIds;
    return {
      next:
        processed === ledger.processedSuggestionIds
          ? ledger
          : { ...ledger, processedSuggestionIds: processed },
      applied: false,
    };
  }
  const currentBal = roundCoinValue(ledger.balances[usage.userId] ?? 0);
  const actualSpend = roundCoinValue(Math.min(currentBal, roundCoinValue(usage.coinsUsed)));
  if (actualSpend <= 0) {
    return { next: ledger, applied: false };
  }
  const nextBalances = {
    ...ledger.balances,
    [usage.userId]: roundCoinValue(currentBal - actualSpend),
  };
  const finalUsage: CoinOrderUsage = {
    ...usage,
    coinsUsed: actualSpend,
    payableAmount: roundCoinValue(Math.max(0, usage.orderTotal - actualSpend)),
    refunded: false,
  };
  const tx: CoinTransaction = {
    id: `spend:${usage.orderId}`,
    userId: usage.userId,
    type: "order_spend",
    coins: -actualSpend,
    amountInr: roundCoinValue(actualSpend * COIN_VALUE_INR),
    note: `Used on order #${usage.orderId.slice(0, 8)}`,
    orderId: usage.orderId,
    createdAt: usage.createdAt,
  };
  return {
    applied: true,
    next: {
      ...ledger,
      balances: nextBalances,
      orderUsages: { ...ledger.orderUsages, [usage.orderId]: finalUsage },
      transactions: [tx, ...ledger.transactions].slice(0, 500),
      processedSuggestionIds: suggestionId
        ? Array.from(new Set([...ledger.processedSuggestionIds, suggestionId]))
        : ledger.processedSuggestionIds,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function applyOrderCoinRefundToLedger(
  ledger: CoinLedgerV1,
  orderId: string,
  suggestionId?: string,
): { next: CoinLedgerV1; refundedCoins: number } {
  const usage = ledger.orderUsages[orderId];
  if (!usage || usage.refunded || usage.coinsUsed <= 0) {
    const processed =
      suggestionId && !ledger.processedSuggestionIds.includes(suggestionId)
        ? [...ledger.processedSuggestionIds, suggestionId]
        : ledger.processedSuggestionIds;
    return {
      next:
        processed === ledger.processedSuggestionIds
          ? ledger
          : { ...ledger, processedSuggestionIds: processed },
      refundedCoins: 0,
    };
  }
  const currentBal = roundCoinValue(ledger.balances[usage.userId] ?? 0);
  const refundCoins = roundCoinValue(usage.coinsUsed);
  const nowIso = new Date().toISOString();
  const tx: CoinTransaction = {
    id: `refund:${orderId}`,
    userId: usage.userId,
    type: "order_refund",
    coins: refundCoins,
    amountInr: roundCoinValue(refundCoins * COIN_VALUE_INR),
    note: `Refunded from cancelled order #${orderId.slice(0, 8)}`,
    orderId,
    createdAt: nowIso,
  };
  return {
    refundedCoins: refundCoins,
    next: {
      ...ledger,
      balances: {
        ...ledger.balances,
        [usage.userId]: roundCoinValue(currentBal + refundCoins),
      },
      orderUsages: {
        ...ledger.orderUsages,
        [orderId]: { ...usage, refunded: true, refundedAt: nowIso },
      },
      transactions: [tx, ...ledger.transactions].slice(0, 500),
      processedSuggestionIds: suggestionId
        ? Array.from(new Set([...ledger.processedSuggestionIds, suggestionId]))
        : ledger.processedSuggestionIds,
      updatedAt: nowIso,
    },
  };
}

/**
 * Pure deterministic merge of authoritative `app_settings["coin_ledger_v1"]` with
 * student-submitted `suggestions` coin events (requests, order spends, cancellation refunds).
 */
export function reconcileCoinLedger(
  base: CoinLedgerV1,
  suggestionRows: Array<{ id: string; user_id: string; suggestion_text: string }>,
  orderStatusesById?: Record<string, string>,
): { ledger: CoinLedgerV1; changed: boolean } {
  let next: CoinLedgerV1 = {
    ...base,
    balances: { ...base.balances },
    requests: [...base.requests],
    transactions: [...base.transactions],
    orderUsages: { ...base.orderUsages },
    processedSuggestionIds: [...base.processedSuggestionIds],
  };
  let changed = false;

  // Sort chronologically ascending so spends & requests replay cleanly in order.
  const events: Array<{ id: string; rowUserId: string; ev: CoinSuggestionEvent }> = [];
  for (const row of suggestionRows) {
    const ev = parseCoinSuggestionRow(row.suggestion_text);
    if (!ev) continue;
    events.push({ id: row.id, rowUserId: row.user_id, ev });
  }
  events.sort((a, b) => {
    const aTime =
      a.ev.type === "coin_purchase_request"
        ? a.ev.request.createdAt
        : a.ev.type === "coin_order_spend"
          ? a.ev.usage.createdAt
          : a.ev.createdAt;
    const bTime =
      b.ev.type === "coin_purchase_request"
        ? b.ev.request.createdAt
        : b.ev.type === "coin_order_spend"
          ? b.ev.usage.createdAt
          : b.ev.createdAt;
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });

  for (const item of events) {
    if (next.processedSuggestionIds.includes(item.id)) continue;

    if (item.ev.type === "coin_purchase_request") {
      const req = item.ev.request;
      if (req.userId !== item.rowUserId) continue;
      const existsById = next.requests.some((r) => r.id === req.id);
      const existsByUtr = next.requests.some(
        (r) => r.utrNumber === req.utrNumber && r.status !== "rejected",
      );
      if (!existsById && !existsByUtr) {
        next.requests = [req, ...next.requests];
        changed = true;
      }
      next.processedSuggestionIds.push(item.id);
      changed = true;
    } else if (item.ev.type === "coin_order_spend") {
      const usage = item.ev.usage;
      if (usage.userId !== item.rowUserId) continue;
      const res = applyOrderCoinSpendToLedger(next, usage, item.id);
      if (res.next !== next) {
        next = res.next;
        changed = true;
      }
    } else if (item.ev.type === "coin_order_cancel_refund") {
      if (item.ev.userId !== item.rowUserId) continue;
      const orderStatus = orderStatusesById?.[item.ev.orderId];
      // Only honor a cancellation refund if the real order row is verified cancelled.
      if (orderStatus === "cancelled") {
        const res = applyOrderCoinRefundToLedger(next, item.ev.orderId, item.id);
        if (res.next !== next) {
          next = res.next;
          changed = true;
        }
      }
    }
  }

  // Also ensure any cancelled order with unrefunded coin usage gets refunded.
  if (orderStatusesById) {
    for (const [orderId, usage] of Object.entries(next.orderUsages)) {
      if (!usage.refunded && orderStatusesById[orderId] === "cancelled") {
        const res = applyOrderCoinRefundToLedger(next, orderId);
        if (res.refundedCoins > 0) {
          next = res.next;
          changed = true;
        }
      }
    }
  }

  return { ledger: next, changed };
}

/** Hook returning signed-in student's live Coin balance, pending top-up, transactions, and order coin lookup. */
export function useCoinWallet() {
  const { session } = useSession();
  const uid = session?.user.id;
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const rawLedger = settings.data?.[COIN_LEDGER_SETTING_KEY];

  const eventsQuery = useQuery({
    queryKey: ["coin-wallet-events", uid],
    enabled: Boolean(uid),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const [sugRes, ordRes] = await Promise.all([
        supabase
          .from("suggestions")
          .select("id, user_id, suggestion_text, created_at")
          .eq("user_id", uid!)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("orders")
          .select("id, status")
          .eq("student_id", uid!)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      return {
        suggestions: sugRes.data ?? [],
        orderStatuses: Object.fromEntries(
          (ordRes.data ?? []).map((o) => [o.id, o.status]),
        ) as Record<string, string>,
      };
    },
  });

  // Realtime updates for `app_settings` and `orders` are handled once by AppShell's useLiveSync().

  const baseLedger = parseCoinLedger(rawLedger);
  const { ledger } = reconcileCoinLedger(
    baseLedger,
    eventsQuery.data?.suggestions ?? [],
    eventsQuery.data?.orderStatuses,
  );

  const balance = uid ? roundCoinValue(ledger.balances[uid] ?? 0) : 0;
  const requests = uid
    ? ledger.requests
        .filter((r) => r.userId === uid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];
  const pendingRequest = requests.find((r) => r.status === "pending") ?? null;

  useEffect(() => {
    if (!uid || !pendingRequest) return;
    const t = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void eventsQuery.refetch();
    }, 8_000);
    return () => window.clearInterval(t);
  }, [uid, pendingRequest, queryClient, eventsQuery]);
  const transactions = uid
    ? ledger.transactions
        .filter((t) => t.userId === uid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  return {
    loading: settings.isLoading || eventsQuery.isLoading,
    balance,
    balanceInr: roundCoinValue(balance * COIN_VALUE_INR),
    requests,
    pendingRequest,
    transactions,
    orderUsages: ledger.orderUsages,
    coinUsageForOrder: (orderId: string): CoinOrderUsage | null =>
      ledger.orderUsages[orderId] ?? null,
    refetch: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["app_settings"] }),
        eventsQuery.refetch(),
      ]);
    },
  };
}

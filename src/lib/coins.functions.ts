import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COIN_LEDGER_SETTING_KEY,
  COIN_VALUE_INR,
  MIN_COIN_PURCHASE,
  applyOrderCoinRefundToLedger,
  parseCoinLedger,
  reconcileCoinLedger,
  roundCoinValue,
  validateCoinPurchaseInput,
  type CoinLedgerV1,
  type CoinTopupRequest,
} from "@/lib/coins";

function hasLiveAdminDb() {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

const topupInputSchema = z.object({
  coins: z.number().int().min(MIN_COIN_PURCHASE),
  amount: z.number().int().min(MIN_COIN_PURCHASE * COIN_VALUE_INR),
  utrNumber: z.string().regex(/^[0-9]{12}$/, "Enter a valid 12-digit UTR"),
  requestId: z.string().uuid().optional(),
});

const reviewTopupSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  rejectionReason: z.string().trim().max(200).optional(),
});

async function loadAuthoritativeLedger(
  client: typeof import("@/integrations/supabase/client.server").supabaseAdmin,
): Promise<CoinLedgerV1> {
  const [settingRes, sugRes, ordRes] = await Promise.all([
    client.from("app_settings").select("value").eq("key", COIN_LEDGER_SETTING_KEY).maybeSingle(),
    client
      .from("suggestions")
      .select("id, user_id, suggestion_text")
      .order("created_at", { ascending: false })
      .limit(500),
    client.from("orders").select("id, status").order("created_at", { ascending: false }).limit(500),
  ]);

  const base = parseCoinLedger(settingRes.data?.value);
  const orderStatuses = Object.fromEntries(
    (ordRes.data ?? []).map((o) => [o.id, o.status]),
  ) as Record<string, string>;
  return reconcileCoinLedger(base, sugRes.data ?? [], orderStatuses).ledger;
}

/**
 * Validates and persists a coin purchase top-up request.
 * Enforces 1 Coin = ₹1 and ₹50 minimum purchase strictly server-side,
 * and checks UTR uniqueness across existing coin requests and VIP submissions.
 */
export const submitCoinPurchaseRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof topupInputSchema>) => topupInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const validationErr = validateCoinPurchaseInput(data.coins, data.amount);
    if (validationErr) throw new Error(validationErr);

    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : context.supabase;

    const [{ data: settingRow }, { data: profileRow }, { data: vipUtr }] = await Promise.all([
      dbClient.from("app_settings").select("value").eq("key", COIN_LEDGER_SETTING_KEY).maybeSingle(),
      context.supabase
        .from("profiles")
        .select("full_name, phone_number")
        .eq("id", context.userId)
        .maybeSingle(),
      dbClient
        .from("vip_subscriptions")
        .select("id")
        .eq("utr_number", data.utrNumber)
        .neq("status", "rejected")
        .maybeSingle(),
    ]);

    if (vipUtr) {
      throw new Error("This UTR has already been used.");
    }

    const current = parseCoinLedger(settingRow?.value);
    const { data: sugRows } = await context.supabase
      .from("suggestions")
      .select("id, user_id, suggestion_text")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    const merged = reconcileCoinLedger(current, sugRows ?? []).ledger;

    if (merged.requests.some((r) => r.utrNumber === data.utrNumber && r.status !== "rejected")) {
      throw new Error("This UTR has already been used.");
    }
    if (merged.requests.some((r) => r.userId === context.userId && r.status === "pending")) {
      throw new Error("You already have a pending coin purchase waiting for verification.");
    }

    const request: CoinTopupRequest = {
      id: data.requestId ?? crypto.randomUUID(),
      userId: context.userId,
      userName: profileRow?.full_name?.trim() || "Student",
      phone: profileRow?.phone_number ?? null,
      coins: data.coins,
      amount: data.amount,
      utrNumber: data.utrNumber,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    let persistedRemotely = false;
    if (hasLiveAdminDb()) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const fresh = await loadAuthoritativeLedger(supabaseAdmin);
      const nextLedger: CoinLedgerV1 = {
        ...fresh,
        requests: [request, ...fresh.requests],
        updatedAt: new Date().toISOString(),
      };
      const { error } = await supabaseAdmin
        .from("app_settings")
        .upsert(
          { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(nextLedger) },
          { onConflict: "key" },
        );
      persistedRemotely = !error;
    }

    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { enqueueCoinNotification } = await import("./coin-notify-queue.server");
      const authHeader = getRequest()?.headers.get("authorization") ?? null;
      enqueueCoinNotification({
        kind: "coin_request",
        requestId: request.id,
        userId: context.userId,
        customerName: request.userName,
        coins: request.coins,
        amount: request.amount,
        utrNumber: request.utrNumber,
        authHeader,
      });
    } catch {
      // Never block request submission on notification queueing
    }

    return { ok: true, persistedRemotely, request };
  });

const notifyCoinQueueInputSchema = z.object({
  requestId: z.string().min(1),
  coins: z.number().int().min(MIN_COIN_PURCHASE),
  amount: z.number().int().min(MIN_COIN_PURCHASE * COIN_VALUE_INR),
  utrNumber: z.string().regex(/^[0-9]{12}$/),
  customerName: z.string().trim().max(80).optional(),
});

/**
 * Fire-and-forget queued notification processor called AFTER payment submit completes.
 * Runs enqueue + background queue flush safely without risking or delaying checkout.
 */
export const queueCoinPurchaseNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof notifyCoinQueueInputSchema>) =>
    notifyCoinQueueInputSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const validationErr = validateCoinPurchaseInput(data.coins, data.amount);
    if (validationErr) return { queued: false, processed: 0, delivered: 0 };
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { enqueueCoinNotification, flushCoinNotificationQueue } = await import(
        "./coin-notify-queue.server"
      );
      const authHeader = getRequest()?.headers.get("authorization") ?? null;
      enqueueCoinNotification({
        kind: "coin_request",
        requestId: data.requestId,
        userId: context.userId,
        customerName: data.customerName?.trim() || "Student",
        coins: data.coins,
        amount: data.amount,
        utrNumber: data.utrNumber,
        authHeader,
      });
      const res = await flushCoinNotificationQueue();
      return { queued: true, ...res };
    } catch {
      return { queued: false, processed: 0, delivered: 0 };
    }
  });

/**
 * Admin-only approval/rejection for pending coin purchase requests.
 * Re-verifies 1 Coin = ₹1 parity and minimum ₹50 before crediting coins.
 */
export const reviewCoinPurchaseRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof reviewTopupSchema>) => reviewTopupSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Forbidden");

    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as typeof import("@/integrations/supabase/client.server").supabaseAdmin);

    const ledger = await loadAuthoritativeLedger(dbClient);
    const target = ledger.requests.find((r) => r.id === data.requestId);
    if (!target) throw new Error("Coin request not found.");
    if (target.status !== "pending") {
      throw new Error(`This request was already ${target.status}.`);
    }

    const validationErr = validateCoinPurchaseInput(target.coins, target.amount);
    if (data.decision === "approved" && validationErr) {
      throw new Error(validationErr);
    }

    const nowIso = new Date().toISOString();
    const nextRequests = ledger.requests.map((r) =>
      r.id === target.id
        ? {
            ...r,
            status: data.decision,
            reviewedAt: nowIso,
            ...(data.rejectionReason ? { rejectionReason: data.rejectionReason } : {}),
          }
        : r,
    );

    const nextBalances = { ...ledger.balances };
    const nextTransactions = [...ledger.transactions];

    if (data.decision === "approved") {
      const prevBal = roundCoinValue(nextBalances[target.userId] ?? 0);
      nextBalances[target.userId] = roundCoinValue(prevBal + target.coins);
      nextTransactions.unshift({
        id: `topup:${target.id}`,
        userId: target.userId,
        type: "topup_approved",
        coins: target.coins,
        amountInr: target.amount,
        note: `Purchased ${target.coins} coins (UTR ${target.utrNumber})`,
        requestId: target.id,
        utrNumber: target.utrNumber,
        createdAt: nowIso,
      });
    }

    const nextLedger: CoinLedgerV1 = {
      ...ledger,
      balances: nextBalances,
      requests: nextRequests,
      transactions: nextTransactions.slice(0, 500),
      updatedAt: nowIso,
    };

    const { error: saveErr } = await context.supabase
      .from("app_settings")
      .upsert(
        { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(nextLedger) },
        { onConflict: "key" },
      );
    if (saveErr) throw new Error(saveErr.message);

    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { enqueueCoinNotification } = await import("./coin-notify-queue.server");
      const authHeader = getRequest()?.headers.get("authorization") ?? null;
      enqueueCoinNotification({
        kind: "coin_status",
        requestId: target.id,
        userId: target.userId,
        coins: target.coins,
        decision: data.decision,
        authHeader,
        adminVerified: true,
      });
    } catch {
      // Never undo approval on push queue error
    }

    return { ok: true, status: data.decision, balance: nextBalances[target.userId] ?? 0 };
  });

const notifyCoinDecisionSchema = z.object({
  requestId: z.string().min(1),
  userId: z.string().uuid(),
  coins: z.number().int().min(MIN_COIN_PURCHASE),
  decision: z.enum(["approved", "rejected"]),
});

/** Admin fallback queued notification dispatch for student approval/rejection updates. */
export const notifyCoinStatusDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof notifyCoinDecisionSchema>) =>
    notifyCoinDecisionSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) throw new Error("Forbidden");
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const { enqueueCoinNotification, flushCoinNotificationQueue } = await import(
        "./coin-notify-queue.server"
      );
      const authHeader = getRequest()?.headers.get("authorization") ?? null;
      enqueueCoinNotification({
        kind: "coin_status",
        requestId: data.requestId,
        userId: data.userId,
        coins: data.coins,
        decision: data.decision,
        authHeader,
        adminVerified: true,
      });
      return await flushCoinNotificationQueue({
        persistClient: hasLiveAdminDb()
          ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
          : (context.supabase as unknown as typeof import("@/integrations/supabase/client.server").supabaseAdmin),
      });
    } catch {
      return { processed: 0, delivered: 0 };
    }
  });

/** Admin queue flusher: retries any pending coin notifications persisted in app_settings. */
export const flushAdminCoinNotificationQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr || !isAdmin) return { processed: 0, delivered: 0 };
    try {
      const { flushCoinNotificationQueue } = await import("./coin-notify-queue.server");
      return await flushCoinNotificationQueue({
        persistClient: hasLiveAdminDb()
          ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
          : (context.supabase as unknown as typeof import("@/integrations/supabase/client.server").supabaseAdmin),
      });
    } catch {
      return { processed: 0, delivered: 0 };
    }
  });

/**
 * Refunds coins spent on an order if it was cancelled (idempotent).
 */
export async function refundOrderCoinsIfApplicable(
  orderId: string,
  supabaseClient: typeof import("@/integrations/supabase/client.server").supabaseAdmin,
): Promise<number> {
  try {
    const ledger = await loadAuthoritativeLedger(supabaseClient);
    const { next, refundedCoins } = applyOrderCoinRefundToLedger(ledger, orderId);
    if (refundedCoins <= 0) return 0;
    await supabaseClient
      .from("app_settings")
      .upsert(
        { key: COIN_LEDGER_SETTING_KEY, value: JSON.stringify(next) },
        { onConflict: "key" },
      );
    return refundedCoins;
  } catch {
    return 0;
  }
}

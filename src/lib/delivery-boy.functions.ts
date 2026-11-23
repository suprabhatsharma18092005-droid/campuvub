import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { COIN_LEDGER_SETTING_KEY, parseCoinLedger } from "@/lib/coins";
import {
  DELIVERY_BOY_STATE_KEY,
  applyDeliveredOtpToState,
  applyPayoutDecisionToState,
  buildAssignmentSnapshot,
  computeDeliveryOtpDigest,
  parseDeliveryBoyState,
  reconcileDeliveryBoyState,
  roundMoney,
  validatePayoutRequestInput,
  type DeliveryBoyStateV1,
  type DeliveryPayoutRequest,
} from "@/lib/delivery-boy";

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

function hasLiveAdminDb() {
  return Boolean(process.env["SUPABASE_URL"] && process.env["SUPABASE_SERVICE_ROLE_KEY"]);
}

async function isAdmin(context: AuthContext): Promise<boolean> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  return !error && Boolean(data);
}

async function assertAdmin(context: AuthContext) {
  if (!(await isAdmin(context))) throw new Error("Forbidden");
}

async function loadReconciledState(
  dbClient: SupabaseClient<Database>,
): Promise<DeliveryBoyStateV1> {
  const [{ data: settingRow }, { data: sugRows }] = await Promise.all([
    dbClient.from("app_settings").select("value").eq("key", DELIVERY_BOY_STATE_KEY).maybeSingle(),
    dbClient
      .from("suggestions")
      .select("id, user_id, suggestion_text")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  const base = parseDeliveryBoyState(settingRow?.value);
  return reconcileDeliveryBoyState(base, sugRows ?? []).state;
}

const assignOrderSchema = z.object({
  orderId: z.string().uuid(),
  boyId: z.string().uuid(),
});

/**
 * Admin-only: Assigns a payment-verified/accepted order to an active Delivery Boy,
 * snapshots sanitized order details (hiding plaintext OTP & respecting UPI/COD rules),
 * and dispatches FCM push + Telegram notification to the Delivery Boy.
 */
export const assignOrderDeliveryBoy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof assignOrderSchema>) => assignOrderSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as SupabaseClient<Database>);

    const [{ data: order, error: orderErr }, { data: coinRow }, currentState] = await Promise.all([
      context.supabase
        .from("orders")
        .select(
          "id, student_id, cart_items, total, delivery_fee, payment_method, status, delivery_address, phone_number, delivery_otp, delivery_type, delivery_date",
        )
        .eq("id", data.orderId)
        .maybeSingle(),
      dbClient.from("app_settings").select("value").eq("key", COIN_LEDGER_SETTING_KEY).maybeSingle(),
      loadReconciledState(dbClient),
    ]);

    if (orderErr || !order) throw new Error("Order not found.");
    const coinLedger = parseCoinLedger(coinRow?.value);
    const coinUsage = coinLedger.orderUsages[order.id] ?? null;
    const isFullCoinOrder = Boolean(
      coinUsage && coinUsage.coinsUsed > 0 && coinUsage.payableAmount === 0,
    );

    if (order.status === "payment_review" && isFullCoinOrder) {
      await context.supabase
        .from("orders")
        .update({ status: "accepted", accepted_at: new Date().toISOString() })
        .eq("id", order.id);
    } else if (order.status === "payment_review" || order.status === "pending") {
      throw new Error("Verify and accept the order payment first before assigning a Delivery Boy.");
    }
    if (order.status === "delivered" || order.status === "cancelled") {
      throw new Error("Cannot assign a delivered or cancelled order.");
    }

    const boy = currentState.boys.find((b) => b.userId === data.boyId && b.active);
    if (!boy) {
      throw new Error("Selected Delivery Boy is not active.");
    }

    const { data: studentProfile } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", order.student_id)
      .maybeSingle();

    const otpDigest = await computeDeliveryOtpDigest(order.id, order.delivery_otp ?? "");
    const existing = currentState.assignments.find((a) => a.orderId === order.id);

    const assignment = buildAssignmentSnapshot({
      order,
      boy,
      customerName: studentProfile?.full_name?.trim() || "Student",
      otpDigest,
      salaryRule: currentState.salaryRule,
      coinUsage,
      existingId: existing?.id,
    });

    // Preserve out_for_delivery state if reassigning mid-flight
    if (existing?.status === "out_for_delivery" && order.status === "out_for_delivery") {
      assignment.status = "out_for_delivery";
      assignment.outForDeliveryAt = existing.outForDeliveryAt ?? new Date().toISOString();
    }

    const nextAssignments = [
      assignment,
      ...currentState.assignments.filter((a) => a.orderId !== order.id),
    ].slice(0, 200);

    const nextState: DeliveryBoyStateV1 = {
      ...currentState,
      assignments: nextAssignments,
      updatedAt: new Date().toISOString(),
    };

    const { error: saveErr } = await context.supabase
      .from("app_settings")
      .upsert(
        { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(nextState) },
        { onConflict: "key" },
      );
    if (saveErr) throw new Error(saveErr.message);

    let telegramSent = false;
    let telegramReason: string | undefined;
    let pushSent = 0;

    try {
      const { dispatchPushEvent, canSendLocally } = await import("./push-events.server");
      const { hasTelegramCredentials, sendTelegramDeliveryBoyAlert } = await import("./telegram.server");

      const pushPayload = {
        type: "delivery_assigned" as const,
        boyUserId: boy.userId,
        orderId: assignment.orderId,
        deliveryAddress: assignment.deliveryAddress,
        paymentMethod: assignment.paymentMethod,
        paidWithCoins: assignment.paidWithCoins,
        codCollectAmount: assignment.codCollectAmount,
      };

      if (canSendLocally()) {
        // runPushEvent handles both FCM push and Telegram alert in one shot
        const pushRes = await dispatchPushEvent(pushPayload, context);
        pushSent = pushRes.sent;
        if (pushRes.error) {
          telegramSent = false;
          telegramReason = pushRes.error;
        } else {
          telegramSent = Boolean(hasTelegramCredentials());
        }
      } else if (hasTelegramCredentials()) {
        // Local host has Telegram bot creds without FCM keys: send Telegram directly & forward FCM push
        const [pushRes, tgRes] = await Promise.all([
          dispatchPushEvent(pushPayload, context),
          sendTelegramDeliveryBoyAlert({
            boyName: boy.name,
            boyChatId: boy.telegramChatId,
            orderId: assignment.orderId,
            customerName: assignment.customerName,
            deliveryAddress: assignment.deliveryAddress,
            phoneNumber: assignment.phoneNumber,
            items: assignment.items,
            paymentMethod: assignment.paymentMethod,
            paidWithCoins: assignment.paidWithCoins,
            codCollectAmount: assignment.codCollectAmount,
          }),
        ]);
        pushSent = pushRes.sent;
        telegramSent = tgRes.ok;
        telegramReason = tgRes.error;
      } else {
        // Neither FCM nor Telegram keys locally: forward event to trusted Lovable host for both
        const pushRes = await dispatchPushEvent(pushPayload, context);
        pushSent = pushRes.sent;
        if (pushRes.error) {
          telegramSent = false;
          telegramReason = pushRes.error;
        } else {
          telegramSent = Boolean(boy.telegramChatId);
        }
      }
    } catch (err) {
      telegramSent = false;
      telegramReason = err instanceof Error ? err.message : "Notification dispatch failed";
    }

    return {
      ok: true,
      assignment,
      pushSent,
      telegramSent,
      ...(telegramReason ? { telegramReason } : {}),
    };
  });

const advanceStatusSchema = z.object({
  orderId: z.string().uuid(),
  status: z.literal("out_for_delivery"),
});

/** Assigned Delivery Boy (or Admin) marks an assigned order as Out for Delivery. */
export const advanceDeliveryBoyOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof advanceStatusSchema>) => advanceStatusSchema.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context);
    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as SupabaseClient<Database>);

    const state = await loadReconciledState(dbClient);
    const target = state.assignments.find((a) => a.orderId === data.orderId);
    if (!target) throw new Error("Delivery assignment not found.");
    if (!admin && target.boyId !== context.userId) throw new Error("Forbidden");
    if (target.status === "delivered" || target.status === "cancelled") {
      throw new Error("Order is already closed.");
    }

    const nowIso = new Date().toISOString();
    let persistedRemotely = false;

    if (hasLiveAdminDb() || admin) {
      const nextState: DeliveryBoyStateV1 = {
        ...state,
        assignments: state.assignments.map((a) =>
          a.orderId === data.orderId
            ? { ...a, status: "out_for_delivery", outForDeliveryAt: a.outForDeliveryAt ?? nowIso }
            : a,
        ),
        updatedAt: nowIso,
      };
      const { error: saveErr } = await dbClient
        .from("app_settings")
        .upsert(
          { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(nextState) },
          { onConflict: "key" },
        );
      if (!saveErr) persistedRemotely = true;

      if (hasLiveAdminDb()) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ord } = await supabaseAdmin
          .from("orders")
          .select("id, student_id, status")
          .eq("id", data.orderId)
          .maybeSingle();
        if (ord && ord.status === "accepted") {
          await supabaseAdmin
            .from("orders")
            .update({ status: "out_for_delivery" })
            .eq("id", data.orderId);
          const { sendStatusAlert } = await import("./push-delivery.server");
          await sendStatusAlert({
            id: ord.id,
            student_id: ord.student_id,
            status: "out_for_delivery",
          }).catch(() => undefined);
        }
      }
    }

    return { ok: true, persistedRemotely, updatedAt: nowIso };
  });

const verifyOtpSchema = z.object({
  orderId: z.string().uuid(),
  otp: z.string().regex(/^\d{4}$/, "Enter the 4-digit delivery OTP"),
});

/**
 * Verifies the customer's 4-digit Delivery OTP for the assigned Delivery Boy,
 * marks delivery complete, and credits the configured delivery salary (default: delivery_fee - ₹1).
 */
export const verifyDeliveryBoyOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof verifyOtpSchema>) => verifyOtpSchema.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await isAdmin(context);
    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as SupabaseClient<Database>);

    const state = await loadReconciledState(dbClient);
    const target = state.assignments.find((a) => a.orderId === data.orderId);
    if (!target) throw new Error("Delivery assignment not found.");
    if (!admin && target.boyId !== context.userId) throw new Error("Forbidden");
    if (target.status === "delivered") {
      return {
        ok: true,
        alreadyDelivered: true,
        creditedAmount: 0,
        otpDigest: target.otpDigest,
        deliveredAt: target.deliveredAt ?? new Date().toISOString(),
      };
    }

    const typedDigest = await computeDeliveryOtpDigest(data.orderId, data.otp);

    if (hasLiveAdminDb()) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: realOrder } = await supabaseAdmin
        .from("orders")
        .select("id, delivery_otp, status")
        .eq("id", data.orderId)
        .maybeSingle();
      if (!realOrder) throw new Error("Order not found.");
      if (realOrder.status === "cancelled") throw new Error("This order was cancelled.");
      if (!realOrder.delivery_otp || realOrder.delivery_otp.trim() !== data.otp.trim()) {
        throw new Error("Incorrect delivery code. Ask the customer to check again.");
      }
    } else if (!target.otpDigest || typedDigest.toLowerCase() !== target.otpDigest.toLowerCase()) {
      throw new Error("Incorrect delivery code. Ask the customer to check again.");
    }

    const deliveredAt = new Date().toISOString();
    const { next, creditedAmount } = applyDeliveredOtpToState(state, data.orderId, deliveredAt);

    let persistedRemotely = false;
    if (admin) {
      const { error: rpcErr } = await context.supabase.rpc("deliver_order_with_otp", {
        _order_id: data.orderId,
        _delivery_otp: data.otp.trim(),
      });
      if (rpcErr && !rpcErr.message.includes("already closed")) {
        throw new Error(rpcErr.message);
      }
      try {
        const { dispatchPushEvent } = await import("./push-events.server");
        await dispatchPushEvent({ type: "order_status", orderId: data.orderId }, context);
      } catch {
        // Non-fatal
      }
    }

    if (hasLiveAdminDb() || admin) {
      const { error: saveErr } = await dbClient
        .from("app_settings")
        .upsert(
          { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(next) },
          { onConflict: "key" },
        );
      persistedRemotely = !saveErr;
    }

    return {
      ok: true,
      persistedRemotely,
      creditedAmount,
      otpDigest: typedDigest,
      deliveredAt,
    };
  });

const payoutRequestSchema = z.object({
  requestId: z.string().min(1),
  amount: z.number().positive(),
  method: z.enum(["UPI", "COD"]),
  upiId: z.string().trim().max(120).nullable().optional(),
  bankingName: z.string().trim().max(120).nullable().optional(),
});

/**
 * Delivery Boy submits a Payout Request (UPI with UPI ID + Banking Name, OR Cash on Delivery directly).
 * Sends FCM Push + Telegram alert to Admin immediately.
 */
export const submitDeliveryPayoutRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof payoutRequestSchema>) => payoutRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as SupabaseClient<Database>);

    const state = await loadReconciledState(dbClient);
    const boy = state.boys.find((b) => b.userId === context.userId && b.active);
    if (!boy) throw new Error("Only active Delivery Boys can request payouts.");

    const walletBalance = roundMoney(state.wallets[context.userId] ?? 0);
    const pendingTotal = roundMoney(
      state.payoutRequests
        .filter((r) => r.boyId === context.userId && r.status === "pending")
        .reduce((s, r) => s + roundMoney(r.amount), 0),
    );
    const withdrawable = roundMoney(Math.max(0, walletBalance - pendingTotal));

    const validationErr = validatePayoutRequestInput({
      method: data.method,
      amount: data.amount,
      withdrawableBalance: withdrawable,
      upiId: data.upiId,
      bankingName: data.bankingName,
    });
    if (validationErr) throw new Error(validationErr);

    const request: DeliveryPayoutRequest = {
      id: data.requestId,
      boyId: boy.userId,
      boyName: boy.name,
      phone: boy.phone,
      amount: roundMoney(data.amount),
      method: data.method,
      upiId: data.method === "UPI" ? (data.upiId ?? "").trim() : null,
      bankingName: data.method === "UPI" ? (data.bankingName ?? "").trim() : null,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    let persistedRemotely = false;
    if (hasLiveAdminDb()) {
      const nextState: DeliveryBoyStateV1 = {
        ...state,
        payoutRequests: [request, ...state.payoutRequests].slice(0, 200),
        updatedAt: new Date().toISOString(),
      };
      const { error } = await dbClient
        .from("app_settings")
        .upsert(
          { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(nextState) },
          { onConflict: "key" },
        );
      persistedRemotely = !error;
    }

    try {
      const { dispatchPushEvent, canSendLocally } = await import("./push-events.server");
      const { hasTelegramCredentials, sendTelegramPayoutAlert } = await import("./telegram.server");
      const event = {
        type: "delivery_payout_request" as const,
        boyName: request.boyName,
        amount: request.amount,
        method: request.method,
        upiId: request.upiId,
        bankingName: request.bankingName,
      };
      if (!canSendLocally() && hasTelegramCredentials()) {
        await Promise.all([
          dispatchPushEvent(event, context),
          sendTelegramPayoutAlert({
            boyName: request.boyName,
            phone: request.phone,
            amount: request.amount,
            method: request.method,
            upiId: request.upiId,
            bankingName: request.bankingName,
          }),
        ]);
      } else {
        await dispatchPushEvent(event, context);
      }
    } catch {
      // Never block payout creation on external push/Telegram failure
    }

    return { ok: true, persistedRemotely, request };
  });

const reviewPayoutSchema = z.object({
  requestId: z.string().min(1),
  decision: z.enum(["paid", "rejected"]),
  rejectionReason: z.string().trim().max(200).optional(),
});

/** Admin-only: Approves/marks payout paid or rejects it, updating wallet & notifying the Delivery Boy. */
export const reviewDeliveryPayoutRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof reviewPayoutSchema>) => reviewPayoutSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const dbClient = hasLiveAdminDb()
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : (context.supabase as unknown as SupabaseClient<Database>);

    const state = await loadReconciledState(dbClient);
    const { next, updatedRequest } = applyPayoutDecisionToState(
      state,
      data.requestId,
      data.decision,
      new Date().toISOString(),
      data.rejectionReason,
    );

    const { error } = await context.supabase
      .from("app_settings")
      .upsert(
        { key: DELIVERY_BOY_STATE_KEY, value: JSON.stringify(next) },
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);

    try {
      const { dispatchPushEvent } = await import("./push-events.server");
      await dispatchPushEvent(
        {
          type: "delivery_payout_status",
          boyUserId: updatedRequest.boyId,
          amount: updatedRequest.amount,
          status: data.decision,
          method: updatedRequest.method,
        },
        context,
      );
    } catch {
      // Non-fatal
    }

    return { ok: true, request: updatedRequest };
  });

const lookupEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

/** Admin-only: Looks up a registered user's ID by email when service-role auth admin access is configured. */
export const lookupProfileByEmailForDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof lookupEmailSchema>) => lookupEmailSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (!hasLiveAdminDb()) {
      return {
        found: false as const,
        reason: "unavailable" as const,
        message: "Select the user from the registered users list or paste their User ID.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const targetEmail = data.email.trim().toLowerCase();
    for (let page = 1; page <= 5; page += 1) {
      const { data: res, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error || !res?.users?.length) break;
      const match = res.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (match) {
        const metaName =
          (match.user_metadata?.["full_name"] as string | undefined) ||
          (match.user_metadata?.["name"] as string | undefined) ||
          null;
        return {
          found: true as const,
          userId: match.id,
          email: match.email ?? targetEmail,
          fullName: metaName,
        };
      }
      if (res.users.length < 200) break;
    }
    return {
      found: false as const,
      reason: "not_found" as const,
      message: "No account found with that email.",
    };
  });

const testTelegramSchema = z.object({
  chatId: z.string().trim().min(1, "Enter a Telegram Chat ID first").max(120),
  boyName: z.string().trim().max(80).optional(),
});

/** Admin-only: Sends a test Telegram alert to a Delivery Boy's Chat ID (local or trusted host). */
export const testDeliveryBoyTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof testTelegramSchema>) => testTelegramSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { hasTelegramCredentials, sendTelegramTestAlert } = await import("./telegram.server");
    const { dispatchPushEvent } = await import("./push-events.server");

    if (hasTelegramCredentials()) {
      return sendTelegramTestAlert(data.chatId, data.boyName ?? null);
    }

    const res = await dispatchPushEvent(
      {
        type: "telegram_test",
        chatId: data.chatId,
        ...(data.boyName ? { boyName: data.boyName } : {}),
      },
      context,
    );
    return {
      ok: res.sent > 0,
      chatId: data.chatId,
      ...(res.error ? { error: res.error } : {}),
    };
  });


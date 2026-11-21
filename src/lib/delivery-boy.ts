import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { CoinOrderUsage } from "@/lib/coins";
import { settingsQuery } from "@/lib/queries";
import { useSession } from "@/lib/session";

export const DELIVERY_BOY_STATE_KEY = "delivery_boy_state_v1";
export const DEFAULT_FEE_DEDUCTION = 1;
export const SIREN_WINDOW_MS = 2 * 60 * 60 * 1000;

export function roundMoney(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export async function computeDeliveryOtpDigest(orderId: string, otp: string): Promise<string> {
  const input = `campu-delivery-otp:v1:${orderId}:${otp.trim()}`;
  const bytes = new TextEncoder().encode(input);
  const hashBuf = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type DeliverySalaryRule = {
  /**
   * "deduct_from_fee" (default): Boy earns max(0, order_delivery_fee - deductionAmount). Default deduction = ₹1.
   * "fixed_per_delivery": Boy earns fixedAmount per OTP-verified delivery.
   */
  mode: "deduct_from_fee" | "fixed_per_delivery";
  deductionAmount: number;
  fixedAmount: number;
};

export function defaultSalaryRule(): DeliverySalaryRule {
  return {
    mode: "deduct_from_fee",
    deductionAmount: DEFAULT_FEE_DEDUCTION,
    fixedAmount: 0,
  };
}

export function calculateDeliveryBoyEarning(
  orderDeliveryFee: number,
  rule: DeliverySalaryRule = defaultSalaryRule(),
): number {
  if (rule.mode === "fixed_per_delivery") {
    return roundMoney(Math.max(0, Number(rule.fixedAmount) || 0));
  }
  const fee = Math.max(0, Number(orderDeliveryFee) || 0);
  const deduction = Math.max(0, Number(rule.deductionAmount ?? DEFAULT_FEE_DEDUCTION));
  return roundMoney(Math.max(0, fee - deduction));
}

export type DeliveryBoyProfile = {
  userId: string;
  name: string;
  phone: string | null;
  telegramChatId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryAssignmentItem = {
  id?: string;
  name: string;
  qty: number;
  price: number;
  image_url?: string | null;
};

export type DeliveryAssignmentStatus = "assigned" | "out_for_delivery" | "delivered" | "cancelled";

export type DeliveryAssignment = {
  id: string;
  orderId: string;
  boyId: string;
  boyName: string;
  customerName: string;
  phoneNumber: string | null;
  deliveryAddress: string;
  deliveryType: "quick" | "sunday_tuesday";
  deliveryDate: string | null;
  items: DeliveryAssignmentItem[];
  paymentMethod: "UPI" | "COD";
  paidWithCoins: boolean;
  /** Only populated/shown for COD orders with cash due; null for UPI / 100% coin orders. */
  codCollectAmount: number | null;
  /** Delivery charge paid by customer (used for admin/salary accounting; hidden from COD card display). */
  deliveryFee: number;
  /** Pre-computed or credited earning for this delivery. */
  earningAmount: number;
  /** One-way SHA-256 digest of `campu-delivery-otp:v1:${orderId}:${otp}` (plaintext OTP is never stored here). */
  otpDigest: string;
  status: DeliveryAssignmentStatus;
  assignedAt: string;
  outForDeliveryAt?: string | null;
  deliveredAt?: string | null;
  earningCredited: boolean;
};

export type DeliveryPayoutMethod = "UPI" | "COD";
export type DeliveryPayoutStatus = "pending" | "paid" | "rejected";

export type DeliveryPayoutRequest = {
  id: string;
  boyId: string;
  boyName: string;
  phone: string | null;
  amount: number;
  method: DeliveryPayoutMethod;
  upiId?: string | null;
  bankingName?: string | null;
  status: DeliveryPayoutStatus;
  createdAt: string;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
};

export type DeliveryBoyTransaction = {
  id: string;
  boyId: string;
  type: "delivery_earning" | "payout_paid";
  amount: number;
  note: string;
  orderId?: string | null;
  payoutId?: string | null;
  createdAt: string;
};

export type DeliveryBoyStateV1 = {
  version: 1;
  salaryRule: DeliverySalaryRule;
  boys: DeliveryBoyProfile[];
  assignments: DeliveryAssignment[];
  wallets: Record<string, number>;
  totalEarned: Record<string, number>;
  totalPaidOut: Record<string, number>;
  payoutRequests: DeliveryPayoutRequest[];
  transactions: DeliveryBoyTransaction[];
  processedSuggestionIds: string[];
  updatedAt: string;
};

export type DeliveryBoySuggestionEvent =
  | {
      type: "delivery_boy_status";
      orderId: string;
      boyId: string;
      status: "out_for_delivery";
      updatedAt: string;
    }
  | {
      type: "delivery_boy_delivered";
      orderId: string;
      boyId: string;
      otpDigest: string;
      deliveredAt: string;
    }
  | {
      type: "delivery_boy_payout_request";
      request: DeliveryPayoutRequest;
    };

export function emptyDeliveryBoyState(): DeliveryBoyStateV1 {
  return {
    version: 1,
    salaryRule: defaultSalaryRule(),
    boys: [],
    assignments: [],
    wallets: {},
    totalEarned: {},
    totalPaidOut: {},
    payoutRequests: [],
    transactions: [],
    processedSuggestionIds: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseDeliveryBoyState(raw?: string | null): DeliveryBoyStateV1 {
  if (!raw) return emptyDeliveryBoyState();
  try {
    const parsed = JSON.parse(raw) as Partial<DeliveryBoyStateV1>;
    if (!parsed || typeof parsed !== "object") return emptyDeliveryBoyState();
    const rule = parsed.salaryRule;
    const salaryRule: DeliverySalaryRule =
      rule && typeof rule === "object"
        ? {
            mode: rule.mode === "fixed_per_delivery" ? "fixed_per_delivery" : "deduct_from_fee",
            deductionAmount: Math.max(0, roundMoney(Number(rule.deductionAmount ?? DEFAULT_FEE_DEDUCTION))),
            fixedAmount: Math.max(0, roundMoney(Number(rule.fixedAmount ?? 0))),
          }
        : defaultSalaryRule();
    const normMap = (obj: unknown): Record<string, number> =>
      obj && typeof obj === "object"
        ? Object.fromEntries(
            Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, roundMoney(Number(v) || 0)]),
          )
        : {};
    return {
      version: 1,
      salaryRule,
      boys: Array.isArray(parsed.boys) ? parsed.boys : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
      wallets: normMap(parsed.wallets),
      totalEarned: normMap(parsed.totalEarned),
      totalPaidOut: normMap(parsed.totalPaidOut),
      payoutRequests: Array.isArray(parsed.payoutRequests) ? parsed.payoutRequests : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      processedSuggestionIds: Array.isArray(parsed.processedSuggestionIds)
        ? parsed.processedSuggestionIds
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
    };
  } catch {
    return emptyDeliveryBoyState();
  }
}

export function buildAssignmentSnapshot(params: {
  order: {
    id: string;
    cart_items: unknown;
    total: number | string;
    delivery_fee: number | string;
    payment_method: string;
    delivery_address: string | null;
    phone_number: string | null;
    delivery_type?: string | null;
    delivery_date?: string | null;
  };
  boy: DeliveryBoyProfile;
  customerName: string;
  otpDigest: string;
  salaryRule: DeliverySalaryRule;
  coinUsage?: CoinOrderUsage | null | undefined;
  existingId?: string | undefined;
}): DeliveryAssignment {
  const paymentMethod: "UPI" | "COD" = params.order.payment_method === "UPI" ? "UPI" : "COD";
  const paidWithCoins = Boolean(params.coinUsage && params.coinUsage.payableAmount === 0);
  const rawTotal = roundMoney(
    params.coinUsage ? params.coinUsage.payableAmount : Number(params.order.total),
  );
  const deliveryFee = roundMoney(Number(params.order.delivery_fee));
  const itemsRaw = Array.isArray(params.order.cart_items) ? params.order.cart_items : [];
  const items: DeliveryAssignmentItem[] = itemsRaw.map((item) => {
    const it = item as Partial<DeliveryAssignmentItem>;
    return {
      ...(typeof it.id === "string" ? { id: it.id } : {}),
      name: typeof it.name === "string" && it.name.trim() ? it.name.trim() : "Item",
      qty: Math.max(1, Math.floor(Number(it.qty) || 1)),
      price: roundMoney(Number(it.price) || 0),
      image_url: it.image_url ?? null,
    };
  });

  const earningAmount = calculateDeliveryBoyEarning(deliveryFee, params.salaryRule);
  const nowIso = new Date().toISOString();

  return {
    id: params.existingId ?? `assign:${params.order.id}`,
    orderId: params.order.id,
    boyId: params.boy.userId,
    boyName: params.boy.name,
    customerName: params.customerName.trim() || "Student",
    phoneNumber: params.order.phone_number ?? null,
    deliveryAddress: params.order.delivery_address?.trim() || "Campus Hostel",
    deliveryType: params.order.delivery_type === "sunday_tuesday" ? "sunday_tuesday" : "quick",
    deliveryDate: params.order.delivery_date ?? null,
    items,
    paymentMethod,
    paidWithCoins,
    // Strictly omit total collect price for UPI or 100%-coin prepaid orders.
    codCollectAmount: paymentMethod === "COD" && !paidWithCoins ? rawTotal : null,
    deliveryFee,
    earningAmount,
    otpDigest: params.otpDigest,
    status: "assigned",
    assignedAt: nowIso,
    earningCredited: false,
  };
}

export type DeliveryBoyOrderProjection = {
  orderId: string;
  shortCode: string;
  paymentLabel: string;
  isPrepaid: boolean;
  showTotalPrice: boolean;
  collectTotal: number | null;
  showDeliveryFee: false;
  items: DeliveryAssignmentItem[];
  deliveryAddress: string;
  customerName: string;
  phoneNumber: string | null;
};

/**
 * Enforces the user's strict Delivery Boy order card rules:
 * - Always shows product image, name, item price & delivery address.
 * - If UPI (or 100% Coins prepaid): NEVER shows order total price or delivery charge.
 * - If COD: shows ONLY total price to collect, NEVER shows delivery charge breakdown.
 */
export function projectOrderForDeliveryBoy(
  assignment: Pick<
    DeliveryAssignment,
    | "orderId"
    | "paymentMethod"
    | "paidWithCoins"
    | "codCollectAmount"
    | "items"
    | "deliveryAddress"
    | "customerName"
    | "phoneNumber"
  >,
): DeliveryBoyOrderProjection {
  const isPrepaid = assignment.paymentMethod === "UPI" || assignment.paidWithCoins;
  const collectTotal = !isPrepaid && assignment.codCollectAmount !== null
    ? roundMoney(assignment.codCollectAmount)
    : null;

  return {
    orderId: assignment.orderId,
    shortCode: assignment.orderId.slice(0, 8).toUpperCase(),
    paymentLabel: assignment.paidWithCoins
      ? "Prepaid · Campu Coins"
      : assignment.paymentMethod === "UPI"
        ? "UPI · Prepaid"
        : "Cash on Delivery",
    isPrepaid,
    showTotalPrice: !isPrepaid && collectTotal !== null,
    collectTotal,
    showDeliveryFee: false,
    items: assignment.items,
    deliveryAddress: assignment.deliveryAddress,
    customerName: assignment.customerName,
    phoneNumber: assignment.phoneNumber,
  };
}

export type BoyFinancialSummary = {
  walletBalance: number;
  pendingPayoutTotal: number;
  withdrawableBalance: number;
  totalEarned: number;
  totalPaidOut: number;
  completedCount: number;
};

export function getBoyFinancialSummary(
  state: DeliveryBoyStateV1,
  boyId: string,
): BoyFinancialSummary {
  const walletBalance = roundMoney(state.wallets[boyId] ?? 0);
  const pendingPayoutTotal = roundMoney(
    state.payoutRequests
      .filter((r) => r.boyId === boyId && r.status === "pending")
      .reduce((sum, r) => sum + roundMoney(r.amount), 0),
  );
  const withdrawableBalance = roundMoney(Math.max(0, walletBalance - pendingPayoutTotal));
  const totalEarned = roundMoney(state.totalEarned[boyId] ?? 0);
  const totalPaidOut = roundMoney(state.totalPaidOut[boyId] ?? 0);
  const completedCount = state.assignments.filter(
    (a) => a.boyId === boyId && a.status === "delivered",
  ).length;

  return {
    walletBalance,
    pendingPayoutTotal,
    withdrawableBalance,
    totalEarned,
    totalPaidOut,
    completedCount,
  };
}

export function validatePayoutRequestInput(params: {
  method: DeliveryPayoutMethod;
  amount: number;
  withdrawableBalance: number;
  upiId?: string | null | undefined;
  bankingName?: string | null | undefined;
}): string | null {
  const amount = roundMoney(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Enter a valid payout amount greater than ₹0.";
  }
  if (amount > roundMoney(params.withdrawableBalance)) {
    return `Requested amount exceeds available balance (₹${roundMoney(params.withdrawableBalance)}).`;
  }
  if (params.method === "UPI") {
    const upi = (params.upiId ?? "").trim();
    const bankName = (params.bankingName ?? "").trim();
    if (!upi || !/^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9.-]{2,}$/.test(upi)) {
      return "Enter a valid UPI ID (e.g. name@okaxis).";
    }
    if (bankName.length < 2) {
      return "Enter the banking / account holder name for UPI.";
    }
  }
  return null;
}

export function applyDeliveredOtpToState(
  state: DeliveryBoyStateV1,
  orderId: string,
  deliveredAt = new Date().toISOString(),
  suggestionId?: string,
): { next: DeliveryBoyStateV1; creditedAmount: number; boyId: string | null } {
  const target = state.assignments.find((a) => a.orderId === orderId);
  if (!target) {
    return { next: state, creditedAmount: 0, boyId: null };
  }

  const alreadyDelivered = target.status === "delivered" && target.earningCredited;
  const processed =
    suggestionId && !state.processedSuggestionIds.includes(suggestionId)
      ? [...state.processedSuggestionIds, suggestionId]
      : state.processedSuggestionIds;

  if (alreadyDelivered) {
    return {
      next:
        processed === state.processedSuggestionIds
          ? state
          : { ...state, processedSuggestionIds: processed },
      creditedAmount: 0,
      boyId: target.boyId,
    };
  }

  const earning = roundMoney(
    target.earningAmount > 0
      ? target.earningAmount
      : calculateDeliveryBoyEarning(target.deliveryFee, state.salaryRule),
  );
  const shouldCredit = !target.earningCredited && earning > 0;
  const nextWallets = { ...state.wallets };
  const nextEarned = { ...state.totalEarned };
  const nextTransactions = [...state.transactions];

  if (shouldCredit) {
    nextWallets[target.boyId] = roundMoney((nextWallets[target.boyId] ?? 0) + earning);
    nextEarned[target.boyId] = roundMoney((nextEarned[target.boyId] ?? 0) + earning);
    nextTransactions.unshift({
      id: `earn:${orderId}`,
      boyId: target.boyId,
      type: "delivery_earning",
      amount: earning,
      note: `Order #${orderId.slice(0, 8).toUpperCase()} delivered (OTP verified)`,
      orderId,
      createdAt: deliveredAt,
    });
  }

  const nextAssignments = state.assignments.map((a) =>
    a.orderId === orderId
      ? {
          ...a,
          status: "delivered" as const,
          deliveredAt: a.deliveredAt ?? deliveredAt,
          earningAmount: earning,
          earningCredited: true,
        }
      : a,
  );

  return {
    creditedAmount: shouldCredit ? earning : 0,
    boyId: target.boyId,
    next: {
      ...state,
      assignments: nextAssignments.slice(0, 200),
      wallets: nextWallets,
      totalEarned: nextEarned,
      transactions: nextTransactions.slice(0, 300),
      processedSuggestionIds: processed,
      updatedAt: deliveredAt,
    },
  };
}

export function applyPayoutDecisionToState(
  state: DeliveryBoyStateV1,
  requestId: string,
  decision: "paid" | "rejected",
  reviewedAt = new Date().toISOString(),
  rejectionReason?: string,
): { next: DeliveryBoyStateV1; updatedRequest: DeliveryPayoutRequest } {
  const target = state.payoutRequests.find((r) => r.id === requestId);
  if (!target) {
    throw new Error("Payout request not found.");
  }
  if (target.status !== "pending") {
    throw new Error(`Payout request was already ${target.status}.`);
  }

  const nextWallets = { ...state.wallets };
  const nextPaidOut = { ...state.totalPaidOut };
  const nextTransactions = [...state.transactions];

  if (decision === "paid") {
    const currentBal = roundMoney(nextWallets[target.boyId] ?? 0);
    if (roundMoney(target.amount) > currentBal) {
      throw new Error("Insufficient delivery boy wallet balance for this payout.");
    }
    nextWallets[target.boyId] = roundMoney(currentBal - roundMoney(target.amount));
    nextPaidOut[target.boyId] = roundMoney((nextPaidOut[target.boyId] ?? 0) + roundMoney(target.amount));
    nextTransactions.unshift({
      id: `payout:${target.id}`,
      boyId: target.boyId,
      type: "payout_paid",
      amount: -roundMoney(target.amount),
      note:
        target.method === "UPI"
          ? `UPI payout to ${target.upiId ?? "UPI"} (${target.bankingName ?? ""})`
          : "Cash payout completed",
      payoutId: target.id,
      createdAt: reviewedAt,
    });
  }

  const updatedRequest: DeliveryPayoutRequest = {
    ...target,
    status: decision,
    reviewedAt,
    ...(rejectionReason ? { rejectionReason } : {}),
  };

  const nextRequests = state.payoutRequests.map((r) => (r.id === requestId ? updatedRequest : r));

  return {
    updatedRequest,
    next: {
      ...state,
      wallets: nextWallets,
      totalPaidOut: nextPaidOut,
      payoutRequests: nextRequests.slice(0, 200),
      transactions: nextTransactions.slice(0, 300),
      updatedAt: reviewedAt,
    },
  };
}

export function parseDeliveryBoySuggestionRow(raw: string): DeliveryBoySuggestionEvent | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DeliveryBoySuggestionEvent> & {
      orderId?: string;
      boyId?: string;
      status?: string;
      updatedAt?: string;
      otpDigest?: string;
      deliveredAt?: string;
      request?: Partial<DeliveryPayoutRequest>;
    };
    if (!parsed || typeof parsed !== "object") return null;

    if (
      parsed.type === "delivery_boy_status" &&
      typeof parsed.orderId === "string" &&
      typeof parsed.boyId === "string" &&
      parsed.status === "out_for_delivery"
    ) {
      return {
        type: "delivery_boy_status",
        orderId: parsed.orderId,
        boyId: parsed.boyId,
        status: "out_for_delivery",
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      };
    }

    if (
      parsed.type === "delivery_boy_delivered" &&
      typeof parsed.orderId === "string" &&
      typeof parsed.boyId === "string" &&
      typeof parsed.otpDigest === "string" &&
      /^[a-f0-9]{64}$/i.test(parsed.otpDigest)
    ) {
      return {
        type: "delivery_boy_delivered",
        orderId: parsed.orderId,
        boyId: parsed.boyId,
        otpDigest: parsed.otpDigest.toLowerCase(),
        deliveredAt: typeof parsed.deliveredAt === "string" ? parsed.deliveredAt : new Date().toISOString(),
      };
    }

    if (
      parsed.type === "delivery_boy_payout_request" &&
      parsed.request &&
      typeof parsed.request.id === "string" &&
      typeof parsed.request.boyId === "string"
    ) {
      const amount = roundMoney(Number(parsed.request.amount));
      const method: DeliveryPayoutMethod = parsed.request.method === "UPI" ? "UPI" : "COD";
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return {
        type: "delivery_boy_payout_request",
        request: {
          id: parsed.request.id,
          boyId: parsed.request.boyId,
          boyName: parsed.request.boyName?.trim() || "Delivery Partner",
          phone: parsed.request.phone ?? null,
          amount,
          method,
          upiId: method === "UPI" ? (parsed.request.upiId ?? "").trim() : null,
          bankingName: method === "UPI" ? (parsed.request.bankingName ?? "").trim() : null,
          // Never allow client suggestions to self-approve payouts.
          status: "pending",
          createdAt: parsed.request.createdAt ?? new Date().toISOString(),
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function reconcileDeliveryBoyState(
  base: DeliveryBoyStateV1,
  suggestionRows: Array<{ id: string; user_id: string; suggestion_text: string }>,
): { state: DeliveryBoyStateV1; changed: boolean } {
  let next: DeliveryBoyStateV1 = {
    ...base,
    boys: [...base.boys],
    assignments: [...base.assignments],
    wallets: { ...base.wallets },
    totalEarned: { ...base.totalEarned },
    totalPaidOut: { ...base.totalPaidOut },
    payoutRequests: [...base.payoutRequests],
    transactions: [...base.transactions],
    processedSuggestionIds: [...base.processedSuggestionIds],
  };
  let changed = false;

  const events: Array<{ id: string; rowUserId: string; ev: DeliveryBoySuggestionEvent; time: string }> = [];
  for (const row of suggestionRows) {
    const ev = parseDeliveryBoySuggestionRow(row.suggestion_text);
    if (!ev) continue;
    const time =
      ev.type === "delivery_boy_status"
        ? ev.updatedAt
        : ev.type === "delivery_boy_delivered"
          ? ev.deliveredAt
          : ev.request.createdAt;
    events.push({ id: row.id, rowUserId: row.user_id, ev, time });
  }
  events.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  for (const item of events) {
    if (next.processedSuggestionIds.includes(item.id)) continue;

    if (item.ev.type === "delivery_boy_status") {
      const ev = item.ev;
      if (ev.boyId !== item.rowUserId) continue;
      const target = next.assignments.find((a) => a.orderId === ev.orderId);
      if (target && target.boyId === ev.boyId && target.status === "assigned") {
        next.assignments = next.assignments.map((a) =>
          a.orderId === ev.orderId
            ? { ...a, status: "out_for_delivery", outForDeliveryAt: ev.updatedAt }
            : a,
        );
        changed = true;
      }
      next.processedSuggestionIds.push(item.id);
      changed = true;
    } else if (item.ev.type === "delivery_boy_delivered") {
      const ev = item.ev;
      if (ev.boyId !== item.rowUserId) continue;
      const target = next.assignments.find((a) => a.orderId === ev.orderId);
      // Verify cryptographic OTP digest before honoring delivery or crediting salary.
      if (
        target &&
        target.boyId === ev.boyId &&
        target.otpDigest &&
        target.otpDigest.toLowerCase() === ev.otpDigest.toLowerCase()
      ) {
        const res = applyDeliveredOtpToState(next, ev.orderId, ev.deliveredAt, item.id);
        if (res.next !== next) {
          next = res.next;
          changed = true;
        }
      }
    } else if (item.ev.type === "delivery_boy_payout_request") {
      const req = item.ev.request;
      if (req.boyId !== item.rowUserId) continue;
      const exists = next.payoutRequests.some((r) => r.id === req.id);
      if (!exists) {
        const summary = getBoyFinancialSummary(next, req.boyId);
        const err = validatePayoutRequestInput({
          method: req.method,
          amount: req.amount,
          withdrawableBalance: summary.withdrawableBalance,
          upiId: req.upiId,
          bankingName: req.bankingName,
        });
        if (!err) {
          next.payoutRequests = [req, ...next.payoutRequests].slice(0, 200);
          changed = true;
        }
      }
      next.processedSuggestionIds.push(item.id);
      changed = true;
    }
  }

  return { state: next, changed };
}

export function ringingDeliveryAssignmentIds(
  assignments: DeliveryAssignment[],
  boyId: string,
  acknowledged: Set<string>,
  now = Date.now(),
): string[] {
  return assignments
    .filter((a) => a.boyId === boyId && a.status === "assigned")
    .filter((a) => now - new Date(a.assignedAt).getTime() <= SIREN_WINDOW_MS)
    .filter((a) => !acknowledged.has(`deliv:${a.orderId}`))
    .map((a) => a.orderId);
}

export function ringingPayoutRequestIds(
  payoutRequests: DeliveryPayoutRequest[],
  acknowledged: Set<string>,
  now = Date.now(),
): string[] {
  return payoutRequests
    .filter((r) => r.status === "pending")
    .filter((r) => now - new Date(r.createdAt).getTime() <= SIREN_WINDOW_MS)
    .filter((r) => !acknowledged.has(`payout:${r.id}`))
    .map((r) => r.id);
}

/** Hook returning Delivery Boy roster status, assigned orders, salary balance, and payout history. */
export function useDeliveryBoyState() {
  const { session } = useSession();
  const uid = session?.user.id;
  const queryClient = useQueryClient();
  const settings = useQuery(settingsQuery);
  const rawState = settings.data?.[DELIVERY_BOY_STATE_KEY];

  const baseState = parseDeliveryBoyState(rawState);
  const myBoyProfile = uid
    ? baseState.boys.find((b) => b.userId === uid) ?? null
    : null;
  const isActiveBoy = Boolean(myBoyProfile?.active);

  const eventsQuery = useQuery({
    queryKey: ["delivery-boy-events", uid],
    enabled: Boolean(uid && myBoyProfile),
    staleTime: 10_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suggestions")
        .select("id, user_id, suggestion_text, created_at")
        .eq("user_id", uid!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return [];
      return data ?? [];
    },
  });

  const { state } = reconcileDeliveryBoyState(baseState, eventsQuery.data ?? []);
  const boyProfile = uid ? state.boys.find((b) => b.userId === uid) ?? null : null;

  const assignmentsForBoy = uid
    ? state.assignments
        .filter((a) => a.boyId === uid)
        .sort((a, b) => new Date(b.assignedAt).getTime() - new Date(a.assignedAt).getTime())
    : [];

  const payoutRequestsForBoy = uid
    ? state.payoutRequests
        .filter((r) => r.boyId === uid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  const transactionsForBoy = uid
    ? state.transactions
        .filter((t) => t.boyId === uid)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [];

  const summary = uid
    ? getBoyFinancialSummary(state, uid)
    : {
        walletBalance: 0,
        pendingPayoutTotal: 0,
        withdrawableBalance: 0,
        totalEarned: 0,
        totalPaidOut: 0,
        completedCount: 0,
      };

  const hasPendingPayout = payoutRequestsForBoy.some((r) => r.status === "pending");
  useEffect(() => {
    if (!uid || !boyProfile?.active) return;
    const intervalMs = hasPendingPayout ? 8_000 : 15_000;
    const t = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void eventsQuery.refetch();
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [uid, boyProfile?.active, hasPendingPayout, queryClient, eventsQuery]);

  return {
    loading: settings.isLoading,
    state,
    boyProfile,
    isActiveBoy,
    assignments: assignmentsForBoy,
    payoutRequests: payoutRequestsForBoy,
    transactions: transactionsForBoy,
    summary,
    refetch: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["app_settings"] }),
        eventsQuery.refetch(),
      ]);
    },
  };
}

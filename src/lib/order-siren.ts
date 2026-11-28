import type { CoinTopupRequest } from "@/lib/coins";
import type { DeliveryPayoutRequest } from "@/lib/delivery-boy";

/** Orders, coin requests, and delivery payout requests that should keep the admin siren ringing. */
export const SIREN_STATUSES = ["pending", "payment_review"];
export const SIREN_WINDOW_MS = 2 * 60 * 60 * 1000;
const AUTO_ACCEPT_DELTA_MS = 60 * 1000;

export type SirenOrderLike = {
  id: string;
  status: string;
  created_at: string;
  accepted_at?: string | null;
  payment_method?: string | null;
  utr_number?: string | null;
};

/**
 * Full Campu Coins orders are auto-accepted immediately so payment doesn't wait
 * in manual review, but the admin/shop owner still hasn't seen them yet — keep
 * the siren ringing until acknowledged (or dispatched/delivered/cancelled).
 */
export function isAutoAcceptedCoinOrder(
  order: SirenOrderLike,
  fullCoinOrderIds?: ReadonlySet<string>,
): boolean {
  if (order.status !== "accepted") return false;
  if (fullCoinOrderIds?.has(order.id)) return true;
  if (
    order.payment_method === "UPI" &&
    typeof order.utr_number === "string" &&
    /^99\d{10}$/.test(order.utr_number) &&
    order.accepted_at
  ) {
    const deltaMs = Math.abs(
      new Date(order.accepted_at).getTime() - new Date(order.created_at).getTime(),
    );
    if (Number.isFinite(deltaMs) && deltaMs <= AUTO_ACCEPT_DELTA_MS) {
      return true;
    }
  }
  return false;
}

export function ringingOrderIds(
  orders: SirenOrderLike[],
  acknowledged: Set<string>,
  now = Date.now(),
  fullCoinOrderIds?: ReadonlySet<string>,
): string[] {
  return orders
    .filter(
      (o) =>
        SIREN_STATUSES.includes(o.status) ||
        isAutoAcceptedCoinOrder(o, fullCoinOrderIds),
    )
    .filter((o) => now - new Date(o.created_at).getTime() <= SIREN_WINDOW_MS)
    .filter((o) => !acknowledged.has(o.id))
    .map((o) => o.id);
}

export function ringingCoinRequestIds(
  coinRequests: CoinTopupRequest[],
  acknowledged: Set<string>,
  now = Date.now(),
): string[] {
  return coinRequests
    .filter((r) => r.status === "pending")
    .filter((r) => now - new Date(r.createdAt).getTime() <= SIREN_WINDOW_MS)
    .filter((r) => !acknowledged.has(`coin:${r.id}`))
    .map((r) => r.id);
}

export function ringingPayoutIds(
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

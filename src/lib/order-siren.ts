import type { CoinTopupRequest } from "@/lib/coins";

/** Orders & coin requests that should keep the admin siren ringing: recent and unacknowledged. */
export const SIREN_STATUSES = ["pending", "payment_review"];
export const SIREN_WINDOW_MS = 2 * 60 * 60 * 1000;

export function ringingOrderIds(
  orders: { id: string; status: string; created_at: string }[],
  acknowledged: Set<string>,
  now = Date.now(),
): string[] {
  return orders
    .filter((o) => SIREN_STATUSES.includes(o.status))
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

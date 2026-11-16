/** Quick Delivery, Sunday & Tuesday Special, and VIP pricing rules (shared by cart, checkout, VIP, and server). */
export const SCHEDULED_MIN_ORDER = 99;
export const SCHEDULED_ORIGINAL_FEE = 25;
export const VIP_PRICE = 149;
export const VIP_QUICK_FREE_PER_DAY = 1;
export const VIP_QUICK_DISCOUNT_MIN_ORDER = 50;
export const VIP_QUICK_DISCOUNT_PCT = 50;

export type ScheduledFee = {
  /** False below the ₹99 minimum — the order must not be placed. */
  eligible: boolean;
  /** Amount still needed to reach the minimum (0 when eligible). */
  shortBy: number;
  /** Active delivery fee, or null when below the minimum. */
  fee: number | null;
  /** Fee a non-VIP would pay (for strike-through), or null below the minimum. */
  normalFee: number | null;
  /** Next tier threshold and its fee, or null at the top tier. */
  next: { at: number; fee: number; addMore: number } | null;
};

export function vipDiscountedQuickFee(normalFee: number): number {
  const safe = Math.max(0, Number(normalFee) || 0);
  return Math.round(safe * (100 - VIP_QUICK_DISCOUNT_PCT)) / 100;
}

const TIERS = [
  { from: 300, fee: 10, vip: 0 },
  { from: 99, fee: 15, vip: 3 },
];

export function scheduledDeliveryFee(subtotal: number, vip = false): ScheduledFee {
  const s = Math.max(0, Number(subtotal) || 0);
  if (s < SCHEDULED_MIN_ORDER) {
    return { eligible: false, shortBy: Math.ceil(SCHEDULED_MIN_ORDER - s), fee: null, normalFee: null, next: null };
  }
  const i = TIERS.findIndex((t) => s >= t.from);
  const tier = TIERS[i]!;
  const up = i > 0 ? TIERS[i - 1]! : null;
  return {
    eligible: true,
    shortBy: 0,
    fee: vip ? tier.vip : tier.fee,
    normalFee: tier.fee,
    next: up ? { at: up.from, fee: vip ? up.vip : up.fee, addMore: Math.ceil(up.from - s) } : null,
  };
}

/**
 * Quick delivery:
 * - Non-VIPs always pay the normal fee with no minimum order limit.
 * - VIPs get 1 FREE quick delivery per day on any order amount.
 * - After 1 free order per day, VIPs get 50% OFF on ₹50+ orders, and pay the normal fee below ₹50.
 */
export function quickDeliveryFee(normalFee: number, subtotal: number, vip: boolean, freeUsedToday: number): number {
  if (!vip) return normalFee;
  if (freeUsedToday < VIP_QUICK_FREE_PER_DAY) return 0;
  const s = Math.max(0, Number(subtotal) || 0);
  return s >= VIP_QUICK_DISCOUNT_MIN_ORDER ? vipDiscountedQuickFee(normalFee) : normalFee;
}

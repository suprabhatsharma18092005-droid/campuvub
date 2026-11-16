/** Quick Delivery & Sunday & Tuesday Special pricing rules (VIP disabled — normal charges apply). */
export const SCHEDULED_MIN_ORDER = 99;
export const SCHEDULED_ORIGINAL_FEE = 25;
export const VIP_PRICE = 149;
export const VIP_QUICK_FREE_PER_DAY = 0;
export const VIP_QUICK_DISCOUNT_MIN_ORDER = 50;
export const VIP_QUICK_DISCOUNT_PCT = 0;

export type ScheduledFee = {
  /** False below the ₹99 minimum — the order must not be placed. */
  eligible: boolean;
  /** Amount still needed to reach the minimum (0 when eligible). */
  shortBy: number;
  /** Active delivery fee, or null when below the minimum. */
  fee: number | null;
  /** Normal fee for display. */
  normalFee: number | null;
  /** Next tier threshold and its fee, or null at the top tier. */
  next: { at: number; fee: number; addMore: number } | null;
};

export function vipDiscountedQuickFee(normalFee: number): number {
  return Math.max(0, Number(normalFee) || 0);
}

const TIERS = [
  { from: 300, fee: 10 },
  { from: 99, fee: 15 },
];

export function scheduledDeliveryFee(subtotal: number, _vip = false): ScheduledFee {
  void _vip;
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
    fee: tier.fee,
    normalFee: tier.fee,
    next: up ? { at: up.from, fee: up.fee, addMore: Math.ceil(up.from - s) } : null,
  };
}

/** Quick delivery always charges the normal delivery fee (₹5 UPI / ₹8 COD by default). */
export function quickDeliveryFee(
  normalFee: number,
  _subtotal = 0,
  _vip = false,
  _freeUsedToday = 0,
): number {
  void _subtotal;
  void _vip;
  void _freeUsedToday;
  return normalFee;
}

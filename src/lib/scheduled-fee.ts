/** Sunday & Tuesday Special and VIP pricing rules (pure, shared by cart, checkout and saved order). */
export const SCHEDULED_MIN_ORDER = 99;
export const SCHEDULED_ORIGINAL_FEE = 25;
export const VIP_PRICE = 149;
export const VIP_QUICK_FREE_PER_DAY = 2;
export const VIP_QUICK_MIN_ORDER = 0;

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

/** Quick delivery: VIPs get free delivery on up to 2 orders per day with no minimum order value; otherwise the normal fee. */
export function quickDeliveryFee(normalFee: number, _subtotal: number, vip: boolean, freeUsedToday: number): number {
  if (vip && freeUsedToday < VIP_QUICK_FREE_PER_DAY) return 0;
  return normalFee;
}

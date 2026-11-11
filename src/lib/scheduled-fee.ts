/** Sunday & Tuesday Special pricing rules (pure, shared by cart, checkout and saved order). */
export const SCHEDULED_MIN_ORDER = 99;
export const SCHEDULED_ORIGINAL_FEE = 25;

export type ScheduledFee = {
  /** False below the ₹99 minimum — the order must not be placed. */
  eligible: boolean;
  /** Amount still needed to reach the minimum (0 when eligible). */
  shortBy: number;
  /** Active delivery fee, or null when below the minimum. */
  fee: number | null;
  /** Next tier threshold and its fee, or null at the top tier. */
  next: { at: number; fee: number; addMore: number } | null;
};

const TIERS = [
  { from: 500, fee: 1 },
  { from: 300, fee: 5 },
  { from: 200, fee: 12 },
  { from: 99, fee: 15 },
];

export function scheduledDeliveryFee(subtotal: number): ScheduledFee {
  const s = Math.max(0, Number(subtotal) || 0);
  if (s < SCHEDULED_MIN_ORDER) {
    return { eligible: false, shortBy: Math.ceil(SCHEDULED_MIN_ORDER - s), fee: null, next: null };
  }
  const i = TIERS.findIndex((t) => s >= t.from);
  const tier = TIERS[i]!;
  const up = i > 0 ? TIERS[i - 1]! : null;
  return {
    eligible: true,
    shortBy: 0,
    fee: tier.fee,
    next: up ? { at: up.from, fee: up.fee, addMore: Math.ceil(up.from - s) } : null,
  };
}

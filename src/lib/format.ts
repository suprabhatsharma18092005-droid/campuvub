export function rupees(value: number | string) {
  const n = Number(value);
  return `₹${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

export const STATUS_LABELS: Record<string, string> = {
  pending: "Placed",
  payment_review: "Payment Under Review",
  accepted: "Accepted",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const TRACK_STEPS = [
  "pending",
  "payment_review",
  "accepted",
  "out_for_delivery",
  "delivered",
] as const;

export const UPI_STEPS = ["pending", "payment_review", "accepted", "out_for_delivery", "delivered"] as const;
export const COD_STEPS = ["pending", "accepted", "out_for_delivery", "delivered"] as const;
export const COINS_STEPS = ["pending", "accepted", "out_for_delivery", "delivered"] as const;

/** Steps for this order's payment flow, plus the index of its real current status. */
export function trackSteps(paymentMethod: string, status: string, paidFullyWithCoins = false) {
  if (paidFullyWithCoins) {
    const effective = status === "payment_review" ? "accepted" : status;
    const index = COINS_STEPS.indexOf(effective as (typeof COINS_STEPS)[number]);
    return { steps: COINS_STEPS, currentIndex: index === -1 ? 1 : index };
  }
  const steps: readonly string[] = paymentMethod === "UPI" ? UPI_STEPS : COD_STEPS;
  const index = steps.indexOf(status);
  // A UPI order always starts at payment_review, so "Placed" is already done.
  return { steps, currentIndex: index === -1 ? 0 : index };
}

export const DELIVERY_FEE = { UPI: 5, COD: 8 } as const;

/** Delivery fee driven by admin settings, falling back to the defaults. */
export function deliveryFee(
  settings: Record<string, string> | undefined,
  method: "UPI" | "COD",
) {
  const raw = method === "COD" ? settings?.["cod_delivery_charge"]
    : settings?.[settings?.["night_mode_enabled"] === "true" ? "night_upi_delivery_charge" : "upi_delivery_charge"];
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw !== "" ? n : DELIVERY_FEE[method];
}

export function cancellationFee(settings: Record<string, string> | undefined) {
  const n = Number(settings?.["cancellation_fee"]);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function makeOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

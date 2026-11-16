import { expect, test } from "bun:test";
import { quickDeliveryFee, scheduledDeliveryFee } from "./scheduled-fee.ts";
import { applyOrderCoinRefundToLedger, applyOrderCoinSpendToLedger, emptyCoinLedger, roundCoinValue } from "./coins.ts";

test("₹98 is blocked for scheduled delivery and needs ₹1 more", () => {
  expect(scheduledDeliveryFee(98)).toMatchObject({ eligible: false, shortBy: 1, fee: null });
});
test("normal: ₹99 to ₹299 pay ₹15", () => {
  expect(scheduledDeliveryFee(99)).toMatchObject({ eligible: true, fee: 15, next: { at: 300, fee: 10, addMore: 201 } });
  expect(scheduledDeliveryFee(299).fee).toBe(15);
  expect(scheduledDeliveryFee(150, true)).toMatchObject({ fee: 15, normalFee: 15 });
});
test("normal: ₹300 and above pay ₹10", () => {
  expect(scheduledDeliveryFee(300)).toMatchObject({ fee: 10, next: null });
  expect(scheduledDeliveryFee(800).fee).toBe(10);
  expect(scheduledDeliveryFee(300, true)).toMatchObject({ fee: 10, normalFee: 10 });
});
test("Quick delivery always charges normal fee (₹5 UPI / ₹8 COD) at any order value", () => {
  expect(quickDeliveryFee(5, 20, false, 0)).toBe(5);
  expect(quickDeliveryFee(5, 49, true, 0)).toBe(5);
  expect(quickDeliveryFee(5, 200, true, 1)).toBe(5);
  expect(quickDeliveryFee(8, 30, true, 0)).toBe(8);
});
test("Fractional coin values like 52.5 deduct and refund exact decimal amounts", () => {
  const base = { ...emptyCoinLedger(), balances: { u1: 100 } };
  const spend = applyOrderCoinSpendToLedger(base, {
    orderId: "ord-1",
    userId: "u1",
    coinsUsed: 52.5,
    orderTotal: 52.5,
    payableAmount: 0,
    paymentMethod: "COINS",
    refunded: false,
    createdAt: "2026-11-16T00:00:00.000Z",
  });
  expect(spend.applied).toBe(true);
  expect(roundCoinValue(spend.next.balances["u1"] ?? 0)).toBe(47.5);
  expect(spend.next.orderUsages["ord-1"]?.coinsUsed).toBe(52.5);
  expect(spend.next.orderUsages["ord-1"]?.payableAmount).toBe(0);

  const refund = applyOrderCoinRefundToLedger(spend.next, "ord-1");
  expect(refund.refundedCoins).toBe(52.5);
  expect(roundCoinValue(refund.next.balances["u1"] ?? 0)).toBe(100);
});

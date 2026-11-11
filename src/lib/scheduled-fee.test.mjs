import { expect, test } from "bun:test";
import { scheduledDeliveryFee } from "./scheduled-fee.ts";

test("₹98 is blocked and needs ₹1 more", () => {
  expect(scheduledDeliveryFee(98)).toMatchObject({ eligible: false, shortBy: 1, fee: null });
});
test("₹99 and ₹199 pay ₹15", () => {
  expect(scheduledDeliveryFee(99)).toMatchObject({ eligible: true, fee: 15, next: { at: 200, addMore: 101 } });
  expect(scheduledDeliveryFee(199).fee).toBe(15);
});
test("₹200 and ₹299 pay ₹12", () => {
  expect(scheduledDeliveryFee(200).fee).toBe(12);
  expect(scheduledDeliveryFee(299)).toMatchObject({ fee: 12, next: { at: 300, addMore: 1 } });
});
test("₹300 and ₹499 pay ₹5", () => {
  expect(scheduledDeliveryFee(300).fee).toBe(5);
  expect(scheduledDeliveryFee(499)).toMatchObject({ fee: 5, next: { at: 500, addMore: 1 } });
});
test("₹500 pays ₹1 with no further tier", () => {
  expect(scheduledDeliveryFee(500)).toMatchObject({ fee: 1, next: null });
});

import { expect, test } from "bun:test";
import { quickDeliveryFee, scheduledDeliveryFee } from "./scheduled-fee.ts";

test("₹98 is blocked and needs ₹1 more", () => {
  expect(scheduledDeliveryFee(98)).toMatchObject({ eligible: false, shortBy: 1, fee: null });
});
test("normal: ₹99 to ₹299 pay ₹15", () => {
  expect(scheduledDeliveryFee(99)).toMatchObject({ eligible: true, fee: 15, next: { at: 300, fee: 10, addMore: 201 } });
  expect(scheduledDeliveryFee(299).fee).toBe(15);
});
test("normal: ₹300 and above pay ₹10", () => {
  expect(scheduledDeliveryFee(300)).toMatchObject({ fee: 10, next: null });
  expect(scheduledDeliveryFee(800).fee).toBe(10);
});
test("VIP: ₹99 to ₹299 pay ₹3", () => {
  expect(scheduledDeliveryFee(150, true)).toMatchObject({ fee: 3, normalFee: 15 });
});
test("VIP: ₹300 and above is free", () => {
  expect(scheduledDeliveryFee(300, true)).toMatchObject({ fee: 0, normalFee: 10 });
});
test("VIP quick delivery is free for 2 orders of ₹99+ per day", () => {
  expect(quickDeliveryFee(5, 99, true, 0)).toBe(0);
  expect(quickDeliveryFee(5, 120, true, 1)).toBe(0);
  expect(quickDeliveryFee(5, 120, true, 2)).toBe(5);
  expect(quickDeliveryFee(5, 98, true, 0)).toBe(5);
  expect(quickDeliveryFee(5, 200, false, 0)).toBe(5);
});

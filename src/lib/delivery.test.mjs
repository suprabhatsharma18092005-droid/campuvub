import { expect, test } from "bun:test";
import { deliveryLabel, sundayTuesdayDeliveryDate } from "./delivery.ts";

// Times in India (+05:30). Week of Sun 8 Nov 2026.
const at = (s) => new Date(`${s}+05:30`);

test("Saturday 11:59 PM goes to the next day, Sunday", () => {
  expect(sundayTuesdayDeliveryDate(at("2026-11-07T23:59:00"))).toBe("2026-11-08");
});
test("Tuesday midnight goes to the coming Sunday", () => {
  expect(sundayTuesdayDeliveryDate(at("2026-11-03T00:00:00"))).toBe("2026-11-08");
});
test("Sunday midnight goes to Tuesday", () => {
  expect(sundayTuesdayDeliveryDate(at("2026-11-08T00:00:00"))).toBe("2026-11-10");
});
test("Monday 11:59 PM goes to Tuesday", () => {
  expect(sundayTuesdayDeliveryDate(at("2026-11-09T23:59:00"))).toBe("2026-11-10");
});
test("Uses India time, not UTC (Mon 1 AM IST is still Sun in UTC)", () => {
  expect(sundayTuesdayDeliveryDate(at("2026-11-09T01:00:00"))).toBe("2026-11-10");
});
test("labels", () => {
  expect(deliveryLabel("quick", null)).toBe("Quick Delivery");
  expect(deliveryLabel("sunday_tuesday", "2026-11-08")).toBe("Sunday Delivery");
  expect(deliveryLabel("sunday_tuesday", "2026-11-10")).toBe("Tuesday Delivery");
});

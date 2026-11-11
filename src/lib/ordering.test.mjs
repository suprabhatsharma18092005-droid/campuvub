import { expect, test } from "bun:test";

import { wasPlacedDuringPreorder } from "./ordering.ts";

test("identifies orders placed before opening on the same India calendar day", () => {
  expect(wasPlacedDuringPreorder("2026-10-15T03:00:00.000Z", "09:00", Date.parse("2026-10-15T03:15:00.000Z"))).toBe(true);
  expect(wasPlacedDuringPreorder("2026-10-15T03:30:00.000Z", "09:00", Date.parse("2026-10-15T03:45:00.000Z"))).toBe(false);
  expect(wasPlacedDuringPreorder("2026-10-15T03:00:00.000Z", "09:00", Date.parse("2026-10-16T03:00:00.000Z"))).toBe(false);
});
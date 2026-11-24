import { expect, test } from "bun:test";
import {
  DEFAULT_STORE_REOPEN_TIME,
  STORE_CLOSED_KEY,
  STORE_REOPEN_TIME_KEY,
  formatStoreClockTime,
  getReopenDayLabel,
  getStoreReopenTime,
  isStoreClosed,
  nextReopenCountdownMs,
} from "./store-status.ts";

test("reads store closed state and morning reopen time with sensible defaults", () => {
  expect(isStoreClosed({})).toBe(false);
  expect(isStoreClosed({ [STORE_CLOSED_KEY]: "false" })).toBe(false);
  expect(isStoreClosed({ [STORE_CLOSED_KEY]: "true" })).toBe(true);

  expect(getStoreReopenTime({})).toBe(DEFAULT_STORE_REOPEN_TIME);
  expect(getStoreReopenTime({ [STORE_REOPEN_TIME_KEY]: "07:30" })).toBe("07:30");
  expect(getStoreReopenTime({ order_start_time: "09:15" })).toBe("09:15");
});

test("formats 24h clock strings into clean 12-hour labels", () => {
  expect(formatStoreClockTime("08:00")).toBe("8:00 AM");
  expect(formatStoreClockTime("00:30")).toBe("12:30 AM");
  expect(formatStoreClockTime("12:00")).toBe("12:00 PM");
  expect(formatStoreClockTime("18:45")).toBe("6:45 PM");
});

test("computes IST countdown to today's morning open or wraps to tomorrow morning", () => {
  // 2026-11-23T01:00:00Z = 06:30:00 IST -> 1h 30m until 08:00 IST today
  const earlyMorningUtc = Date.parse("2026-11-23T01:00:00Z");
  expect(nextReopenCountdownMs("08:00", earlyMorningUtc)).toBe(90 * 60 * 1000);
  expect(getReopenDayLabel("08:00", earlyMorningUtc)).toBe("Today at 8:00 AM");

  // 2026-11-23T18:00:00Z = 23:30:00 IST -> 8h 30m until 08:00 IST tomorrow
  const lateNightUtc = Date.parse("2026-11-23T18:00:00Z");
  expect(nextReopenCountdownMs("08:00", lateNightUtc)).toBe((8 * 60 + 30) * 60 * 1000);
  expect(getReopenDayLabel("08:00", lateNightUtc)).toBe("Tomorrow at 8:00 AM");
});

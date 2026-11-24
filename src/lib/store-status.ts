export const STORE_CLOSED_KEY = "store_closed";
export const STORE_REOPEN_TIME_KEY = "store_reopen_time";
export const STORE_CLOSED_MESSAGE_KEY = "store_closed_message";

export const DEFAULT_STORE_REOPEN_TIME = "08:00";

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isStoreClosed(settings?: Record<string, string> | null): boolean {
  return settings?.[STORE_CLOSED_KEY] === "true";
}

export function getStoreReopenTime(settings?: Record<string, string> | null): string {
  const raw = settings?.[STORE_REOPEN_TIME_KEY]?.trim() ?? "";
  if (TIME_PATTERN.test(raw)) return raw;
  const fallback = settings?.["order_start_time"]?.trim() ?? "";
  if (TIME_PATTERN.test(fallback)) return fallback;
  return DEFAULT_STORE_REOPEN_TIME;
}

export function getStoreClosedMessage(settings?: Record<string, string> | null): string {
  const raw = settings?.[STORE_CLOSED_MESSAGE_KEY]?.trim() ?? "";
  return raw || "We are closed right now. Ordering will resume in the morning!";
}

/** Formats 24-hour "HH:MM" into a clean 12-hour label like "8:00 AM". */
export function formatStoreClockTime(hhmm: string): string {
  const match = TIME_PATTERN.exec(hhmm.trim());
  if (!match) return "8:00 AM";
  const hours24 = Number(match[1]);
  const minutes = match[2];
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${minutes} ${period}`;
}

function getIstClockSeconds(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMs);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part("hour") * 3600 + part("minute") * 60 + part("second");
}

/**
 * Computes milliseconds until the next occurrence of `hhmm` in Asia/Kolkata (IST).
 * If today's `hhmm` has already passed (e.g. closed at 11:30 PM, opens at 08:00 AM),
 * wraps cleanly to tomorrow's `hhmm`.
 */
export function nextReopenCountdownMs(hhmm: string, nowMs: number = Date.now()): number {
  const match = TIME_PATTERN.exec(hhmm.trim());
  if (!match) return 0;
  const targetSec = Number(match[1]) * 3600 + Number(match[2]) * 60;
  const nowSec = getIstClockSeconds(nowMs);
  const diffSec =
    targetSec > nowSec ? targetSec - nowSec : 24 * 3600 - nowSec + targetSec;
  return diffSec * 1000;
}

/** Returns "Today at 8:00 AM" if before opening time in IST, otherwise "Tomorrow at 8:00 AM". */
export function getReopenDayLabel(hhmm: string, nowMs: number = Date.now()): string {
  const formatted = formatStoreClockTime(hhmm);
  const match = TIME_PATTERN.exec(hhmm.trim());
  if (!match) return `Tomorrow at ${formatted}`;
  const targetSec = Number(match[1]) * 3600 + Number(match[2]) * 60;
  const nowSec = getIstClockSeconds(nowMs);
  return targetSec > nowSec ? `Today at ${formatted}` : `Tomorrow at ${formatted}`;
}

/** Opening time is a daily clock time in India, where Campu operates. */
export function openingCountdown(value: string | undefined, now: number): number {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const [hours = 0, minutes = 0] = value.split(":").map(Number);
  return Math.max(0, (hours * 3600 + minutes * 60 - (part("hour") * 3600 + part("minute") * 60 + part("second"))) * 1000);
}

/** Whether an order was placed before today's opening time in India. */
export function wasPlacedDuringPreorder(createdAt: string, openingTime: string | undefined, now: number): boolean {
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || !openingTime) return false;
  const indiaDateKey = (timestamp: number) => new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(timestamp).filter((part) => ["year", "month", "day"].includes(part.type))
    .map((part) => part.value).join("-");
  if (indiaDateKey(createdAtMs) !== indiaDateKey(now)) return false;
  return openingCountdown(openingTime, createdAtMs) > 0;
}

export function countdownLabel(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}
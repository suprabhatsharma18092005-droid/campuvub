import { useSyncExternalStore } from "react";

export type DeliveryMode = "quick" | "sunday_tuesday";

const TZ = "Asia/Kolkata";
const IST_OFFSET_MIN = 330;

/**
 * Next Sunday/Tuesday delivery date (YYYY-MM-DD, India time).
 * Sun & Mon orders → Tuesday; Tue–Sat orders → the coming Sunday.
 */
export function sundayTuesdayDeliveryDate(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const dow = ist.getUTCDay(); // 0 = Sunday
  const add = dow === 0 || dow === 1 ? 2 - dow : 7 - dow;
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + add));
  return d.toISOString().slice(0, 10);
}

function parseDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12));
}

/** "Sun, 9 Nov" */
export function formatDeliveryDate(iso: string): string {
  return parseDate(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
}

/** "Quick Delivery" / "Sunday Delivery" / "Tuesday Delivery" */
export function deliveryLabel(type: string | null | undefined, date: string | null | undefined): string {
  if (type !== "sunday_tuesday" || !date) return "Quick Delivery";
  return parseDate(date).getUTCDay() === 0 ? "Sunday Delivery" : "Tuesday Delivery";
}

export function productInMode(types: string[] | null | undefined, mode: DeliveryMode) {
  const list = types && types.length > 0 ? types : ["quick"];
  return list.includes(mode);
}

// ---- Selected mode, remembered across pages and reloads ----
const KEY = "campu.delivery-mode.v1";
let mode: DeliveryMode = "quick";
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "quick" || v === "sunday_tuesday") mode = v;
  } catch {
    /* ignore */
  }
}

export function getDeliveryMode(): DeliveryMode {
  hydrate();
  return mode;
}

export function setDeliveryMode(next: DeliveryMode) {
  mode = next;
  try {
    window.localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function subscribeDeliveryMode(l: () => void) {
  listeners.add(l);
  hydrate();
  if (mode !== "quick") queueMicrotask(l);
  return () => {
    listeners.delete(l);
  };
}

export function useDeliveryMode(): DeliveryMode {
  return useSyncExternalStore(subscribeDeliveryMode, getDeliveryMode, () => "quick");
}

export const MODE_LABEL: Record<DeliveryMode, string> = {
  quick: "Quick Delivery",
  sunday_tuesday: "Sunday & Tuesday Special Delivery",
};

function to12h(t: string) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return t;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/** "Delivery at 10:00 AM · Sun, 9 Nov" or "Delivery in 15–20 min · Today" */
export function deliveryInfoText(mode: DeliveryMode, settings?: Record<string, string>) {
  if (mode === "sunday_tuesday") {
    const time = to12h(settings?.["sunday_tuesday_delivery_time"] || "10:00");
    return `Delivery at ${time} · ${formatDeliveryDate(sundayTuesdayDeliveryDate())}`;
  }
  return `Delivery in ${settings?.["quick_delivery_estimate"] || "15–20 min"} · Today`;
}

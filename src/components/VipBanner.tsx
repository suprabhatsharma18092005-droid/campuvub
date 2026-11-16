import { Link } from "@tanstack/react-router";
import { Crown, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { rupees } from "@/lib/format";
import { SCHEDULED_MIN_ORDER, VIP_PRICE, VIP_QUICK_FREE_PER_DAY, VIP_QUICK_MIN_ORDER } from "@/lib/scheduled-fee";
import { cn } from "@/lib/utils";
import type { useVip } from "@/lib/vip";

type Vip = ReturnType<typeof useVip>;

export function formatVipDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

/** Sleek golden status badge shown to active VIP members across Home, Cart, and Checkout. */
export function VipActiveBadge({ vip, className }: { vip: Vip; className?: string }) {
  if (!vip.isVip) return null;
  const left = Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday);
  return (
    <Link
      to="/vip"
      className={cn(
        "flex items-center justify-between gap-2 rounded-2xl border border-primary/40 bg-royal px-3.5 py-2.5 text-xs font-bold text-white shadow-card transition-opacity hover:opacity-95",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-white/90" />
        <span>
          👑 Campu VIP Active ({left}/{VIP_QUICK_FREE_PER_DAY} Free {left === 1 ? "Order" : "Orders"} Left Today)
        </span>
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-white/90">
        Details →
      </span>
    </Link>
  );
}

/** Small line under the delivery fee: VIP status badge or promotional pitch. */
export function VipCartHint({ vip, mode }: { vip: Vip; mode: string; subtotal?: number }) {
  if (vip.loading) return null;
  if (vip.isVip) {
    return (
      <div className="mt-3">
        <VipActiveBadge vip={vip} />
        {mode !== "quick" && (
          <p className="mt-1.5 text-[11px] font-semibold text-primary">
            Sunday/Tuesday VIP rates applied automatically.
          </p>
        )}
      </div>
    );
  }
  if (vip.pending) {
    return (
      <Link
        to="/vip"
        className="mt-3 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning/15 p-3 text-xs font-semibold text-warning-foreground"
      >
        <Crown className="h-4 w-4 shrink-0" />
        <span>⏳ Campu VIP verification pending — unlocks free deliveries as soon as approved.</span>
      </Link>
    );
  }
  const expired = vip.wasMember;
  return (
    <Link
      to="/vip"
      className="mt-3 flex items-center gap-2 rounded-xl border border-primary/40 bg-accent p-3 text-xs font-semibold text-primary"
    >
      <Crown className="h-4 w-4 shrink-0" />
      <span>
        {expired
          ? `Your Campu VIP has expired! Renew now for ${rupees(VIP_PRICE)} to continue free deliveries. →`
          : `Get Campu VIP at ${rupees(VIP_PRICE)} & enjoy ${VIP_QUICK_FREE_PER_DAY} FREE quick ${VIP_QUICK_FREE_PER_DAY === 1 ? "delivery" : "deliveries"} daily (Min ₹${VIP_QUICK_MIN_ORDER})! →`}
      </span>
    </Link>
  );
}

/** Home page strip: sleek golden badge for active VIPs, renewal banner when expired, or promotional banner for non-VIPs. */
export function VipHomeBanner({ vip }: { vip: Vip }) {
  if (vip.loading || vip.pending) return null;
  if (vip.isVip) return <VipActiveBadge vip={vip} />;
  const expired = vip.wasMember;
  return (
    <Link
      to="/vip"
      className={`flex items-center gap-3 rounded-2xl border p-3 shadow-card ${
        expired ? "border-destructive/40 bg-destructive/10" : "border-primary/40 bg-accent"
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-primary-foreground">
        <Crown className="h-5 w-5" />
      </span>
      <span className="flex-1 text-sm">
        <span className="block font-bold">
          {expired ? "Your Campu VIP has expired!" : "Join Campu VIP"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {expired
            ? `Your Campu VIP has expired! Renew now for ${rupees(VIP_PRICE)} to continue free deliveries.`
            : `Get Campu VIP at ${rupees(VIP_PRICE)} & enjoy ${VIP_QUICK_FREE_PER_DAY} FREE quick ${VIP_QUICK_FREE_PER_DAY === 1 ? "delivery" : "deliveries"} daily (Min ₹${VIP_QUICK_MIN_ORDER})!`}
        </span>
      </span>
      <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-primary-foreground">
        {expired ? "Renew" : "Join"}
      </span>
    </Link>
  );
}

const SEEN_KEY = "campu.vip-popup-seen";

/** Shown once per session on initial load for non-VIPs, and immediately on membership expiration. */
export function VipPopup({ vip }: { vip: Vip }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (vip.loading || vip.isVip || vip.pending) {
      setOpen(false);
      return;
    }
    try {
      if (sessionStorage.getItem(SEEN_KEY)) return;
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore storage errors */
    }
    setOpen(true);
  }, [vip.loading, vip.isVip, vip.pending, vip.wasMember]);

  if (!open || vip.isVip || vip.pending) return null;
  const expired = vip.wasMember;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/50 p-5"
      role="dialog"
      aria-modal="true"
      aria-label="Campu VIP"
    >
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-float">
        <button
          type="button"
          aria-label="Close"
          onClick={() => setOpen(false)}
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand text-primary-foreground shadow-card">
          <Crown className="h-7 w-7" />
        </span>
        <h2 className="mt-3 font-display text-xl font-extrabold">
          {expired ? "Renew Campu VIP" : "Become a Campu VIP"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {expired
            ? `Your Campu VIP has expired! Renew now for ${rupees(VIP_PRICE)} to continue free deliveries.`
            : `Get Campu VIP at ${rupees(VIP_PRICE)} & enjoy ${VIP_QUICK_FREE_PER_DAY} FREE quick ${VIP_QUICK_FREE_PER_DAY === 1 ? "delivery" : "deliveries"} daily (Min ₹${VIP_QUICK_MIN_ORDER})!`}
        </p>
        <ul className="mt-4 space-y-2 rounded-2xl bg-muted/50 p-3 text-left text-sm">
          <li>
            ⚡ <b>FREE</b> quick delivery — {VIP_QUICK_FREE_PER_DAY} {VIP_QUICK_FREE_PER_DAY === 1 ? "order" : "orders"} a day (Min order ₹{VIP_QUICK_MIN_ORDER})
          </li>
          <li>
            📦 Sunday/Tuesday: <b>₹3</b> on ₹{SCHEDULED_MIN_ORDER}–₹299{" "}
            <s className="text-muted-foreground">₹15</s>
          </li>
          <li>
            🎁 Sunday/Tuesday: <b>FREE</b> on ₹300+{" "}
            <s className="text-muted-foreground">₹10</s>
          </li>
        </ul>
        <Link
          to="/vip"
          onClick={() => setOpen(false)}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-brand text-base font-bold text-primary-foreground shadow-float"
        >
          {expired ? "Renew" : "Join"} for {rupees(VIP_PRICE)} / 30 days
        </Link>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-2 h-10 px-4 text-xs font-semibold text-muted-foreground"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

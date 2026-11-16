import { Link } from "@tanstack/react-router";
import { Crown, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";

import { type DeliveryMode, useDeliveryMode } from "@/lib/delivery";
import { rupees } from "@/lib/format";
import {
  SCHEDULED_MIN_ORDER,
  VIP_PRICE,
  VIP_QUICK_DISCOUNT_MIN_ORDER,
  VIP_QUICK_DISCOUNT_PCT,
  VIP_QUICK_FREE_PER_DAY,
} from "@/lib/scheduled-fee";
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
export function VipActiveBadge({
  vip,
  mode,
  className,
}: {
  vip: Vip;
  mode?: DeliveryMode;
  className?: string;
}) {
  const activeMode = useDeliveryMode();
  const resolvedMode = mode ?? activeMode;
  if (!vip.isVip) return null;
  const left = Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday);
  const badgeText =
    resolvedMode === "sunday_tuesday"
      ? `👑 Campu VIP · Sun/Tue Special: ₹3 (₹${SCHEDULED_MIN_ORDER}–₹299) · FREE ₹300+`
      : left > 0
        ? `👑 Campu VIP · ${left}/${VIP_QUICK_FREE_PER_DAY} Free Quick Order Today (No Min!)`
        : `👑 Campu VIP · Daily Free Used · ${VIP_QUICK_DISCOUNT_PCT}% OFF ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+`;

  return (
    <Link
      to="/vip"
      className={cn(
        "flex w-full max-w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-2xl border border-primary/40 bg-royal px-3.5 py-2.5 text-xs font-bold text-white shadow-card transition-opacity hover:opacity-95",
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-white/90" />
        <span className="truncate">{badgeText}</span>
      </span>
      <span className="shrink-0 text-[11px] font-semibold text-white/90">Details →</span>
    </Link>
  );
}

/** Small line under the delivery fee: VIP status badge or promotional pitch, isolated per delivery mode. */
export function VipCartHint({
  vip,
  mode,
  subtotal = 0,
}: {
  vip: Vip;
  mode: DeliveryMode | string;
  subtotal?: number;
}) {
  const normalizedMode: DeliveryMode = mode === "sunday_tuesday" ? "sunday_tuesday" : "quick";
  if (vip.loading) return null;
  if (vip.isVip) {
    return (
      <div className="mt-3 min-w-0">
        <VipActiveBadge vip={vip} mode={normalizedMode} />
        <p className="mt-1.5 text-[11px] font-semibold text-primary">
          {normalizedMode === "quick"
            ? vip.freeUsedToday < VIP_QUICK_FREE_PER_DAY
              ? `1st quick delivery today is FREE (no min order) · Extra ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ orders today get ${VIP_QUICK_DISCOUNT_PCT}% OFF.`
              : subtotal >= VIP_QUICK_DISCOUNT_MIN_ORDER
                ? `Daily ${VIP_QUICK_FREE_PER_DAY} free order used — VIP ${VIP_QUICK_DISCOUNT_PCT}% OFF applied on ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+!`
                : `Daily ${VIP_QUICK_FREE_PER_DAY} free order used — normal fee applies below ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}; ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ gets ${VIP_QUICK_DISCOUNT_PCT}% OFF.`
            : `Sunday & Tuesday VIP rates applied automatically: ₹3 on ₹${SCHEDULED_MIN_ORDER}–₹299 & FREE on ₹300+.`}
        </p>
      </div>
    );
  }
  if (vip.pending) {
    return (
      <Link
        to="/vip"
        className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-warning/40 bg-warning/15 p-3 text-xs font-semibold text-warning-foreground"
      >
        <Crown className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          {normalizedMode === "sunday_tuesday"
            ? "⏳ Campu VIP verification pending — unlocks ₹3 / FREE Sunday & Tuesday delivery right after approval."
            : "⏳ Campu VIP verification pending — unlocks 1 free quick delivery/day + 50% OFF right after approval."}
        </span>
      </Link>
    );
  }
  const expired = vip.wasMember;
  return (
    <Link
      to="/vip"
      className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-primary/40 bg-accent p-3 text-xs font-semibold text-primary"
    >
      <Crown className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        {normalizedMode === "sunday_tuesday"
          ? expired
            ? `Your Campu VIP has expired! Renew for ${rupees(VIP_PRICE)} for ₹3 delivery on ₹${SCHEDULED_MIN_ORDER}–₹299 & FREE on ₹300+. →`
            : `Join Campu VIP (${rupees(VIP_PRICE)}): Sunday & Tuesday Special at ₹3 (₹${SCHEDULED_MIN_ORDER}–₹299) & FREE on ₹300+! →`
          : expired
            ? `Your Campu VIP has expired! Renew for ${rupees(VIP_PRICE)} to get 1 FREE quick delivery/day (no min) + ${VIP_QUICK_DISCOUNT_PCT}% OFF ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ orders. →`
            : `Join Campu VIP (${rupees(VIP_PRICE)}): ${VIP_QUICK_FREE_PER_DAY} FREE quick delivery daily (no min!) + ${VIP_QUICK_DISCOUNT_PCT}% OFF on ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ extra orders! →`}
      </span>
    </Link>
  );
}

/** Home page strip: strictly shows Quick VIP offer in Quick mode, and Sun/Tue Special offer in Sun/Tue mode. */
export function VipHomeBanner({ vip, mode }: { vip: Vip; mode?: DeliveryMode }) {
  const activeMode = useDeliveryMode();
  const resolvedMode = mode ?? activeMode;
  if (vip.loading || vip.pending) return null;
  if (vip.isVip) return <VipActiveBadge vip={vip} mode={resolvedMode} />;
  const expired = vip.wasMember;
  const isSpecial = resolvedMode === "sunday_tuesday";

  return (
    <Link
      to="/vip"
      className={`flex min-w-0 items-center gap-3 overflow-hidden rounded-2xl border p-3 shadow-card transition-colors ${
        expired ? "border-destructive/40 bg-destructive/10" : "border-primary/40 bg-accent"
      }`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-primary-foreground">
        <Crown className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block truncate font-bold">
          {expired
            ? "Your Campu VIP has expired!"
            : isSpecial
              ? "Sunday & Tuesday Special VIP Offer"
              : "Quick Delivery VIP Offer"}
        </span>
        <span className="block text-xs text-muted-foreground">
          {isSpecial
            ? expired
              ? `Renew for ${rupees(VIP_PRICE)} — get Sunday/Tuesday delivery at ₹3 (₹${SCHEDULED_MIN_ORDER}–₹299) & FREE on ₹300+.`
              : `${rupees(VIP_PRICE)}/30 days · Sun/Tue delivery at ₹3 on ₹${SCHEDULED_MIN_ORDER}–₹299 (was ₹15) & FREE on ₹300+ (was ₹10)!`
            : expired
              ? `Renew for ${rupees(VIP_PRICE)} — get 1 FREE quick delivery daily (any ₹) + ${VIP_QUICK_DISCOUNT_PCT}% OFF on ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ orders.`
              : `${rupees(VIP_PRICE)}/30 days · ${VIP_QUICK_FREE_PER_DAY} FREE quick delivery daily (no min!), then ${VIP_QUICK_DISCOUNT_PCT}% OFF on ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+!`}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-brand px-3.5 py-1.5 text-xs font-bold text-primary-foreground">
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
            ? `Renew for ${rupees(VIP_PRICE)} to unlock your daily free quick delivery + ${VIP_QUICK_DISCOUNT_PCT}% OFF!`
            : `Get Campu VIP at ${rupees(VIP_PRICE)} for 30 days:`}
        </p>
        <ul className="mt-4 space-y-2 rounded-2xl bg-muted/50 p-3.5 text-left text-sm">
          <li>
            ⚡ <b>1 FREE</b> quick delivery every day (any order amount!)
          </li>
          <li>
            🏷️ <b>{VIP_QUICK_DISCOUNT_PCT}% OFF</b> delivery on ₹{VIP_QUICK_DISCOUNT_MIN_ORDER}+ extra quick orders (normal ₹5 below ₹{VIP_QUICK_DISCOUNT_MIN_ORDER})
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

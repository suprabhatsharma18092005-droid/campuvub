import { Link } from "@tanstack/react-router";
import { Crown, X } from "lucide-react";
import { useEffect, useState } from "react";

import { rupees } from "@/lib/format";
import { SCHEDULED_MIN_ORDER, VIP_PRICE, VIP_QUICK_FREE_PER_DAY, VIP_QUICK_MIN_ORDER } from "@/lib/scheduled-fee";
import type { useVip } from "@/lib/vip";

type Vip = ReturnType<typeof useVip>;

export function formatVipDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** Small line under the delivery fee: VIP status or a pitch to join. */
export function VipCartHint({ vip, mode, subtotal }: { vip: Vip; mode: string; subtotal: number }) {
  if (vip.loading) return null;
  if (vip.isVip) {
    if (mode !== "quick") return <p className="mt-2 text-xs font-semibold text-primary">👑 Campu VIP pricing applied</p>;
    const left = Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday);
    return (
      <p className="mt-2 text-xs font-semibold text-primary">
        👑 VIP: {left}/{VIP_QUICK_FREE_PER_DAY} free quick deliveries left today
        {left > 0 && subtotal < VIP_QUICK_MIN_ORDER ? ` · add ₹${Math.ceil(VIP_QUICK_MIN_ORDER - subtotal)} more for FREE delivery` : ""}
      </p>
    );
  }
  return (
    <Link to="/vip" className="mt-3 flex items-center gap-2 rounded-xl border border-primary/40 bg-accent p-3 text-xs font-semibold text-primary">
      <Crown className="h-4 w-4 shrink-0" />
      <span>Get Campu VIP for {rupees(VIP_PRICE)}/month — FREE quick delivery & Sunday/Tuesday delivery from just ₹3 →</span>
    </Link>
  );
}

/** Home page strip: renewal reminder for expired members, pitch for everyone else, status for VIPs. */
export function VipHomeBanner({ vip }: { vip: Vip }) {
  if (vip.loading || vip.pending) return null;
  if (vip.isVip) return null;
  const expired = vip.wasMember;
  return (
    <Link to="/vip" className={`flex items-center gap-3 rounded-2xl border p-3 shadow-card ${expired ? "border-destructive/40 bg-destructive/10" : "border-primary/40 bg-accent"}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand text-primary-foreground"><Crown className="h-5 w-5" /></span>
      <span className="flex-1 text-sm">
        <span className="block font-bold">{expired ? "Your Campu VIP has expired" : "Join Campu VIP"}</span>
        <span className="block text-xs text-muted-foreground">
          {expired ? `Renew for ${rupees(VIP_PRICE)} to get your free deliveries back.` : `${rupees(VIP_PRICE)}/month · FREE quick delivery · Sunday/Tuesday from ₹3`}
        </span>
      </span>
      <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-primary-foreground">{expired ? "Renew" : "Join"}</span>
    </Link>
  );
}

const SEEN_KEY = "campu.vip-popup-seen";

/** Shown once every time the app is opened, to anyone without an active membership. */
export function VipPopup({ vip }: { vip: Vip }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (vip.loading || vip.isVip || vip.pending) return;
    if (sessionStorage.getItem(SEEN_KEY)) return;
    sessionStorage.setItem(SEEN_KEY, "1");
    setOpen(true);
  }, [vip.loading, vip.isVip, vip.pending]);
  if (!open) return null;
  const expired = vip.wasMember;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/50 p-5" role="dialog" aria-modal="true" aria-label="Campu VIP">
      <div className="relative w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-float">
        <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand text-primary-foreground"><Crown className="h-7 w-7" /></span>
        <h2 className="mt-3 font-display text-xl font-extrabold">{expired ? "Renew Campu VIP" : "Become a Campu VIP"}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{expired ? "Your membership has ended. Renew to keep saving on every order." : "Save on delivery every day for just one small monthly fee."}</p>
        <ul className="mt-4 space-y-2 text-left text-sm">
          <li>⚡ <b>FREE</b> quick delivery — {VIP_QUICK_FREE_PER_DAY} orders a day (₹{VIP_QUICK_MIN_ORDER}+)</li>
          <li>📦 Sunday/Tuesday: <b>₹3</b> on ₹{SCHEDULED_MIN_ORDER}–₹299 <s className="text-muted-foreground">₹15</s></li>
          <li>🎁 Sunday/Tuesday: <b>FREE</b> on ₹300+ <s className="text-muted-foreground">₹10</s></li>
        </ul>
        <Link to="/vip" onClick={() => setOpen(false)} className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-brand text-base font-bold text-primary-foreground shadow-float">
          {expired ? "Renew" : "Join"} for {rupees(VIP_PRICE)} / 30 days
        </Link>
        <button type="button" onClick={() => setOpen(false)} className="mt-2 text-xs font-semibold text-muted-foreground">Maybe later</button>
      </div>
    </div>
  );
}

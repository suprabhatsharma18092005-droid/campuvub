import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Calendar, CheckCircle2, Copy, Crown, Download, Sparkles, Star } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { formatVipDate } from "@/components/VipBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/format";
import { notifyVipRequest } from "@/lib/push.functions";
import { settingsQuery } from "@/lib/queries";
import { VIP_PRICE, VIP_QUICK_FREE_PER_DAY, VIP_QUICK_MIN_ORDER } from "@/lib/scheduled-fee";
import { useProfile, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useVip } from "@/lib/vip";

export const Route = createFileRoute("/_authenticated/vip")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Campu VIP — Free Delivery Membership" },
      {
        name: "description",
        content:
          "Join Campu VIP for ₹149/month: 1 free quick delivery per day on ₹50+ orders and Sunday/Tuesday delivery from ₹3.",
      },
      { property: "og:title", content: "Campu VIP — Free Delivery Membership" },
      {
        property: "og:description",
        content:
          "1 free quick delivery daily on ₹50+ orders and Sunday/Tuesday delivery from ₹3 for ₹149/month.",
      },
    ],
  }),
  component: VipPage,
});

const CONFETTI_PIECES = [
  { left: "10%", delay: "0s", color: "text-white/90" },
  { left: "24%", delay: "0.2s", color: "text-white" },
  { left: "40%", delay: "0.1s", color: "text-white/80" },
  { left: "58%", delay: "0.3s", color: "text-white/90" },
  { left: "76%", delay: "0.15s", color: "text-white" },
  { left: "88%", delay: "0.25s", color: "text-white/85" },
];

function VipPage() {
  const { session } = useSession();
  const { data: profile } = useProfile();
  const vip = useVip();
  const settings = useQuery(settingsQuery);
  const triggerVipPush = useServerFn(notifyVipRequest);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const price = Number(settings.data?.["vip_price"]) || VIP_PRICE;
  const upiId = settings.data?.["upi_id"] ?? "campu@upi";
  const qrValue = `upi://pay?pa=${upiId}&pn=${encodeURIComponent("Campu")}&am=${price}&cu=INR&tn=${encodeURIComponent("Campu VIP")}`;
  const utrValid = /^[0-9]{12}$/.test(utr);

  const memberName =
    profile?.full_name?.trim() ||
    (session?.user.user_metadata?.["full_name"] as string | undefined)?.trim() ||
    session?.user.email?.split("@")[0] ||
    "Royal Member";
  const freeLeft = Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday);

  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) {
      toast.error("QR code is still generating — try again.");
      return;
    }
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `Campu-VIP-${price}.png`;
    a.click();
    toast.success("QR code saved to your device");
  }

  async function submit() {
    if (!session || !utrValid || busy) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("vip_subscriptions")
      .insert({ user_id: session.user.id, utr_number: utr, amount: price })
      .select("id")
      .single();
    if (error) {
      setBusy(false);
      toast.error(error.code === "23505" ? "This UTR has already been used." : error.message);
      return;
    }
    if (data?.id) {
      await triggerVipPush({ data: { vipId: data.id } }).catch(() => undefined);
    }
    setBusy(false);
    setUtr("");
    toast.success("Request sent! VIP activates automatically once the admin verifies your payment.");
    void vip.refetch();
  }

  return (
    <AppShell>
      <div className="px-4 pb-8 pt-5">
        {vip.isVip ? (
          <div className="relative overflow-hidden rounded-3xl border border-primary/50 bg-royal p-6 text-white shadow-float">
            <div className="animate-gold-shimmer pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/30 via-white/80 to-primary/30" />
            {vip.justApproved && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                {CONFETTI_PIECES.map((c, idx) => (
                  <Sparkles
                    key={idx}
                    style={{ left: c.left, animationDelay: c.delay }}
                    className={cn("animate-confetti-pop absolute bottom-6 h-5 w-5", c.color)}
                  />
                ))}
              </div>
            )}

            <div className="relative flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-white/95">
                  <Sparkles className="animate-star-twinkle h-3.5 w-3.5 text-white/90" />
                  Active Royal VIP Member
                </div>
                <h1 className="mt-3 font-display text-2xl font-extrabold tracking-tight text-white">
                  {memberName}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/85">
                  {vip.startsAt && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-white/85" />
                      Active since: {formatVipDate(vip.startsAt)}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-white/95">
                    <CheckCircle2 className="h-3.5 w-3.5 text-white" />
                    Valid till: {vip.expiresAt ? formatVipDate(vip.expiresAt) : "—"}
                  </span>
                </div>
              </div>
              <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/25 bg-brand text-primary-foreground shadow-float">
                <Crown className="animate-crown-float h-8 w-8" />
                <Star className="animate-star-twinkle absolute -right-1.5 -top-1.5 h-4 w-4 fill-white text-white" />
              </div>
            </div>

            {vip.justApproved && (
              <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-white/25 bg-white/10 px-3.5 py-2.5 text-xs font-bold text-white">
                <span>✨ Approved live! Your Royal VIP perks are active now.</span>
                <button
                  type="button"
                  onClick={vip.dismissCelebration}
                  className="shrink-0 rounded-full bg-white/20 px-2.5 py-1 text-[11px] text-white hover:bg-white/30"
                >
                  Nice!
                </button>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-white/15 bg-black/25 p-3.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
                  Daily Quick Deliveries
                </p>
                <p className="mt-0.5 font-display text-lg font-extrabold text-white">
                  {freeLeft}/{VIP_QUICK_FREE_PER_DAY} Free Left Today
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">
                  Min Order Value
                </p>
                <p className="mt-0.5 font-display text-lg font-extrabold text-white">
                  {rupees(VIP_QUICK_MIN_ORDER)}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-3xl bg-brand p-5 text-primary-foreground shadow-float">
            <div className="flex items-center gap-2">
              <Crown className="h-6 w-6" />
              <h1 className="font-display text-2xl font-extrabold">Campu VIP</h1>
            </div>
            <p className="mt-2 text-sm">
              {vip.wasMember
                ? `Your Campu VIP has expired! Renew now for ${rupees(price)} to continue free deliveries.`
                : `${rupees(price)} for 30 days · ${VIP_QUICK_FREE_PER_DAY} FREE quick ${VIP_QUICK_FREE_PER_DAY === 1 ? "delivery" : "deliveries"} every day (Min ₹${VIP_QUICK_MIN_ORDER})`}
            </p>
          </div>
        )}

        <div className="royal-card mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="font-display text-lg font-bold">
            {vip.isVip ? "Your Active VIP Benefits" : "Benefits"}
          </h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-border text-sm">
            <BenefitRow label={`Quick delivery (Min ₹${VIP_QUICK_MIN_ORDER}, ${VIP_QUICK_FREE_PER_DAY}/day)`} normal="₹5" vip="FREE" />
            <BenefitRow label="Sunday/Tuesday ₹99–₹299" normal="₹15" vip="₹3" />
            <BenefitRow label="Sunday/Tuesday ₹300+" normal="₹10" vip="FREE" />
          </div>
        </div>

        {vip.pending ? (
          <div className="mt-4 rounded-2xl border border-primary/40 bg-accent p-4 text-sm">
            <p className="font-display text-base font-bold text-primary">
              ⏳ Payment Under Review · Verification Pending
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              UTR <b className="text-foreground">{vip.pending.utr_number}</b> submitted for{" "}
              {rupees(vip.pending.amount)}. Keep this page open — your Active Royal VIP Member Card will appear automatically the instant the admin approves.
            </p>
          </div>
        ) : !vip.isVip ? (
          <div className="royal-card mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
            <h2 className="font-display text-lg font-bold">
              {vip.wasMember ? "Renew membership" : "Join now"}
            </h2>
            <div className="mt-3 grid place-items-center">
              <div ref={qrRef} className="rounded-xl bg-white p-3">
                <QRCodeCanvas value={qrValue} size={200} marginSize={2} level="M" />
              </div>
            </div>
            <p className="mt-2 text-center text-xs font-bold text-primary">
              QR has {rupees(price)} pre-filled
            </p>
            <button
              type="button"
              onClick={download}
              className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-primary hover:bg-accent"
            >
              <Download className="h-4 w-4" /> Download QR Code
            </button>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="flex-1 truncate text-sm font-semibold">{upiId}</span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(upiId);
                  toast.success("UPI ID copied");
                }}
                className="inline-flex min-h-9 items-center gap-1 px-2 text-xs font-semibold text-primary"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <div className="mt-3 space-y-1 rounded-2xl border border-primary/25 bg-accent p-3 text-sm font-bold text-accent-foreground">
              <p>STEP 1: Download the QR code ({rupees(price)} pre-filled).</p>
              <p>STEP 2: Open any UPI app → Scan QR → choose it from your gallery and pay.</p>
              <p>STEP 3: Paste the 12-digit UTR below and tap Submit.</p>
            </div>
            <label htmlFor="vip-utr" className="mt-3 block text-sm font-semibold">
              Enter 12-digit UTR / Reference No.
            </label>
            <Input
              id="vip-utr"
              inputMode="numeric"
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))}
              placeholder="123456789012"
              className="mt-1 h-12 rounded-xl text-base tracking-widest"
            />
            <p
              className={cn(
                "mt-1 text-xs",
                utr.length === 0
                  ? "text-muted-foreground"
                  : utrValid
                    ? "text-success"
                    : "text-destructive",
              )}
            >
              {utr.length === 0
                ? "Required — find it in your UPI app's transaction details."
                : utrValid
                  ? "Looks good."
                  : `${utr.length}/12 digits`}
            </p>
            <Button
              disabled={!utrValid || busy}
              onClick={() => void submit()}
              className="mt-3 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float disabled:opacity-40"
            >
              {busy ? "Submitting…" : `Submit payment · ${rupees(price)}`}
            </Button>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}

function BenefitRow({ label, normal, vip }: { label: string; normal: string; vip: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2 last:border-0">
      <span>{label}</span>
      <span>
        <s className="mr-2 text-muted-foreground">{normal}</s>
        <b className="text-primary">{vip}</b>
      </span>
    </div>
  );
}

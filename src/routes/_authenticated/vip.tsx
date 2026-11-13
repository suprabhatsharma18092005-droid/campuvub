import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Crown, Download } from "lucide-react";
import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { formatVipDate } from "@/components/VipBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { rupees } from "@/lib/format";
import { settingsQuery } from "@/lib/queries";
import { VIP_PRICE, VIP_QUICK_FREE_PER_DAY } from "@/lib/scheduled-fee";
import { useSession } from "@/lib/session";
import { useVip } from "@/lib/vip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/vip")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Campu VIP — Free Delivery Membership" },
      { name: "description", content: "Join Campu VIP for ₹149/month: free quick delivery and Sunday/Tuesday delivery from ₹3." },
      { property: "og:title", content: "Campu VIP — Free Delivery Membership" },
      { property: "og:description", content: "Free quick delivery and Sunday/Tuesday delivery from ₹3 for ₹149/month." },
    ],
  }),
  component: VipPage,
});

function VipPage() {
  const { session } = useSession();
  const vip = useVip();
  const settings = useQuery(settingsQuery);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);
  const price = Number(settings.data?.["vip_price"]) || VIP_PRICE;
  const upiId = settings.data?.["upi_id"] ?? "campu@upi";
  const qrValue = `upi://pay?pa=${upiId}&pn=${encodeURIComponent("Campu")}&am=${price}&cu=INR&tn=${encodeURIComponent("Campu VIP")}`;
  const utrValid = /^[0-9]{12}$/.test(utr);

  function download() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return toast.error("QR code is still generating — try again.");
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `Campu-VIP-${price}.png`;
    a.click();
    toast.success("QR code saved to your device");
  }

  async function submit() {
    if (!session || !utrValid || busy) return;
    setBusy(true);
    const { error } = await supabase.from("vip_subscriptions").insert({ user_id: session.user.id, utr_number: utr, amount: price });
    setBusy(false);
    if (error) {
      toast.error(error.code === "23505" ? "This UTR has already been used." : error.message);
      return;
    }
    setUtr("");
    toast.success("Request sent! VIP activates once the admin verifies your payment.");
    void vip.refetch();
  }

  return (
    <AppShell>
      <div className="px-4 pt-5 pb-8">
        <div className="rounded-3xl bg-brand p-5 text-primary-foreground shadow-float">
          <div className="flex items-center gap-2"><Crown className="h-6 w-6" /><h1 className="font-display text-2xl font-extrabold">Campu VIP</h1></div>
          {vip.isVip ? (
            <>
              <p className="mt-2 text-sm font-semibold">Active · valid till {formatVipDate(vip.expiresAt!)}</p>
              <p className="mt-1 text-sm">Free quick deliveries left today: {Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday)}/{VIP_QUICK_FREE_PER_DAY}</p>
            </>
          ) : (
            <p className="mt-2 text-sm">{vip.wasMember ? "Your membership has expired — renew below." : `${rupees(price)} for 30 days`}</p>
          )}
        </div>

        <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="font-display text-lg font-bold">Benefits</h2>
          <div className="mt-2 overflow-hidden rounded-xl border border-border text-sm">
            <BenefitRow label="Quick delivery (₹99+, 2/day)" normal="₹5" vip="FREE" />
            <BenefitRow label="Sunday/Tuesday ₹99–₹299" normal="₹15" vip="₹3" />
            <BenefitRow label="Sunday/Tuesday ₹300+" normal="₹10" vip="FREE" />
          </div>
        </div>

        {vip.pending ? (
          <div className="mt-4 rounded-2xl border border-warning/40 bg-warning/15 p-4 text-sm font-semibold">
            ⏳ Payment submitted (UTR {vip.pending.utr_number}). Your VIP will activate as soon as the admin verifies it.
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
            <h2 className="font-display text-lg font-bold">{vip.isVip ? "Extend by 30 days" : vip.wasMember ? "Renew membership" : "Join now"}</h2>
            <div className="mt-3 grid place-items-center">
              <div ref={qrRef} className="rounded-xl bg-white p-3">
                <QRCodeCanvas value={qrValue} size={200} marginSize={2} level="M" />
              </div>
            </div>
            <p className="mt-2 text-center text-xs font-bold text-primary">QR has {rupees(price)} pre-filled</p>
            <button type="button" onClick={download} className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-primary hover:bg-accent">
              <Download className="h-4 w-4" /> Download QR Code
            </button>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
              <span className="flex-1 truncate text-sm font-semibold">{upiId}</span>
              <button type="button" onClick={() => { void navigator.clipboard.writeText(upiId); toast.success("UPI ID copied"); }} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>
            <div className="mt-3 space-y-1 rounded-2xl border border-warning/40 bg-warning/15 p-3 text-sm font-bold">
              <p>STEP 1: Download the QR code ({rupees(price)} pre-filled).</p>
              <p>STEP 2: Open any UPI app → Scan QR → choose it from your gallery and pay.</p>
              <p>STEP 3: Paste the 12-digit UTR below and tap Submit.</p>
            </div>
            <label htmlFor="vip-utr" className="mt-3 block text-sm font-semibold">Enter 12-digit UTR / Reference No.</label>
            <Input id="vip-utr" inputMode="numeric" value={utr} onChange={(e) => setUtr(e.target.value.replace(/\D/g, "").slice(0, 12))} placeholder="123456789012" className="mt-1 h-12 rounded-xl text-base tracking-widest" />
            <p className={cn("mt-1 text-xs", utr.length === 0 ? "text-muted-foreground" : utrValid ? "text-success" : "text-destructive")}>
              {utr.length === 0 ? "Required — find it in your UPI app's transaction details." : utrValid ? "Looks good." : `${utr.length}/12 digits`}
            </p>
            <Button disabled={!utrValid || busy} onClick={submit} className="mt-3 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float disabled:opacity-40">
              {busy ? "Submitting…" : `Submit payment · ${rupees(price)}`}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function BenefitRow({ label, normal, vip }: { label: string; normal: string; vip: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-2 last:border-0">
      <span>{label}</span>
      <span><s className="mr-2 text-muted-foreground">{normal}</s><b className="text-primary">{vip}</b></span>
    </div>
  );
}

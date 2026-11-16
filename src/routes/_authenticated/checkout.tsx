import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Check, Coins, Copy, Download, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { makeCoinReceiptUtr, useCoinWallet } from "@/lib/coins";
import { formatDeliveryDate, getDeliveryMode, sundayTuesdayDeliveryDate, useDeliveryMode } from "@/lib/delivery";
import { MODE_LABEL, deliveryInfoText, productInMode } from "@/lib/delivery";
import { useEnforceCartMode } from "@/lib/cart";
import { deliveryFee, makeOtp, rupees } from "@/lib/format";
import { settingsQuery } from "@/lib/queries";
import {
  QUICK_MIN_ORDER,
  SCHEDULED_MIN_ORDER,
  SCHEDULED_ORIGINAL_FEE,
  VIP_QUICK_FREE_PER_DAY,
  quickDeliveryFee,
  quickOrderMinimum,
  scheduledDeliveryFee,
} from "@/lib/scheduled-fee";
import { useVip } from "@/lib/vip";
import { VipCartHint } from "@/components/VipBanner";
import { isProfileComplete, useProfile, useSession } from "@/lib/session";
import { placeOrderWithPush } from "@/lib/push.functions";
import { cn } from "@/lib/utils";
import { CatalogImage } from "@/components/CatalogImage";


export const Route = createFileRoute("/_authenticated/checkout")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Checkout — Campu" },
      { name: "description", content: "Pay by UPI for ₹5 delivery or cash on delivery for ₹8." },
      { property: "og:title", content: "Checkout — Campu" },
      { property: "og:description", content: "Pay by UPI for ₹5 delivery or cash on delivery for ₹8." },
    ],
  }),
  component: Checkout,
});

function Checkout() {
  const queryClient = useQueryClient();
  const { items, subtotal, clear } = useCart();
  const { session } = useSession();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const settings = useQuery(settingsQuery);
  const { remaining } = usePreorder();
  const navigate = useNavigate();
  const submitOrder = useServerFn(placeOrderWithPush);
  const deliveryMode = useDeliveryMode();
  useEnforceCartMode();


  const [method, setMethod] = useState<"UPI" | "COD">("UPI");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [hostel, setHostel] = useState("");
  const [room, setRoom] = useState("");
  const [phone, setPhone] = useState("");

  const complete = isProfileComplete(profile);

  useEffect(() => {
    if (!profileLoading && !complete) {
      void navigate({ to: "/profile", search: { next: "checkout" }, replace: true });
    }
  }, [profileLoading, complete, navigate]);

  useEffect(() => {
    if (!profile) return;
    setHostel(profile.hostel_details ?? "");
    setRoom(profile.room_number ?? "");
    setPhone(profile.phone_number ?? "");
  }, [profile]);

  const vip = useVip();
  const wallet = useCoinWallet();
  const [useCoins, setUseCoins] = useState(false);
  const [coinAmountInput, setCoinAmountInput] = useState("");
  const scheduled = deliveryMode === "sunday_tuesday" ? scheduledDeliveryFee(subtotal, vip.isVip) : null;
  const quickMin = deliveryMode === "quick" ? quickOrderMinimum(subtotal) : null;
  const normalQuickFee = deliveryFee(settings.data, method);
  const fee = scheduled ? (scheduled.fee ?? 0) : quickDeliveryFee(normalQuickFee, subtotal, vip.isVip, vip.freeUsedToday);
  const nightMode = settings.data?.["night_mode_enabled"] === "true";
  const total = subtotal + fee;
  const maxUsableCoins = Math.min(wallet.balance, Math.max(0, Math.floor(total)));
  const requestedCoins =
    coinAmountInput.trim() === ""
      ? maxUsableCoins
      : Math.max(0, Math.min(maxUsableCoins, Math.floor(Number(coinAmountInput) || 0)));
  const coinsUsed = useCoins && maxUsableCoins > 0 ? requestedCoins : 0;
  const payableTotal = Math.max(0, total - coinsUsed);
  const paidFullyByCoins = coinsUsed > 0 && payableTotal === 0;
  const utrValid = /^[0-9]{12}$/.test(utr);
  const canPlace =
    items.length > 0 &&
    (!scheduled || scheduled.eligible) &&
    (!quickMin || quickMin.eligible) &&
    complete &&
    !editingAddress &&
    Boolean(hostel && room && phone) &&
    (paidFullyByCoins || method === "COD" || utrValid) &&
    !busy && !settings.isLoading && !settings.isError && !(nightMode && !paidFullyByCoins && method === "COD");

  const upiId = settings.data?.["upi_id"] ?? "campu@upi";
  // Dynamic per-order QR: encodes the live remaining payable total after Campu Coins.
  const upiQrValue = `upi://pay?pa=${upiId}&pn=${encodeURIComponent("Campu")}&am=${payableTotal}&cu=INR&tn=${encodeURIComponent("Campu Order")}`;
  const qrWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (nightMode && method === "COD") setMethod("UPI");
  }, [nightMode, method]);

  useEffect(() => {
    if (useCoins && wallet.balance === 0) {
      setUseCoins(false);
      setCoinAmountInput("");
    }
  }, [useCoins, wallet.balance]);


  async function saveAddress() {
    if (!session) return;
    const { error } = await supabase
      .from("profiles")
      .update({ hostel_details: hostel, room_number: room, phone_number: phone })
      .eq("id", session.user.id);
    if (error) {
      toast.error("Could not save the address");
      return;
    }
    setEditingAddress(false);
    toast.success("Delivery details updated");
  }

  async function placeOrder() {
    if (!session || busy) return;
    const { data: latest, error: settingsError } = await supabase.from("app_settings").select("key, value");
    if (settingsError) { toast.error("Could not check current ordering settings. Try again."); return; }
    const current = Object.fromEntries((latest ?? []).map(({ key, value }) => [key, value]));
    if (current["night_mode_enabled"] === "true" && method === "COD") {
      void settings.refetch();
      setMethod("UPI");
      toast.error("Cash on delivery is unavailable during night mode.");
      return;
    }
    const orderMode = getDeliveryMode();
    const fresh = (await vip.refetch()).data;
    const nowMs = Date.now();
    const freshVip = (fresh?.rows ?? []).some((r) => r.status === "approved" && r.starts_at && r.expires_at
      && new Date(r.starts_at).getTime() <= nowMs && new Date(r.expires_at).getTime() > nowMs);
    const sched = orderMode === "sunday_tuesday" ? scheduledDeliveryFee(subtotal, freshVip) : null;
    if (sched && !sched.eligible) {
      toast.error(`Minimum order is ₹${SCHEDULED_MIN_ORDER} for Sunday & Tuesday Special.`);
      return;
    }
    if (orderMode === "quick" && !quickOrderMinimum(subtotal).eligible) {
      toast.error(`Minimum order is ₹${QUICK_MIN_ORDER} for Quick Delivery.`);
      return;
    }
    const currentFee = sched ? (sched.fee ?? 0) : quickDeliveryFee(deliveryFee(current, method), subtotal, freshVip, fresh?.freeUsedToday ?? 0);
    if (currentFee !== fee) {
      void settings.refetch();
      toast.error("Delivery fee changed. Review your total before ordering.");
      return;
    }
    const { data: prods } = await supabase
      .from("products")
      .select("id, name, delivery_types, stock_quantity, in_stock")
      .in("id", items.map((i) => i.id));
    const prodMap = new Map((prods ?? []).map((p) => [p.id, p]));
    if (items.some((i) => !productInMode(prodMap.get(i.id)?.delivery_types, orderMode))) {
      toast.error("Some items aren't available for this delivery type and were removed.");
      return;
    }
    const shortItem = items.find((i) => {
      const p = prodMap.get(i.id);
      return !p || !p.in_stock || p.stock_quantity < i.qty;
    });
    if (shortItem) {
      const available = prodMap.get(shortItem.id)?.stock_quantity ?? 0;
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.error(
        available > 0
          ? `Only ${available} left for ${shortItem.name}. Please adjust your cart.`
          : `${shortItem.name} just went out of stock.`,
      );
      return;
    }
    setBusy(true);
    const effectiveMethod: "UPI" | "COD" = paidFullyByCoins ? "UPI" : method;
    let data: { id: string; coinsUsed?: number; coinsPersistedRemotely?: boolean };
    try {
      data = await submitOrder({ data: {
        cart_items: items,
        subtotal,
        payment_method: effectiveMethod,
        utr_number: paidFullyByCoins ? makeCoinReceiptUtr() : method === "UPI" ? utr : null,
        delivery_fee: currentFee,
        total: subtotal + currentFee,
        delivery_address: `${hostel}, Room ${room}`,
        phone_number: phone || null,
        delivery_otp: makeOtp(),
        status: effectiveMethod === "UPI" ? "payment_review" : "pending",
        delivery_type: orderMode,
        delivery_date: orderMode === "sunday_tuesday" ? sundayTuesdayDeliveryDate() : null,
        coins_used: coinsUsed,
      } });

      if (coinsUsed > 0 && data.id) {
        const usage = {
          orderId: data.id,
          userId: session.user.id,
          coinsUsed,
          orderTotal: subtotal + currentFee,
          payableAmount: Math.max(0, subtotal + currentFee - coinsUsed),
          paymentMethod: paidFullyByCoins ? ("COINS" as const) : effectiveMethod,
          refunded: false,
          createdAt: new Date().toISOString(),
        };
        if (!data.coinsPersistedRemotely) {
          await supabase.from("suggestions").insert({
            user_id: session.user.id,
            user_name: profile?.full_name?.trim() || "Student",
            suggestion_text: JSON.stringify({ type: "coin_order_spend", usage }),
          });
        }
      }
    } catch (error) {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.error(error instanceof Error ? error.message : "Could not place order");
      return;
    } finally { setBusy(false); }
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
    void wallet.refetch();
    clear();
    toast.success("Order placed!");
    void navigate({ to: "/orders/$id", params: { id: data.id } });

  }

  function getQrDataUrl(): string | null {
    const canvas = qrWrapRef.current?.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png") : null;
  }

  function downloadQrImage(): boolean {
    const dataUrl = getQrDataUrl();
    if (!dataUrl) {
      toast.error("QR code is still generating — try again in a second.");
      return false;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `Campu-Order-${payableTotal}.png`;
    a.click();
    return true;
  }

  function downloadQr() {
    if (downloadQrImage()) toast.success("QR code saved to your device");
  }

  function payViaPhonePe() {
    if (!downloadQrImage()) return;
    void navigator.clipboard.writeText(upiId).catch(() => {});
    toast.success("QR Code downloaded! Select it from your gallery in PhonePe to pay.");
    // Open PhonePe within the same user gesture — Chrome blocks app launches from
    // timers. On Android, the intent URL opens the PhonePe app directly (with a
    // web fallback if it isn't installed); other platforms use the custom scheme.
    const isAndroid = /android/i.test(navigator.userAgent);
    window.location.href = isAndroid
      ? `intent://scan/#Intent;scheme=phonepe;package=com.phonepe.app;S.browser_fallback_url=${encodeURIComponent("https://www.phonepe.com/")};end`
      : "phonepe://";
  }

  if (items.length === 0) {
    return (
      <AppShell>
        <div className="p-10 text-center text-sm text-muted-foreground">
          Your cart is empty — add something first.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <h1 className="font-display text-2xl font-bold">Checkout</h1>
        {settings.isError && <p className="mt-3 text-sm text-destructive">Ordering settings could not load. Please refresh.</p>}
        {remaining > 0 && <div className="mt-4"><PreorderNotice remaining={remaining} time={settings.data?.["order_start_time"]} /></div>}

        <div className="grid gap-5 md:mt-4 md:grid-cols-2 md:items-start md:gap-6">
          <div className="min-w-0">
        <div className="royal-card mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Delivering to
            </p>
            {!editingAddress && (
              <button
                type="button"
                onClick={() => setEditingAddress(true)}
                className="text-xs font-semibold text-primary"
              >
                Change
              </button>
            )}
          </div>

          {editingAddress ? (
            <div className="mt-3 space-y-2">
              <Input
                value={hostel}
                onChange={(e) => setHostel(e.target.value)}
                placeholder="Hostel / block"
                className="h-11 rounded-xl"
              />
              <Input
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                placeholder="Room number"
                className="h-11 rounded-xl"
              />
              <Input
                value={phone}
                inputMode="numeric"
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="Phone number"
                className="h-11 rounded-xl"
              />
              <div className="flex gap-2">
                <Button
                  onClick={() => void saveAddress()}
                  disabled={!hostel || !room || phone.length !== 10}
                  className="h-10 flex-1 rounded-full bg-brand text-primary-foreground"
                >
                  Save
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setHostel(profile?.hostel_details ?? "");
                    setRoom(profile?.room_number ?? "");
                    setPhone(profile?.phone_number ?? "");
                    setEditingAddress(false);
                  }}
                  className="h-10 rounded-full"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold">
                {hostel}, Room {room}
              </p>
              <p className="text-sm text-muted-foreground">+91 {phone}</p>
            </>
          )}
        </div>

        <div className="royal-card mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="font-display text-base font-bold">Your items</h2>
          <p className="mt-1 text-xs font-semibold text-primary">
            {MODE_LABEL[deliveryMode]} · {deliveryInfoText(deliveryMode, settings.data)}
          </p>
          <ul className="mt-3 space-y-3">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {it.image_url && (
                    <CatalogImage source={it.image_url} alt={it.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{it.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {it.qty} × {rupees(it.price)}
                  </p>
                </div>
                <span className="text-sm font-semibold">{rupees(it.qty * Number(it.price))}</span>
              </li>
            ))}
          </ul>
        </div>
          </div>

          <div className="min-w-0">
        {/* Campu Coins Wallet Selector */}
        <div className="royal-card mt-4 rounded-2xl border border-primary/35 bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <Coins className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">Campu Coins Wallet</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  Available: <strong className="text-primary">{wallet.balance} Coins</strong> ({rupees(wallet.balanceInr)})
                </p>
              </div>
            </div>
            {wallet.balance > 0 ? (
              <Switch
                checked={useCoins}
                onCheckedChange={(checked) => {
                  setUseCoins(checked);
                  if (checked) setCoinAmountInput(String(maxUsableCoins));
                }}
                aria-label="Use Campu Coins for this order"
              />
            ) : (
              <Link
                to="/coins"
                className="shrink-0 rounded-full bg-brand px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs"
              >
                Buy Coins
              </Link>
            )}
          </div>

          {useCoins && wallet.balance > 0 && (
            <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
              <div className="flex items-center gap-2">
                <Input
                  inputMode="numeric"
                  value={coinAmountInput}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    if (digits === "") {
                      setCoinAmountInput("");
                      return;
                    }
                    const clamped = Math.min(maxUsableCoins, Math.max(0, Number(digits)));
                    setCoinAmountInput(String(clamped));
                  }}
                  placeholder={`Up to ${maxUsableCoins}`}
                  className="h-10 flex-1 rounded-xl font-semibold tabular-nums"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setCoinAmountInput(String(maxUsableCoins))}
                  className="h-10 rounded-xl px-3 text-xs font-bold"
                >
                  Use Max ({maxUsableCoins})
                </Button>
              </div>
              <p className="text-xs font-semibold text-primary tabular-nums">
                Applying {coinsUsed} Coins = -{rupees(coinsUsed)} discount · Net payable: {rupees(payableTotal)}
              </p>
            </div>
          )}
        </div>

        <h2 className="mt-6 font-display text-lg font-bold">Payment method</h2>

        {paidFullyByCoins ? (
          <div className="royal-card mt-3 rounded-2xl border border-primary/40 bg-accent p-4 shadow-card">
            <p className="flex items-center gap-2 font-display text-base font-bold text-primary">
              <Coins className="h-5 w-5" /> 100% Covered by Campu Coins
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground tabular-nums">
              {coinsUsed} Coins ({rupees(coinsUsed)}) cover your entire order total. Remaining UPI/Cash amount: <strong>₹0</strong>.
            </p>
          </div>
        ) : (
        <>
        <div className="mt-3 space-y-3">
          <MethodCard
            active={method === "UPI"}
            onClick={() => setMethod("UPI")}
            title="UPI"
            badge="Recommended"
            subtitle={
              deliveryMode === "quick" && vip.isVip && vip.freeUsedToday < VIP_QUICK_FREE_PER_DAY
                ? "Delivery fee FREE (Campu VIP) — pay now and share your UTR."
                : `Delivery fee ${rupees(deliveryFee(settings.data, "UPI"))} — pay now and share your UTR.`
            }
          />
          {!nightMode && <MethodCard
            active={method === "COD"}
            onClick={() => setMethod("COD")}
            title="Cash on Delivery"
            subtitle={
              deliveryMode === "quick" && vip.isVip && vip.freeUsedToday < VIP_QUICK_FREE_PER_DAY
                ? "Delivery fee FREE (Campu VIP) — pay cash on delivery."
                : `Delivery fee ${rupees(deliveryFee(settings.data, "COD"))} — includes extra handling charge.`
            }
            warning
          />}
        </div>

        {method === "UPI" && (
          <div className="royal-card mt-4 rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="grid place-items-center">
              <div ref={qrWrapRef} className="rounded-xl bg-white p-3">
                <QRCodeCanvas value={upiQrValue} size={200} marginSize={2} level="M" />
              </div>
            </div>
            <p className="mt-2 text-center text-xs font-bold text-primary">
              ✨ Yeh QR code har naye order ke liye naya generate hota hai ({rupees(payableTotal)} Pre-filled)
            </p>
            <button
              type="button"
              onClick={() => void downloadQr()}
              className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-accent"
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
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
              >
                <Copy className="h-3.5 w-3.5" /> Copy
              </button>
            </div>

            <div className="mt-4">
              <button
                type="button"
                onClick={payViaPhonePe}
                className="mt-4 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-phonepe px-4 py-3 text-base font-semibold text-phonepe-foreground shadow-card transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <rect x="1" y="1" width="22" height="22" rx="6" fill="#5f259f" />
                    <text x="12" y="16.5" textAnchor="middle" fontSize="10" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">पे</text>
                  </svg>
                </span>
                <span>Pay {rupees(payableTotal)} via PhonePe</span>
              </button>
              <div className="mt-3 mb-4 space-y-2 rounded-2xl border border-warning/40 bg-warning/15 p-4 text-base font-bold leading-snug">
                <p>STEP 1: Tap the button above to Download the QR Code (Your payable amount of ₹{payableTotal} is pre-filled inside it).</p>
                <p>STEP 2: Open PhonePe → Tap 'Scan QR' → Choose the downloaded QR from your Gallery and complete the payment.</p>
                <p>STEP 3: Copy the 12-digit UTR number from PhonePe, paste it into the box below, and tap 'Place Order'.</p>
              </div>
              <label htmlFor="utr" className="text-sm font-semibold">
                Enter 12-digit UTR / Reference No.
              </label>
              <Input
                id="utr"
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
            </div>
          </div>
        )}

        {method === "COD" && !nightMode && (
          <div className="mt-4 flex gap-2 rounded-2xl border border-warning/40 bg-warning/15 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Cash on delivery includes an extra ₹3 handling charge. Keep exact change ready.</span>
          </div>
        )}
        </>
        )}

        <div className="royal-card mt-6 rounded-2xl border border-border bg-card p-4 shadow-card">
          <Row label={`Items (${items.length})`} value={rupees(subtotal)} />
          {scheduled ? (
            <div className="flex justify-between py-1 text-sm">
              <span className="text-muted-foreground">Delivery fee</span>
              <span className="font-semibold">
                <s className="mr-1.5 font-normal text-muted-foreground">{rupees(vip.isVip && scheduled.normalFee != null ? scheduled.normalFee : SCHEDULED_ORIGINAL_FEE)}</s>
                {scheduled.eligible ? (fee === 0 ? "FREE" : rupees(fee)) : "—"}
              </span>
            </div>
          ) : (
            fee < normalQuickFee ? (
              <div className="flex justify-between py-1 text-sm">
                <span className="text-muted-foreground">Delivery fee ({paidFullyByCoins ? "Coins" : method}) · VIP 👑</span>
                <span className="font-semibold"><s className="mr-1.5 font-normal text-muted-foreground">{rupees(normalQuickFee)}</s>FREE</span>
              </div>
            ) : (
              <Row label={`Delivery fee (${paidFullyByCoins ? "UPI rate" : method})`} value={rupees(fee)} />
            )
          )}
          {coinsUsed > 0 && (
            <Row label={`Campu Coins (${coinsUsed} used)`} value={`-${rupees(coinsUsed)}`} />
          )}
          {scheduled && !scheduled.eligible && (
            <p className="mt-1 text-xs font-semibold text-destructive">
              Minimum order is ₹{SCHEDULED_MIN_ORDER} for Sunday & Tuesday Special. Add ₹{scheduled.shortBy} more to place your order.
            </p>
          )}
          {quickMin && !quickMin.eligible && (
            <p className="mt-1 text-xs font-semibold text-destructive">
              Minimum order is ₹{QUICK_MIN_ORDER} for Quick Delivery. Add ₹{quickMin.shortBy} more to place your order.
            </p>
          )}
          <VipCartHint vip={vip} mode={deliveryMode} subtotal={subtotal} />
          <div className="my-2 h-px bg-border" />
          <Row label="Net payable" value={rupees(payableTotal)} bold />
        </div>

        <Button
          disabled={!canPlace}
          onClick={placeOrder}
          className="mt-4 h-13 w-full rounded-full bg-brand py-3.5 text-base font-semibold text-primary-foreground shadow-float hover:opacity-95 disabled:opacity-40"
        >
          {busy
            ? "Placing order…"
            : paidFullyByCoins
              ? `Place order · ${coinsUsed} Coins (₹0)`
              : coinsUsed > 0
                ? `Place order · ${rupees(payableTotal)} + ${coinsUsed} Coins`
                : `Place order · ${rupees(total)}`}
        </Button>
        {!paidFullyByCoins && method === "UPI" && !utrValid && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Enter a valid 12-digit UTR to enable checkout.
          </p>
        )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className={bold ? "font-bold" : "text-muted-foreground"}>{label}</span>
      <span className={bold ? "font-display text-base font-extrabold" : "font-semibold"}>{value}</span>
    </div>
  );
}

function MethodCard({
  active,
  onClick,
  title,
  subtitle,
  badge,
  warning,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: string;
  warning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all",
        active ? "border-primary bg-accent shadow-card" : "border-border bg-card",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
          active ? "border-primary bg-brand" : "border-border",
        )}
      >
        {active && <Check className="h-3 w-3 text-primary-foreground" />}
      </span>
      <span className="flex-1">
        <span className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge && (
            <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
              {badge}
            </span>
          )}
        </span>
        <span className={cn("mt-0.5 block text-xs", warning ? "text-warning-foreground" : "text-muted-foreground")}>
          {subtitle}
        </span>
      </span>
    </button>
  );
}

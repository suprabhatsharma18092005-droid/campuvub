import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Coins,
  Copy,
  Download,
  History,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  COIN_PRESETS,
  COIN_VALUE_INR,
  MIN_COIN_PURCHASE,
  useCoinWallet,
  validateCoinPurchaseInput,
} from "@/lib/coins";
import {
  queueCoinPurchaseNotification,
  submitCoinPurchaseRequest,
} from "@/lib/coins.functions";
import { rupees } from "@/lib/format";
import { settingsQuery } from "@/lib/queries";
import { useProfile, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/coins")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Campu Coins Wallet — Buy & Spend Coins" },
      {
        name: "description",
        content:
          "Buy Campu Coins (1 Coin = ₹1, minimum ₹50) via UPI and spend them seamlessly on your campus orders.",
      },
      { property: "og:title", content: "Campu Coins Wallet" },
      {
        property: "og:description",
        content: "1 Coin = ₹1 · Minimum recharge ₹50 · Instant checkout discount.",
      },
    ],
  }),
  component: CoinsPage,
});

function CoinsPage() {
  const { session } = useSession();
  const { data: profile } = useProfile();
  const queryClient = useQueryClient();
  const wallet = useCoinWallet();
  const settings = useQuery(settingsQuery);
  const submitCoinTopup = useServerFn(submitCoinPurchaseRequest);
  const queueCoinNotify = useServerFn(queueCoinPurchaseNotification);

  const [coinText, setCoinText] = useState("100");
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const parsedCoins = coinText.trim() === "" ? 0 : Math.floor(Number(coinText));
  const payableAmount = parsedCoins * COIN_VALUE_INR;
  const amountError =
    coinText.trim() === ""
      ? `Enter coins to buy (minimum ₹${MIN_COIN_PURCHASE}).`
      : validateCoinPurchaseInput(parsedCoins, payableAmount);
  const amountValid = amountError === null;

  const upiId = settings.data?.["upi_id"] ?? "campu@upi";
  const safeAm = amountValid ? payableAmount : MIN_COIN_PURCHASE * COIN_VALUE_INR;
  const safeCoins = amountValid ? parsedCoins : MIN_COIN_PURCHASE;
  const qrValue = `upi://pay?pa=${upiId}&pn=${encodeURIComponent("Campu")}&am=${safeAm}&cu=INR&tn=${encodeURIComponent(`Campu ${safeCoins} Coins`)}`;
  const utrValid = /^[0-9]{12}$/.test(utr);

  function getQrDataUrl(): string | null {
    const canvas = qrRef.current?.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png") : null;
  }

  function downloadQr() {
    if (!amountValid) {
      toast.error(amountError ?? `Minimum purchase is ₹${MIN_COIN_PURCHASE}.`);
      return;
    }
    const dataUrl = getQrDataUrl();
    if (!dataUrl) {
      toast.error("QR code is still generating — try again in a second.");
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `Campu-Coins-${parsedCoins}-INR-${payableAmount}.png`;
    a.click();
    toast.success("QR code saved to your device");
  }

  function payViaPhonePe() {
    if (!amountValid) {
      toast.error(amountError ?? `Minimum purchase is ₹${MIN_COIN_PURCHASE}.`);
      return;
    }
    const dataUrl = getQrDataUrl();
    if (!dataUrl) {
      toast.error("QR code is still generating — try again in a second.");
      return;
    }
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `Campu-Coins-${parsedCoins}.png`;
    a.click();
    void navigator.clipboard.writeText(upiId).catch(() => {});
    toast.success("QR Code downloaded! Select it from your gallery in PhonePe to pay.");
    const isAndroid = /android/i.test(navigator.userAgent);
    window.location.href = isAndroid
      ? `intent://scan/#Intent;scheme=phonepe;package=com.phonepe.app;S.browser_fallback_url=${encodeURIComponent("https://www.phonepe.com/")};end`
      : "phonepe://";
  }

  async function handleSubmit() {
    if (!session || busy) return;
    if (!amountValid) {
      toast.error(amountError ?? `Minimum purchase is ₹${MIN_COIN_PURCHASE}.`);
      return;
    }
    if (!utrValid) {
      toast.error("Enter a valid 12-digit UTR / reference number.");
      return;
    }
    if (wallet.pendingRequest) {
      toast.error("You already have a coin payment waiting for verification.");
      return;
    }

    setBusy(true);
    const requestId = crypto.randomUUID();
    const customerName =
      profile?.full_name?.trim() ||
      (session.user.user_metadata?.["full_name"] as string | undefined)?.trim() ||
      session.user.email?.split("@")[0] ||
      "Student";

    try {
      const serverResult = await submitCoinTopup({
        data: {
          coins: parsedCoins,
          amount: payableAmount,
          utrNumber: utr,
          requestId,
        },
      });

      // Mirror in suggestions so admin always sees the request immediately via RLS
      // even if server service-role key isn't configured in this environment.
      const reqPayload = serverResult.request ?? {
        id: requestId,
        userId: session.user.id,
        userName: customerName,
        phone: profile?.phone_number ?? null,
        coins: parsedCoins,
        amount: payableAmount,
        utrNumber: utr,
        status: "pending" as const,
        createdAt: new Date().toISOString(),
      };

      const { error: sugErr } = await supabase.from("suggestions").insert({
        user_id: session.user.id,
        user_name: customerName,
        suggestion_text: JSON.stringify({
          type: "coin_purchase_request",
          request: reqPayload,
        }),
      });
      if (sugErr && !serverResult.persistedRemotely) {
        throw new Error(sugErr.message);
      }

      setUtr("");
      await wallet.refetch();
      void queryClient.invalidateQueries({ queryKey: ["app_settings"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-coins"] });
      toast.success(
        `Request sent for ${parsedCoins} Coins (${rupees(payableAmount)})! Coins credit automatically once verified.`,
      );
      // Fire-and-forget queued notification so payment submission never waits or fails.
      void queueCoinNotify({
        data: {
          requestId: reqPayload.id,
          coins: reqPayload.coins,
          amount: reqPayload.amount,
          utrNumber: reqPayload.utrNumber,
          customerName: reqPayload.userName,
        },
      }).catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit coin payment request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">
        {/* Wallet Balance Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-primary/40 bg-royal p-5 text-white shadow-float">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-white/75">
                Campu Coins Wallet
              </p>
              <div className="mt-2 flex items-baseline gap-2.5">
                <span className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-white">
                  {wallet.loading ? "—" : wallet.balance}
                </span>
                <span className="text-base font-bold text-white/90">Coins</span>
              </div>
              <p className="mt-1 text-sm font-medium text-white/85 tabular-nums">
                Worth {rupees(wallet.balanceInr)} · 1 Coin = ₹1
              </p>
            </div>
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/25 bg-brand text-primary-foreground shadow-card">
              <Coins className="h-7 w-7" />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs text-white/85">
            <span>Min recharge: ₹{MIN_COIN_PURCHASE} ({MIN_COIN_PURCHASE} Coins)</span>
            <Link to="/checkout" className="font-bold text-white underline-offset-4 hover:underline">
              Use at Checkout →
            </Link>
          </div>
        </div>

        {/* Pending Verification Banner */}
        {wallet.pendingRequest && (
          <div className="mt-4 rounded-2xl border border-primary/40 bg-accent p-4 text-sm shadow-card">
            <p className="font-display text-base font-bold text-primary">
              Payment Under Review · Verification Pending
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Buying <b className="text-foreground tabular-nums">{wallet.pendingRequest.coins} Coins</b>{" "}
              for <b className="text-foreground tabular-nums">{rupees(wallet.pendingRequest.amount)}</b>{" "}
              · UTR <b className="font-mono text-foreground">{wallet.pendingRequest.utrNumber}</b>. Your
              balance will update automatically the instant the admin verifies your payment.
            </p>
          </div>
        )}

        {/* Buy Coins Section (Same Verified Flow as VIP Pass) */}
        {!wallet.pendingRequest && (
          <div className="royal-card mt-4 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h1 className="font-display text-lg font-bold">Buy Campu Coins</h1>
                <p className="text-xs text-muted-foreground">
                  1 Coin = ₹1 · Minimum purchase ₹{MIN_COIN_PURCHASE} · Exact INR payment required
                </p>
              </div>
              <Wallet className="h-5 w-5 shrink-0 text-primary" />
            </div>

            {/* Quick Amount Presets */}
            <div className="mt-4 grid grid-cols-4 gap-2">
              {COIN_PRESETS.map((preset) => {
                const active = parsedCoins === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCoinText(String(preset))}
                    className={cn(
                      "min-h-11 rounded-xl border px-2 py-2 text-center transition-all",
                      active
                        ? "border-primary bg-brand text-primary-foreground shadow-xs"
                        : "border-border bg-background text-foreground hover:bg-muted/60",
                    )}
                  >
                    <span className="block font-display text-sm font-extrabold tabular-nums">
                      {preset}
                    </span>
                    <span
                      className={cn(
                        "block text-[11px] tabular-nums",
                        active ? "text-primary-foreground/85" : "text-muted-foreground",
                      )}
                    >
                      ₹{preset * COIN_VALUE_INR}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Custom Coin Input + Locked 1:1 Parity */}
            <div className="mt-4">
              <label htmlFor="coin-amount-input" className="block text-sm font-semibold">
                Enter Coins / Amount (Min ₹{MIN_COIN_PURCHASE})
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="coin-amount-input"
                  inputMode="numeric"
                  value={coinText}
                  onChange={(e) => setCoinText(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="e.g. 100"
                  className="h-12 flex-1 rounded-xl text-base font-bold tabular-nums"
                />
                <div className="rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-right">
                  <p className="text-[11px] text-muted-foreground">Pay exact</p>
                  <p className="font-display text-sm font-extrabold text-primary tabular-nums">
                    {amountValid ? rupees(payableAmount) : "—"}
                  </p>
                </div>
              </div>
              {!amountValid ? (
                <p className="mt-1.5 text-xs font-semibold text-destructive">{amountError}</p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {parsedCoins} Coins = {rupees(payableAmount)} (cannot pay less than{" "}
                  {rupees(payableAmount)})
                </p>
              )}
            </div>

            {/* Pre-filled QR + PhonePe + UTR */}
            <div className={cn("mt-5 transition-opacity", !amountValid && "pointer-events-none opacity-45")}>
              <div className="grid place-items-center">
                <div ref={qrRef} className="rounded-2xl border border-border bg-white p-3">
                  <QRCodeCanvas value={qrValue} size={200} marginSize={2} level="M" />
                </div>
              </div>
              <p className="mt-2 text-center text-xs font-bold text-primary tabular-nums">
                QR has {rupees(safeAm)} ({safeCoins} Coins) pre-filled
              </p>

              <button
                type="button"
                disabled={!amountValid}
                onClick={downloadQr}
                className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-primary hover:bg-accent disabled:opacity-50"
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

              <button
                type="button"
                disabled={!amountValid}
                onClick={payViaPhonePe}
                className="mt-3 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-phonepe px-4 py-3 text-base font-semibold text-phonepe-foreground shadow-card transition-opacity hover:opacity-95 disabled:opacity-50"
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                    <rect x="1" y="1" width="22" height="22" rx="6" fill="#5f259f" />
                    <text
                      x="12"
                      y="16.5"
                      textAnchor="middle"
                      fontSize="10"
                      fontWeight="700"
                      fill="#ffffff"
                      fontFamily="system-ui, sans-serif"
                    >
                      पे
                    </text>
                  </svg>
                </span>
                <span>Pay {rupees(safeAm)} via PhonePe</span>
              </button>

              <div className="mt-3 space-y-1 rounded-2xl border border-primary/25 bg-accent p-3 text-xs font-bold leading-relaxed text-accent-foreground sm:text-sm">
                <p>STEP 1: Download QR code ({rupees(safeAm)} for {safeCoins} Coins pre-filled).</p>
                <p>STEP 2: Open any UPI app → Scan QR from gallery and pay the exact amount.</p>
                <p>STEP 3: Paste the 12-digit UTR below and tap Submit.</p>
              </div>

              <label htmlFor="coin-utr" className="mt-4 block text-sm font-semibold">
                Enter 12-digit UTR / Reference No.
              </label>
              <Input
                id="coin-utr"
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
                disabled={!amountValid || !utrValid || busy}
                onClick={() => void handleSubmit()}
                className="mt-4 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float disabled:opacity-40"
              >
                {busy
                  ? "Submitting…"
                  : `Submit payment · ${rupees(safeAm)} (${safeCoins} Coins)`}
              </Button>
            </div>
          </div>
        )}

        {/* Recent Top-up Requests & Wallet Ledger */}
        {(wallet.requests.length > 0 || wallet.transactions.length > 0) && (
          <div className="mt-5 rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-bold">
              <History className="h-4 w-4 text-primary" />
              Wallet Activity
            </h2>

            {wallet.requests.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Recharge Requests
                </p>
                {wallet.requests.slice(0, 10).map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background px-3.5 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums">
                        {req.coins} Coins · {rupees(req.amount)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        UTR {req.utrNumber} ·{" "}
                        {new Date(req.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          timeZone: "Asia/Kolkata",
                        })}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-bold capitalize",
                        req.status === "approved"
                          ? "text-success"
                          : req.status === "rejected"
                            ? "text-destructive"
                            : "text-primary",
                      )}
                    >
                      {req.status === "approved" ? "Credited" : req.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {wallet.transactions.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Coin History
                </p>
                {wallet.transactions.slice(0, 20).map((tx) => {
                  const isCredit = tx.coins > 0;
                  return (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between gap-3 border-b border-border/60 py-2.5 last:border-0"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-xl",
                            tx.type === "order_refund"
                              ? "bg-accent text-primary"
                              : isCredit
                                ? "bg-success/15 text-success"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {tx.type === "order_refund" ? (
                            <RotateCcw className="h-4 w-4" />
                          ) : isCredit ? (
                            <ArrowDownLeft className="h-4 w-4" />
                          ) : (
                            <ArrowUpRight className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{tx.note}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleString("en-IN", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Asia/Kolkata",
                            })}
                          </p>
                        </div>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 font-display text-sm font-extrabold tabular-nums",
                          isCredit ? "text-success" : "text-foreground",
                        )}
                      >
                        {isCredit ? `+${tx.coins}` : tx.coins}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

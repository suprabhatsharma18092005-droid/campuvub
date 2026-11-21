import { Link } from "@tanstack/react-router";
import { Banknote, BellRing, Coins } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CoinTopupRequest } from "@/lib/coins";
import type { DeliveryPayoutRequest } from "@/lib/delivery-boy";
import { ringingCoinRequestIds, ringingOrderIds, ringingPayoutIds } from "@/lib/order-siren";

const ACK_KEY = "campu-admin-acknowledged-orders";

function loadAcks(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

let sharedCtx: AudioContext | null = null;
function audioCtx() {
  if (!sharedCtx) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctx();
  }
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

function ring() {
  try {
    const ctx = audioCtx();
    [880, 1320, 880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.25;
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.24);
    });
    navigator.vibrate?.([300, 150, 300]);
  } catch {
    /* audio unavailable */
  }
}

/** Keeps ringing (sound + flashing tab title) while recent orders, coin requests, or payout requests are unacknowledged. */
export function OrderSiren({
  orders,
  coinRequests = [],
  payoutRequests = [],
  enabled,
}: {
  orders: { id: string; status: string; created_at: string }[];
  coinRequests?: CoinTopupRequest[];
  payoutRequests?: DeliveryPayoutRequest[];
  enabled: boolean;
}) {
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [audioReady, setAudioReady] = useState(false);
  const baseTitle = useRef<string>("");

  useEffect(() => setAcks(loadAcks()), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Unlock audio on the first tap anywhere (mobile browsers block autoplay).
  useEffect(() => {
    const unlock = () => {
      try {
        audioCtx();
        setAudioReady(true);
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const ringingOrders = useMemo(() => ringingOrderIds(orders, acks, now), [orders, acks, now]);
  const ringingCoins = useMemo(
    () => ringingCoinRequestIds(coinRequests, acks, now),
    [coinRequests, acks, now],
  );
  const ringingPayouts = useMemo(
    () => ringingPayoutIds(payoutRequests, acks, now),
    [payoutRequests, acks, now],
  );
  const totalCount = ringingOrders.length + ringingCoins.length + ringingPayouts.length;
  const active = totalCount > 0;

  useEffect(() => {
    if (!active || !enabled) return;
    ring();
    const t = setInterval(ring, 2500);
    return () => clearInterval(t);
  }, [active, enabled]);

  useEffect(() => {
    if (!active) return;
    baseTitle.current = document.title;
    let on = false;
    const label =
      ringingPayouts.length > 0 && ringingOrders.length === 0 && ringingCoins.length === 0
        ? `💸 (${ringingPayouts.length}) PAYOUT REQUEST! - Campu`
        : ringingCoins.length > 0 && ringingOrders.length === 0 && ringingPayouts.length === 0
          ? `🪙 (${ringingCoins.length}) COIN REQUEST! - Campu`
          : ringingOrders.length > 0 && ringingCoins.length === 0 && ringingPayouts.length === 0
            ? `🔴 (${ringingOrders.length}) NEW ORDER! - Campu`
            : `🔴 (${totalCount}) NEW ALERTS! - Campu`;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? label : baseTitle.current;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle.current;
    };
  }, [active, totalCount, ringingOrders.length, ringingCoins.length, ringingPayouts.length]);

  function acknowledge() {
    const next = new Set(acks);
    ringingOrders.forEach((id) => next.add(id));
    ringingCoins.forEach((id) => next.add(`coin:${id}`));
    ringingPayouts.forEach((id) => next.add(`payout:${id}`));
    const kept = [...next].slice(-500);
    localStorage.setItem(ACK_KEY, JSON.stringify(kept));
    setAcks(new Set(kept));
  }

  if (!active) return null;

  const parts: string[] = [];
  if (ringingOrders.length > 0) {
    parts.push(`${ringingOrders.length} order${ringingOrders.length > 1 ? "s" : ""}`);
  }
  if (ringingCoins.length > 0) {
    parts.push(`${ringingCoins.length} coin recharge${ringingCoins.length > 1 ? "s" : ""}`);
  }
  if (ringingPayouts.length > 0) {
    parts.push(`${ringingPayouts.length} payout request${ringingPayouts.length > 1 ? "s" : ""}`);
  }
  const headline = `${parts.join(" & ")} waiting!`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-[3.35rem] z-40 px-4 sm:top-[4.15rem]"
    >
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-wrap items-center gap-3 rounded-2xl border-2 border-destructive bg-card px-4 py-3 text-card-foreground shadow-float">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-destructive" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-destructive" />
          {ringingPayouts.length > 0 && ringingOrders.length === 0 && ringingCoins.length === 0 ? (
            <Banknote className="h-5 w-5" />
          ) : ringingCoins.length > 0 && ringingOrders.length === 0 && ringingPayouts.length === 0 ? (
            <Coins className="h-5 w-5" />
          ) : (
            <BellRing className="h-5 w-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-extrabold text-destructive">{headline}</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? audioReady
                ? "Siren rings until you acknowledge."
                : "Tap anywhere to enable sound."
              : "Alerts are off."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ringingCoins.length > 0 && (
            <Link
              to="/admin"
              search={{ tab: "coins" }}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              Review Coins
            </Link>
          )}
          {ringingPayouts.length > 0 && (
            <Link
              to="/admin"
              search={{ tab: "delivery" }}
              className="inline-flex h-9 items-center rounded-full border border-destructive/40 bg-background px-3.5 text-xs font-bold text-destructive hover:bg-accent"
            >
              Review Payouts
            </Link>
          )}
          <Button
            size="sm"
            onClick={acknowledge}
            className="h-9 rounded-full bg-destructive px-4 font-bold text-destructive-foreground shadow-xs hover:opacity-90"
          >
            Acknowledge
          </Button>
        </div>
      </div>
    </div>
  );
}

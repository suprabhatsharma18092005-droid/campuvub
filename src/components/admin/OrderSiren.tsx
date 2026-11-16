import { Link } from "@tanstack/react-router";
import { BellRing, Coins } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CoinTopupRequest } from "@/lib/coins";
import { ringingCoinRequestIds, ringingOrderIds } from "@/lib/order-siren";

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

/** Keeps ringing (sound + flashing tab title) while recent orders or coin requests are unacknowledged. */
export function OrderSiren({
  orders,
  coinRequests = [],
  enabled,
}: {
  orders: { id: string; status: string; created_at: string }[];
  coinRequests?: CoinTopupRequest[];
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
  const totalCount = ringingOrders.length + ringingCoins.length;
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
      ringingCoins.length > 0 && ringingOrders.length === 0
        ? `🪙 (${ringingCoins.length}) COIN REQUEST! - Campu`
        : ringingCoins.length > 0
          ? `🔴 (${totalCount}) ORDER + COIN ALERT! - Campu`
          : `🔴 (${ringingOrders.length}) NEW ORDER! - Campu`;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? label : baseTitle.current;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle.current;
    };
  }, [active, totalCount, ringingOrders.length, ringingCoins.length]);

  function acknowledge() {
    const next = new Set(acks);
    ringingOrders.forEach((id) => next.add(id));
    ringingCoins.forEach((id) => next.add(`coin:${id}`));
    const kept = [...next].slice(-500);
    localStorage.setItem(ACK_KEY, JSON.stringify(kept));
    setAcks(new Set(kept));
  }

  if (!active) return null;

  const headline =
    ringingOrders.length > 0 && ringingCoins.length > 0
      ? `${ringingOrders.length} order${ringingOrders.length > 1 ? "s" : ""} & ${ringingCoins.length} coin recharge${ringingCoins.length > 1 ? "s" : ""} waiting!`
      : ringingCoins.length > 0
        ? `${ringingCoins.length} new coin recharge${ringingCoins.length > 1 ? "s" : ""} waiting!`
        : `${ringingOrders.length} new order${ringingOrders.length > 1 ? "s" : ""} waiting!`;

  return (
    <div className="sticky top-12 z-20 mt-3 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-destructive bg-destructive/10 p-3 shadow-card animate-pulse">
      {ringingCoins.length > 0 && ringingOrders.length === 0 ? (
        <Coins className="h-6 w-6 shrink-0 text-destructive" />
      ) : (
        <BellRing className="h-6 w-6 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-destructive">{headline}</p>
        <p className="text-xs text-muted-foreground">
          {enabled
            ? audioReady
              ? "Siren rings until you acknowledge."
              : "Tap anywhere to enable sound."
            : "Alerts are off."}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {ringingCoins.length > 0 && (
          <Link
            to="/admin"
            search={{ tab: "coins" }}
            className="inline-flex h-8 items-center rounded-full border border-destructive/40 bg-background px-3 text-xs font-bold text-destructive hover:bg-accent"
          >
            Review Coins
          </Link>
        )}
        <Button
          size="sm"
          onClick={acknowledge}
          className="rounded-full bg-destructive text-destructive-foreground hover:opacity-90"
        >
          Acknowledge
        </Button>
      </div>
    </div>
  );
}

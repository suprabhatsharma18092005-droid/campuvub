import { BellRing } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ringingOrderIds } from "@/lib/order-siren";

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

/** Keeps ringing (sound + flashing tab title) while recent new orders are unacknowledged. */
export function OrderSiren({
  orders,
  enabled,
}: {
  orders: { id: string; status: string; created_at: string }[];
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

  const ringing = useMemo(() => ringingOrderIds(orders, acks, now), [orders, acks, now]);
  const active = ringing.length > 0;

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
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `🔴 (${ringing.length}) NEW ORDER! - Campu` : baseTitle.current;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = baseTitle.current;
    };
  }, [active, ringing.length]);

  function acknowledge() {
    const next = new Set(acks);
    ringing.forEach((id) => next.add(id));
    const kept = [...next].slice(-500);
    localStorage.setItem(ACK_KEY, JSON.stringify(kept));
    setAcks(new Set(kept));
  }

  if (!active) return null;
  return (
    <div className="sticky top-12 z-20 mt-3 flex items-center gap-3 rounded-2xl border-2 border-destructive bg-destructive/10 p-3 shadow-card animate-pulse">
      <BellRing className="h-6 w-6 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-destructive">
          {ringing.length} new order{ringing.length > 1 ? "s" : ""} waiting!
        </p>
        <p className="text-xs text-muted-foreground">
          {enabled ? (audioReady ? "Siren rings until you acknowledge." : "Tap anywhere to enable sound.") : "Alerts are off."}
        </p>
      </div>
      <Button size="sm" onClick={acknowledge} className="rounded-full bg-destructive text-destructive-foreground hover:opacity-90">
        Acknowledge
      </Button>
    </div>
  );
}

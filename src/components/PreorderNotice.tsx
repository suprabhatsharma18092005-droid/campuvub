import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";
import { useEffect, useState } from "react";

import { settingsQuery } from "@/lib/queries";
import { countdownLabel, openingCountdown } from "@/lib/ordering";

export function usePreorder() {
  const settings = useQuery(settingsQuery);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return { settings, remaining: now === null ? 0 : openingCountdown(settings.data?.["order_start_time"], now) };
}

export function PreorderNotice({ remaining, time }: { remaining: number; time?: string | undefined }) {
  if (remaining <= 0) return null;
  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-foreground">
      <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-primary" /> Pre-order</div>
      <p className="mt-1 text-sm text-muted-foreground">Orders open at {time} IST. You can prepare your cart now.</p>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums" aria-label={`Orders open in ${countdownLabel(remaining)}`}>
        {countdownLabel(remaining)}
      </p>
    </div>
  );
}
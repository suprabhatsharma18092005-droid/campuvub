import { deliveryLabel, formatDeliveryDate } from "@/lib/delivery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useCoinWallet } from "@/lib/coins";
import { rupees, STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orders/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Your Orders — Campu" },
      { name: "description", content: "Track your Campu deliveries in real time." },
      { property: "og:title", content: "Your Orders — Campu" },
      { property: "og:description", content: "Track your Campu deliveries in real time." },
    ],
  }),
  component: Orders,
});

export function statusTone(status: string) {
  if (status === "delivered") return "bg-success/15 text-success";
  if (status === "cancelled") return "bg-destructive/15 text-destructive";
  if (status === "payment_review") return "bg-warning/20 text-warning-foreground";
  return "bg-accent text-accent-foreground";
}

function Orders() {
  const { session } = useSession();
  const wallet = useCoinWallet();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", session?.user.id],
    enabled: Boolean(session),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, cart_items, total, status, payment_method, created_at, delivery_type, delivery_date")
        .eq("student_id", session!.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("my-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session, queryClient]);

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <h1 className="font-display text-2xl font-bold">Your orders</h1>

        {isLoading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />
            ))}
          </div>
        ) : (data ?? []).length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {(data ?? []).map((o) => {
              const items = (o.cart_items as { name: string; qty: number }[]) ?? [];
              const coinUsage = wallet.coinUsageForOrder(o.id);
              return (
                <li key={o.id}>
                  <Link
                    to="/orders/$id"
                    params={{ id: o.id }}
                    className="block rounded-2xl border border-border bg-card p-4 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {items.map((i) => `${i.qty}× ${i.name}`).join(", ")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          #{o.id.slice(0, 8)} · {new Date(o.created_at).toLocaleString()} ·{" "}
                          {coinUsage?.payableAmount === 0 ? "Campu Coins" : o.payment_method}
                        </p>
                        {o.delivery_type === "sunday_tuesday" && o.delivery_date && (
                          <p className="mt-1 text-xs font-semibold text-primary">
                            {deliveryLabel(o.delivery_type, o.delivery_date)} · {formatDeliveryDate(o.delivery_date)}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="font-display font-bold tabular-nums">
                          {rupees(coinUsage ? coinUsage.payableAmount : o.total)}
                        </span>
                        {coinUsage && coinUsage.coinsUsed > 0 && (
                          <span className="block text-[11px] font-semibold text-primary tabular-nums">
                            +{coinUsage.coinsUsed} Coins used
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold",
                        statusTone(o.status),
                      )}
                    >
                      {o.status === "delivered" && (
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-success text-success-foreground">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </span>
                      )}
                      {STATUS_LABELS[o.status]}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

import { useServerFn } from "@tanstack/react-start";
import { cancelOrderWithPush } from "@/lib/push.functions";
import { deliveryLabel, formatDeliveryDate } from "@/lib/delivery";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Clock3, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { rupees, STATUS_LABELS, trackSteps } from "@/lib/format";
import { usePreorder } from "@/components/PreorderNotice";
import { countdownLabel, wasPlacedDuringPreorder } from "@/lib/ordering";
import { useSignedAsset } from "@/lib/upi";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/orders/$id")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Track Order — Campu" },
      { name: "description", content: "Live status of your Campu campus delivery order." },
      { property: "og:title", content: "Track Order — Campu" },
      { property: "og:description", content: "Live status of your Campu campus delivery order." },
    ],
  }),
  component: OrderDetail,
});

function OrderDetail() {
  const { id } = Route.useParams();
  const queryClient = useQueryClient();
  const cancelOrder = useServerFn(cancelOrderWithPush);
  const { settings: preorderSettings, remaining: preorderRemaining } = usePreorder();
  
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);


  const { data: order, isLoading, refetch } = useQuery({
    queryKey: ["order", id],
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status = (query.state.data as { status?: string } | null | undefined)?.status;
      return status === "delivered" || status === "cancelled" ? false : 10_000;
    },
    queryFn: async () => {
      const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel(`order-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        (payload) => {
          const row = (payload.new ?? payload.old) as { id?: string } | null;
          if (row?.id !== id) return;
          void queryClient.invalidateQueries({ queryKey: ["order", id] });
          void refetch();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetch();
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [id, queryClient, refetch]);

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-4">
          <div className="h-64 animate-pulse rounded-3xl bg-muted" />
        </div>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <div className="p-10 text-center text-sm text-muted-foreground">Order not found.</div>
      </AppShell>
    );
  }

  const items =
    (order.cart_items as { name: string; qty: number; price: number; image_url?: string | null }[]) ??
    [];
  const cancelled = order.status === "cancelled";
  const delivered = order.status === "delivered";
  const { steps, currentIndex } = trackSteps(order.payment_method, order.status);
  const isActive = ["pending", "payment_review", "accepted", "out_for_delivery"].includes(order.status);
  const showPreorderCountdown = isActive && preorderRemaining > 0 && wasPlacedDuringPreorder(
    order.created_at,
    preorderSettings.data?.["order_start_time"],
    Date.now(),
  );

  const isUpi = order.payment_method === "UPI";
  const acceptedAt = order.accepted_at ? new Date(order.accepted_at).getTime() : null;
  const graceMin = acceptedAt === null ? Infinity : (now - acceptedAt) / 60_000;
  // Free 3-minute cancellation window that opens only once the order is accepted.
  const canCancel = order.status === "accepted" && graceMin <= 3;
  const windowClosed =
    !cancelled &&
    order.status !== "delivered" &&
    !canCancel;
  const showOtp = order.delivery_otp && !cancelled && order.status !== "delivered";

  async function doCancel() {
    setCancelling(true);
    try {
      await cancelOrder({ data: { orderId: id } });
    } catch {
      toast.error("Could not cancel — the cancellation window may have closed.");
      return;
    } finally {
      setCancelling(false);
      setConfirmOpen(false);
    }
    toast.success(
      isUpi
        ? "Cancellation successful. Your refund will be processed to your original UPI payment method within 1 to 3 hours."
        : "Cancellation successful.",
      { duration: 8000 },
    );
    void queryClient.invalidateQueries({ queryKey: ["order", id] });
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
  }


  return (
    <AppShell>
      <div className="px-4 pt-5">
        <Link to="/orders" className="text-sm font-semibold text-muted-foreground">
          ← All orders
        </Link>
        <h1 className="mt-2 font-display text-2xl font-bold">Order #{order.id.slice(0, 8)}</h1>
        <p className="text-sm text-muted-foreground">
          {new Date(order.created_at).toLocaleString()} · {order.payment_method}
        </p>
        {order.delivery_type === "sunday_tuesday" && order.delivery_date && (
          <p className="mt-1 text-sm font-semibold text-primary">
            {deliveryLabel(order.delivery_type, order.delivery_date)} · {formatDeliveryDate(order.delivery_date)}
          </p>
        )}

        {showOtp && (
          <div className="mt-4 rounded-2xl border border-primary/30 bg-accent p-4 text-center shadow-card">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Delivery code
            </p>
            <p className="mt-1 font-display text-4xl font-extrabold tracking-[0.4em] text-primary">
              {order.delivery_otp}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Share this only when your order is handed over.
            </p>
          </div>
        )}

        <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-card">
          {showPreorderCountdown && (
            <div role="status" className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-4 text-foreground">
              <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-primary" /> Pre-order</div>
              <p className="mt-2 font-display text-2xl font-bold tabular-nums" aria-label={`Orders open in ${countdownLabel(preorderRemaining)}`}>
                {countdownLabel(preorderRemaining)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Your order has been placed successfully and will be actively processed once the timer ends.
              </p>
            </div>
          )}
          {cancelled ? (
            <div className="flex items-center gap-3 text-destructive">
              <XCircle className="h-6 w-6" />
              <div>
                <p className="font-semibold">Order cancelled</p>
                <p className="text-xs text-muted-foreground">
                  {order.payment_method === "UPI"
                    ? "Your payment reference could not be verified. Please contact support."
                    : "This order was cancelled."}
                </p>
              </div>
            </div>
          ) : delivered ? (
            <DeliveredSuccess />
          ) : (
            <ol className="space-y-4">
              {steps.map((step, i) => {
                const done = i < currentIndex;
                const active = i === currentIndex;
                const deliveredStep = order.status === "delivered" && step === "delivered";
                return (
                  <li key={step} className="flex items-start gap-3">
                    <span
                      className={cn(
                        "grid h-7 w-7 shrink-0 place-items-center rounded-full border-2",
                        done && "border-transparent bg-success text-success-foreground",
                        active && !deliveredStep && "border-transparent bg-brand text-primary-foreground",
                        deliveredStep && "border-transparent bg-success text-success-foreground",
                        !done && !active && !deliveredStep && "border-border text-muted-foreground",
                      )}
                    >
                      {done || deliveredStep ? (
                        <Check className="h-4 w-4" />
                      ) : active && step === "payment_review" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className="text-xs font-bold">{i + 1}</span>
                      )}
                    </span>
                    <div className="pt-0.5">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          deliveredStep && "text-success",
                          !done && !active && !deliveredStep && "text-muted-foreground",
                        )}
                      >
                        {STATUS_LABELS[step]}
                      </p>
                      {active && step === "payment_review" && (
                        <p className="text-xs text-muted-foreground">
                          Verifying UTR {order.utr_number} — usually under 2 minutes.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-card">
          <h2 className="font-display text-base font-bold">Items</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {items.map((i, idx) => (
              <li key={idx} className="flex items-center gap-2">
                {i.image_url && <CatalogImage source={i.image_url} alt={i.name} className="h-9 w-9 rounded-lg object-cover" />}
                <span className="min-w-0 flex-1 truncate">{i.qty} × {i.name}</span>
                <span className="font-semibold">{rupees(i.qty * Number(i.price))}</span>
              </li>
            ))}
          </ul>
          <div className="my-3 h-px bg-border" />
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Delivery fee</span>
            <span>{rupees(order.delivery_fee)}</span>
          </div>
          <div className="mt-1 flex justify-between font-display text-lg font-extrabold">
            <span>Total</span>
            <span>{rupees(order.total)}</span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Delivering to {order.delivery_address}
          </p>
        </div>

        {cancelled && isUpi && order.refund_status === "refunded" && (
          <RefundSuccess path={order.refund_proof_url} />
        )}

        {canCancel && (
          <div className="mt-5">
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={() => setConfirmOpen(true)}
              className="h-12 w-full rounded-full border-destructive/40 text-destructive"
            >
              {cancelling ? "Cancelling…" : "Cancel order"}
            </Button>
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Free cancellation for 3 minutes after your order is accepted.
            </p>
          </div>
        )}

        {windowClosed && (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            {order.status === "accepted" || order.status === "out_for_delivery"
              ? "Cancellation window closed. Items are being prepared."
              : "Cancellation opens for 3 minutes once your order is accepted."}
          </p>
        )}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent className="rounded-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
              <AlertDialogDescription>
                {isUpi
                  ? "This is a free cancellation. Your refund will be processed to your original UPI payment method within 1 to 3 hours."
                  : "This order will be cancelled right away at no charge."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="rounded-full">Keep order</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  void doCancel();
                }}
                className="rounded-full bg-destructive text-destructive-foreground"
              >
                Yes, cancel
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </AppShell>
  );
}

function RefundSuccess({ path }: { path: string | null }) {
  const proof = useSignedAsset(path);
  return (
    <div className="mt-5 overflow-hidden rounded-3xl border border-success/30 bg-success/5 p-6 text-center shadow-card">
      <div className="relative mx-auto grid h-20 w-20 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-success/30" />
        <span className="absolute inset-2 animate-ping rounded-full bg-success/20 [animation-delay:400ms]" />
        <span className="absolute inset-4 rounded-full bg-success/20" />
        <span className="relative grid h-12 w-12 place-items-center rounded-full bg-success text-success-foreground shadow-lg">
          <Check className="h-7 w-7" strokeWidth={3} />
        </span>
      </div>
      <p className="mt-4 font-display text-lg font-extrabold text-success">Refund successful</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Your refund has been sent back to your original UPI payment method.
      </p>
      {proof.data && (
        <img
          src={proof.data}
          alt="Refund payment confirmation screenshot"
          className="mx-auto mt-4 max-h-80 w-full rounded-2xl border border-border object-contain"
        />
      )}
    </div>
  );
}

function DeliveredSuccess() {
  // Ripple plays once on first reveal, then settles.
  const [waving, setWaving] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setWaving(false), 2400);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="py-2 text-center">
      <div className="relative mx-auto grid h-20 w-20 place-items-center">
        {waving && <span className="absolute inset-0 animate-ping rounded-full bg-success/30" />}
        {waving && <span className="absolute inset-2 animate-ping rounded-full bg-success/20 [animation-delay:400ms]" />}
        <span className="absolute inset-4 rounded-full bg-success/20" />
        <span className="relative grid h-12 w-12 place-items-center rounded-full bg-success text-success-foreground shadow-lg">
          <Check className="h-7 w-7" strokeWidth={3} />
        </span>
      </div>
      <p className="mt-4 font-display text-lg font-extrabold text-success">Delivered successfully</p>
      <p className="mt-1 text-xs text-muted-foreground">Enjoy your order!</p>
    </div>
  );
}

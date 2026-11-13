import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { formatDeliveryDate, sundayTuesdayDeliveryDate, useDeliveryMode } from "@/lib/delivery";
import { MODE_LABEL, deliveryInfoText } from "@/lib/delivery";
import { useEnforceCartMode } from "@/lib/cart";
import { deliveryFee, rupees } from "@/lib/format";
import { SCHEDULED_MIN_ORDER, SCHEDULED_ORIGINAL_FEE, scheduledDeliveryFee } from "@/lib/scheduled-fee";
import { useVip } from "@/lib/vip";
import { VipCartHint } from "@/components/VipBanner";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Your Cart — Campu" },
      { name: "description", content: "Review your Campu order before checkout." },
      { property: "og:title", content: "Your Cart — Campu" },
      { property: "og:description", content: "Review your Campu order before checkout." },
    ],
  }),
  component: CartPage,
});

function CartPage() {
  const { items, setQty, remove, subtotal } = useCart();
  const { settings, remaining } = usePreorder();
  const mode = useDeliveryMode();
  useEnforceCartMode();
  const vip = useVip();
  const scheduled = mode === "sunday_tuesday" ? scheduledDeliveryFee(subtotal, vip.isVip) : null;

  return (
    <AppShell>
      <div className="px-4 pt-5">
        <h1 className="font-display text-2xl font-bold">Your cart</h1>
        <p className="mt-1 text-sm font-semibold text-primary">
          {MODE_LABEL[mode]} · {deliveryInfoText(mode, settings.data)}
        </p>
        {remaining > 0 && <div className="mt-4"><PreorderNotice remaining={remaining} time={settings.data?.["order_start_time"]} /></div>}

        {items.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-muted-foreground">Your cart is empty.</p>
            <Link
              to="/"
              className="mt-4 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-float"
            >
              Start shopping
            </Link>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-card"
                >
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-brand-soft">
                    {i.image_url ? (
                      <CatalogImage source={i.image_url} alt={i.name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="font-display font-bold text-brand">{i.name.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{i.name}</p>
                    <p className="text-sm text-muted-foreground">{rupees(i.price)}</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-border px-2 py-1">
                    <button onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{i.qty}</span>
                    <button onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button onClick={() => remove(i.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-5 rounded-2xl border border-border bg-card p-4 shadow-card">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Item total</span>
                <span className="font-semibold">{rupees(subtotal)}</span>
              </div>
              {scheduled ? (
                <>
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">Delivery fee</span>
                    <span className="font-semibold">
                      <s className="mr-1.5 font-normal text-muted-foreground">{rupees(vip.isVip && scheduled.normalFee != null ? scheduled.normalFee : SCHEDULED_ORIGINAL_FEE)}</s>
                      {scheduled.eligible ? (scheduled.fee === 0 ? "FREE" : rupees(scheduled.fee!)) : "—"}
                    </span>
                  </div>
                  {!scheduled.eligible ? (
                    <p className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
                      Minimum order is ₹{SCHEDULED_MIN_ORDER} for Sunday & Tuesday Special. Add ₹{scheduled.shortBy} more to place your order.
                    </p>
                  ) : scheduled.next ? (
                    <div className="mt-3">
                      <p className="text-xs font-semibold text-primary">
                        {scheduled.next.fee === 0
                          ? `Add ₹${scheduled.next.addMore} more to get FREE delivery!`
                          : `Add ₹${scheduled.next.addMore} more to get delivery at just ₹${scheduled.next.fee}!`}
                      </p>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, (subtotal / scheduled.next.at) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 inline-flex rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                      {scheduled.fee === 0 ? "🎉 FREE VIP Delivery Unlocked!" : `🎉 Lowest delivery fee unlocked — just ₹${scheduled.fee}!`}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Delivery fee is added at checkout — {rupees(deliveryFee(settings.data, "UPI"))} with UPI{settings.data?.["night_mode_enabled"] === "true" ? " (night mode; cash unavailable)." : `, ${rupees(deliveryFee(settings.data, "COD"))} with cash.`}
                </p>
              )}
              <VipCartHint vip={vip} mode={mode} subtotal={subtotal} />
              {scheduled && !scheduled.eligible ? (
                <Button disabled className="mt-4 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground disabled:opacity-40">
                  Proceed to checkout
                </Button>
              ) : (
                <Button
                  asChild
                  className="mt-4 h-12 w-full rounded-full bg-brand text-base font-semibold text-primary-foreground shadow-float hover:opacity-95"
                >
                  <Link to="/checkout">Proceed to checkout</Link>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

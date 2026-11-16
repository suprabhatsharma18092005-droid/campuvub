import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2 } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { CatalogImage } from "@/components/CatalogImage";
import { PreorderNotice, usePreorder } from "@/components/PreorderNotice";
import { Button } from "@/components/ui/button";
import { VipCartHint } from "@/components/VipBanner";
import { useCart, useEnforceCartMode } from "@/lib/cart";
import { MODE_LABEL, deliveryInfoText, useDeliveryMode } from "@/lib/delivery";
import { deliveryFee, rupees } from "@/lib/format";
import {
  SCHEDULED_MIN_ORDER,
  SCHEDULED_ORIGINAL_FEE,
  VIP_QUICK_DISCOUNT_MIN_ORDER,
  VIP_QUICK_DISCOUNT_PCT,
  VIP_QUICK_FREE_PER_DAY,
  quickDeliveryFee,
  scheduledDeliveryFee,
  vipDiscountedQuickFee,
} from "@/lib/scheduled-fee";
import { useVip } from "@/lib/vip";

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
  const normalQuickUpi = deliveryFee(settings.data, "UPI");
  const activeQuickUpiFee = quickDeliveryFee(normalQuickUpi, subtotal, vip.isVip, vip.freeUsedToday);
  const isVipPostFreeDiscount =
    mode === "quick" &&
    vip.isVip &&
    vip.freeUsedToday >= VIP_QUICK_FREE_PER_DAY &&
    subtotal >= VIP_QUICK_DISCOUNT_MIN_ORDER &&
    activeQuickUpiFee > 0 &&
    activeQuickUpiFee < normalQuickUpi;
  const isVipPostFreeBelowMin =
    mode === "quick" &&
    vip.isVip &&
    vip.freeUsedToday >= VIP_QUICK_FREE_PER_DAY &&
    subtotal < VIP_QUICK_DISCOUNT_MIN_ORDER;

  return (
    <AppShell>
      <div className="px-4 pt-5 pb-10">
        <h1 className="font-display text-2xl font-bold">Your cart</h1>
        <p className="mt-1 text-sm font-semibold text-primary">
          {MODE_LABEL[mode]} · {deliveryInfoText(mode, settings.data)}
        </p>
        {remaining > 0 && (
          <div className="mt-4">
            <PreorderNotice remaining={remaining} time={settings.data?.["order_start_time"]} />
          </div>
        )}

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
          <div className="mt-4 grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-6">
            <ul className="min-w-0 w-full space-y-3 lg:col-span-7">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="royal-card flex min-w-0 items-center gap-2.5 overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-card sm:gap-3 sm:p-3.5"
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
                  <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-1 sm:gap-2">
                    <button onClick={() => setQty(i.id, i.qty - 1)} aria-label="Decrease">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{i.qty}</span>
                    <button onClick={() => setQty(i.id, i.qty + 1)} aria-label="Increase">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button className="shrink-0" onClick={() => remove(i.id)} aria-label="Remove">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </li>
              ))}
            </ul>

            <div className="royal-card min-w-0 w-full overflow-hidden rounded-3xl border border-border bg-card p-4 shadow-card sm:p-5 lg:sticky lg:top-16 lg:col-span-5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">Item total</span>
                <span className="shrink-0 font-semibold">{rupees(subtotal)}</span>
              </div>
              {scheduled ? (
                <>
                  <div className="mt-1 flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Delivery fee</span>
                    <span className="shrink-0 font-semibold">
                      <s className="mr-1.5 font-normal text-muted-foreground">
                        {rupees(vip.isVip && scheduled.normalFee != null ? scheduled.normalFee : SCHEDULED_ORIGINAL_FEE)}
                      </s>
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
                    <p className="mt-3 inline-flex max-w-full flex-wrap rounded-2xl bg-success/15 px-3 py-1.5 text-xs font-semibold text-success">
                      {scheduled.fee === 0 ? "🎉 FREE VIP Delivery Unlocked!" : `🎉 Lowest delivery fee unlocked — just ₹${scheduled.fee}!`}
                    </p>
                  )}
                </>
              ) : activeQuickUpiFee === 0 ? (
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
                  <span className="min-w-0 text-muted-foreground">Delivery fee · VIP 👑</span>
                  <span className="shrink-0 font-semibold text-success">
                    <s className="mr-1.5 font-normal text-muted-foreground">
                      {rupees(normalQuickUpi)}
                    </s>
                    FREE (1st order today)
                  </span>
                </div>
              ) : isVipPostFreeDiscount ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
                    <span className="min-w-0 text-muted-foreground">Delivery fee · VIP {VIP_QUICK_DISCOUNT_PCT}% OFF 🏷️</span>
                    <span className="shrink-0 font-semibold text-primary">
                      <s className="mr-1.5 font-normal text-muted-foreground">
                        {rupees(normalQuickUpi)}
                      </s>
                      {rupees(activeQuickUpiFee)} (UPI)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Daily {VIP_QUICK_FREE_PER_DAY} free quick order used — {VIP_QUICK_DISCOUNT_PCT}% VIP OFF applies on ₹{VIP_QUICK_DISCOUNT_MIN_ORDER}+ orders ({rupees(activeQuickUpiFee)} UPI{settings.data?.["night_mode_enabled"] === "true" ? " · night mode" : `, ${rupees(vipDiscountedQuickFee(deliveryFee(settings.data, "COD")))} COD`}).
                  </p>
                </>
              ) : isVipPostFreeBelowMin ? (
                <>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-sm">
                    <span className="min-w-0 text-muted-foreground">Delivery fee (normal below ₹{VIP_QUICK_DISCOUNT_MIN_ORDER})</span>
                    <span className="shrink-0 font-semibold">
                      {rupees(normalQuickUpi)} (UPI)
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-medium text-primary">
                    Add ₹{Math.ceil(VIP_QUICK_DISCOUNT_MIN_ORDER - subtotal)} more to unlock {VIP_QUICK_DISCOUNT_PCT}% VIP OFF ({rupees(vipDiscountedQuickFee(normalQuickUpi))} UPI{settings.data?.["night_mode_enabled"] === "true" ? "" : `, ${rupees(vipDiscountedQuickFee(deliveryFee(settings.data, "COD")))} COD`}).
                  </p>
                </>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Delivery fee is added at checkout — {rupees(normalQuickUpi)} with UPI
                  {settings.data?.["night_mode_enabled"] === "true"
                    ? " (night mode; cash unavailable)."
                    : `, ${rupees(deliveryFee(settings.data, "COD"))} with cash.`}
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
          </div>
        )}
      </div>
    </AppShell>
  );
}

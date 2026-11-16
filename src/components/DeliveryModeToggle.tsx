import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Sparkles, Zap } from "lucide-react";

import scooterIllustration from "@/assets/quick-delivery-illustration.png";
import { Button } from "@/components/ui/button";
import { deliveryInfoText, setDeliveryMode, useDeliveryMode, type DeliveryMode } from "@/lib/delivery";
import { settingsQuery } from "@/lib/queries";
import {
  SCHEDULED_MIN_ORDER,
  VIP_QUICK_DISCOUNT_MIN_ORDER,
  VIP_QUICK_DISCOUNT_PCT,
  VIP_QUICK_FREE_PER_DAY,
} from "@/lib/scheduled-fee";
import { cn } from "@/lib/utils";
import { useVip } from "@/lib/vip";

export function DeliveryModeToggle({
  variant = "compact",
  className,
}: {
  variant?: "compact" | "showcase";
  className?: string;
}) {
  const mode = useDeliveryMode();
  const settings = useQuery(settingsQuery);
  const vip = useVip();
  const quickLeft = Math.max(0, VIP_QUICK_FREE_PER_DAY - vip.freeUsedToday);

  const cards: {
    value: DeliveryMode;
    label: string;
    eta: string;
    offer: string;
    detail: string;
    Icon: typeof Zap;
  }[] = [
    {
      value: "quick",
      label: "Quick Delivery",
      eta: deliveryInfoText("quick", settings.data),
      offer: vip.isVip
        ? quickLeft > 0
          ? `${quickLeft}/${VIP_QUICK_FREE_PER_DAY} FREE today (any ₹) · then ${VIP_QUICK_DISCOUNT_PCT}% OFF ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+`
          : `VIP ${VIP_QUICK_DISCOUNT_PCT}% OFF on ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+ (₹5 below ₹${VIP_QUICK_DISCOUNT_MIN_ORDER})`
        : `Normal ₹5 · VIP: 1 FREE/day + ${VIP_QUICK_DISCOUNT_PCT}% OFF ₹${VIP_QUICK_DISCOUNT_MIN_ORDER}+`,
      detail: "Get it Faster!",
      Icon: Zap,
    },
    {
      value: "sunday_tuesday",
      label: "Sunday & Tuesday Special",
      eta: deliveryInfoText("sunday_tuesday", settings.data),
      offer: vip.isVip
        ? `VIP: ₹3 (₹${SCHEDULED_MIN_ORDER}–299) · FREE ₹300+`
        : `Min ₹${SCHEDULED_MIN_ORDER} · ₹15 (₹99–299) · ₹10 (₹300+)`,
      detail: "Special Offer",
      Icon: Sparkles,
    },
  ];

  if (variant === "showcase") {
    return (
      <div
        role="radiogroup"
        aria-label="Delivery type"
        className={cn("grid grid-cols-1 gap-3", className)}
      >
        {cards.map(({ value, label, eta, offer, detail, Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setDeliveryMode(value)}
              className={cn(
                "group flex w-full min-w-0 items-center gap-3 rounded-3xl border-2 p-3.5 text-left transition-all duration-200",
                value === "quick" ? "bg-delivery-quick" : "bg-delivery-scheduled",
                active
                  ? "border-primary opacity-100 shadow-float"
                  : "border-border/75 opacity-85 shadow-card hover:opacity-100",
              )}
            >
              {value === "quick" ? (
                <img
                  src={scooterIllustration}
                  alt=""
                  aria-hidden="true"
                  className="h-12 w-12 shrink-0 object-contain"
                />
              ) : (
                <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-2xl border border-primary/20 bg-background/80 text-primary">
                  <CalendarDays className="h-5 w-5" />
                  <span className="mt-0.5 text-[8px] font-extrabold leading-none">SUN TUE</span>
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-display text-sm font-extrabold text-foreground">
                    {label}
                  </span>
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                </div>
                <p className="mt-0.5 truncate text-[11px] font-medium text-muted-foreground">
                  {eta}
                </p>
                <p className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[10.5px] font-bold text-primary">
                  <span className="truncate">{offer}</span>
                </p>
              </div>

              <span
                className={cn(
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-background/75 text-muted-foreground group-hover:text-foreground",
                )}
                aria-label={detail}
              >
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section className={cn("sticky top-11 z-20 -mx-4 bg-background/95 px-4 py-2 shadow-sm", className)}>
      <div role="radiogroup" aria-label="Delivery type" className="grid grid-cols-2 gap-3 sm:gap-4">
        {cards.map(({ value, label, offer, Icon }) => {
          const active = mode === value;
          return (
            <Button
              key={value}
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={active}
              onClick={() => setDeliveryMode(value)}
              className={cn(
                "group h-[68px] min-w-0 justify-start gap-1.5 overflow-hidden rounded-2xl border-2 px-2.5 py-1 text-left transition-all duration-200 sm:h-[72px] sm:gap-2 sm:rounded-3xl sm:px-3",
                value === "quick" ? "bg-delivery-quick" : "bg-delivery-scheduled",
                active
                  ? "border-primary opacity-100 shadow-float"
                  : "border-border/70 opacity-75 shadow-none hover:opacity-90",
              )}
            >
              {value === "quick" ? (
                <img
                  src={scooterIllustration}
                  alt=""
                  aria-hidden="true"
                  className="h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl border border-primary/20 bg-background/70 text-primary sm:h-12 sm:w-12 sm:rounded-2xl">
                  <CalendarDays className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
                  <span className="mt-0.5 text-[7px] font-extrabold leading-none sm:text-[8px]">
                    SUN TUE
                  </span>
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                <span className="flex min-w-0 items-center gap-1 text-[11px] font-extrabold leading-[1.15] text-foreground sm:text-sm">
                  <span className="line-clamp-2 min-w-0">{label}</span>
                  <Icon className="h-3 w-3 shrink-0 text-primary sm:h-3.5 sm:w-3.5" />
                </span>
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-background/70 px-1.5 py-0.5 text-[9px] font-bold leading-none text-foreground/80 sm:text-[10px]">
                  {value === "quick" ? (
                    <Zap className="h-2.5 w-2.5 shrink-0 text-primary" />
                  ) : (
                    <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" />
                  )}
                  <span className="truncate">{offer}</span>
                </span>
              </span>

              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground sm:h-6 sm:w-6">
                <ArrowRight className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
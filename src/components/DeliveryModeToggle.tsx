import { ArrowRight, CalendarDays, Sparkles, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import scooterIllustration from "@/assets/quick-delivery-illustration.png";
import { setDeliveryMode, useDeliveryMode, type DeliveryMode } from "@/lib/delivery";
import { cn } from "@/lib/utils";

const OPTIONS: {
  value: DeliveryMode;
  label: string;
  detail: string;
  Icon: typeof Zap;
}[] = [
  { value: "quick", label: "Quick Delivery", detail: "Get it Faster!", Icon: Zap },
  {
    value: "sunday_tuesday",
    label: "Sunday & Tuesday Special Delivery",
    detail: "Special Offer",
    Icon: Sparkles,
  },
];

export function DeliveryModeToggle() {
  const mode = useDeliveryMode();

  return (
    <section className="sticky top-11 z-20 -mx-4 bg-background/90 px-4 py-2 shadow-sm backdrop-blur-md">
      <div role="radiogroup" aria-label="Delivery type" className="grid grid-cols-2 gap-3 sm:gap-4">
        {OPTIONS.map(({ value, label, detail, Icon }) => {
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
                  <span className="truncate">{detail}</span>
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
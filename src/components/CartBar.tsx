import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, ShoppingBag } from "lucide-react";

import { useCart } from "@/lib/cart";
import { rupees } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRoyalTheme } from "@/lib/vip";

const HIDDEN_ON = ["/cart", "/checkout", "/auth", "/product/", "/admin", "/profile", "/orders"];

/** Compact floating pill summary that pops and gently floats when items are in the cart. */
export function CartBar() {
  const { count, subtotal, bump } = useCart();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isRoyal } = useRoyalTheme();

  if (count === 0 || HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="pointer-events-none fixed bottom-[5.4rem] left-1/2 z-40 flex -translate-x-1/2 justify-center px-3 md:bottom-[5.8rem]">
      <div>
        <Link
          key={bump}
          to="/cart"
          className={cn(
            "pointer-events-auto inline-flex items-center gap-2.5 rounded-full px-3.5 py-2 shadow-float transition-transform active:scale-95",
            bump > 0 ? "animate-pill-pop" : "animate-fly-in",
            isRoyal
              ? "border border-white/25 bg-royal text-white"
              : "bg-brand text-primary-foreground",
          )}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/20">
            <ShoppingBag className="h-3.5 w-3.5" />
          </span>
          <span className="whitespace-nowrap text-xs font-bold leading-tight">
            {count} {count === 1 ? "item" : "items"} · {rupees(subtotal)}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-extrabold whitespace-nowrap">
            View Cart
            <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>
    </div>
  );
}

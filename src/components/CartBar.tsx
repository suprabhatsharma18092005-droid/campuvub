import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronRight, ShoppingBag } from "lucide-react";

import { useCart } from "@/lib/cart";
import { rupees } from "@/lib/format";

const HIDDEN_ON = ["/cart", "/checkout", "/auth"];

/** Sticky summary that appears as soon as the cart has something in it. */
export function CartBar() {
  const { count, subtotal } = useCart();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (count === 0 || HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <div className="pointer-events-none fixed bottom-[5.35rem] left-1/2 z-40 w-full max-w-2xl -translate-x-1/2 px-3 pb-2">
      <Link
        to="/cart"
        className="pointer-events-auto flex animate-fly-in items-center gap-3 rounded-2xl bg-brand px-4 py-3 text-primary-foreground shadow-float active:scale-[0.98] transition-transform"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white/20">
          <ShoppingBag className="h-4 w-4" />
        </span>
        <span className="flex-1 leading-tight">
          <span className="block text-[13px] font-semibold">
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span className="block text-[11px] text-primary-foreground/80">
            {rupees(subtotal)} · plus delivery
          </span>
        </span>
        <span className="inline-flex items-center text-sm font-semibold">
          View cart <ChevronRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
